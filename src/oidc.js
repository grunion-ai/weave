/* OpenID Connect sign-in with no dependencies (Feature #212; door C of
   Feature #222). One provider per process, named by WEAVE_OIDC_ISSUER: Clerk,
   Auth0, Keycloak, Authentik, Google — anything that serves
   /.well-known/openid-configuration. The flow is authorization code with
   PKCE; the id token is verified here against the provider's JWKS (RS256 or
   ES256), with its issuer, audience, expiry and nonce checked. The scope is
   `openid` alone, so the provider is asked for no email and no profile
   (Feature #252), and what comes out is { issuer, subject }. Whether that
   subject has an account is the engine's question (accountForIdentity, or
   redeemIdentityInvite on an invite's trip), and the session is weave's own
   wv_session.
   ponytail: one provider. A second one is a list here and a button each on
   the sign-in page; the account row already keys identities by issuer. */
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { WeaveError } from './store.js';
const { subtle } = webcrypto;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SKEW_S = 60;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const ALGS = {
  RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
  ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
};

/* WEAVE_OIDC_ISSUER and WEAVE_OIDC_CLIENT_ID turn the door on together;
   WEAVE_OIDC_CLIENT_SECRET is for a confidential client (a public one relies
   on PKCE alone); WEAVE_OIDC_NAME is the word on the button. */
export function oidcFromEnv(env = process.env) {
  const raw = env.WEAVE_OIDC_ISSUER?.trim();
  const clientId = env.WEAVE_OIDC_CLIENT_ID?.trim();
  if (!raw && !clientId) return null;
  if (!raw) throw new WeaveError('WEAVE_OIDC_ISSUER is required when WEAVE_OIDC_CLIENT_ID is set: the provider\'s issuer URL, e.g. https://clerk.example.com', 'invalid');
  if (!clientId) throw new WeaveError('WEAVE_OIDC_CLIENT_ID is required when WEAVE_OIDC_ISSUER is set', 'invalid');
  let url;
  try { url = new URL(raw); } catch { throw new WeaveError(`WEAVE_OIDC_ISSUER must be an absolute URL like https://clerk.example.com (got '${raw}')`, 'invalid'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new WeaveError(`WEAVE_OIDC_ISSUER must be https (got '${raw}')`, 'invalid');
  }
  return { issuer: raw.replace(/\/+$/, ''), clientId, clientSecret: env.WEAVE_OIDC_CLIENT_SECRET?.trim() || null, name: env.WEAVE_OIDC_NAME?.trim() || url.hostname };
}

const refuse = (message) => new WeaveError(message, 'unauthorized');
const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export function createOidc({ issuer, clientId, clientSecret = null, name = null, fetch = globalThis.fetch } = {}) {
  if (!issuer || !clientId) throw new WeaveError('An OIDC provider needs an issuer and a client id', 'invalid');
  let discovered = null;
  let keys = null;

  const getJson = async (url, init) => {
    const res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw refuse(`The identity provider answered ${res.status} at ${new URL(url).pathname}${body?.error ? `: ${body.error}` : ''}`);
    return body;
  };
  const discover = async () => {
    if (discovered && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.doc;
    const doc = await getJson(`${issuer}/.well-known/openid-configuration`);
    if (doc.issuer !== issuer) throw refuse(`The identity provider names itself ${doc.issuer}, not ${issuer} (check WEAVE_OIDC_ISSUER)`);
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!doc[k]) throw refuse(`The identity provider's discovery document has no ${k}`);
    discovered = { at: Date.now(), doc };
    return doc;
  };
  /* A key id the cache has not seen is a rotation: fetch once more, then give up. */
  const keyFor = async (kid, doc) => {
    const find = () => (keys ?? []).find((k) => (kid ? k.kid === kid : true) && (k.use ?? 'sig') === 'sig');
    if (!find()) keys = (await getJson(doc.jwks_uri)).keys ?? [];
    return find() ?? null;
  };

  async function verifyIdToken(token, { nonce, doc }) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) throw refuse('The identity provider sent no id token');
    let head, claims;
    try { head = decodePart(parts[0]); claims = decodePart(parts[1]); } catch { throw refuse('The id token is not a JWT'); }
    const alg = ALGS[head.alg];
    if (!alg) throw refuse(`The id token is signed with ${head.alg}; RS256 and ES256 are accepted`);
    const jwk = await keyFor(head.kid, doc);
    if (!jwk) throw refuse('The id token is signed with a key the identity provider does not publish');
    const { kid, use, alg: _a, key_ops, ...material } = jwk;
    const key = await subtle.importKey('jwk', material, alg.import, false, ['verify']);
    const ok = await subtle.verify(alg.verify, key, Buffer.from(parts[2], 'base64url'), Buffer.from(`${parts[0]}.${parts[1]}`));
    if (!ok) throw refuse('The id token\'s signature does not verify');
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== issuer) throw refuse('The id token was issued by someone else');
    if (![].concat(claims.aud).includes(clientId)) throw refuse('The id token was issued to another client');
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) throw refuse('The id token was issued to another client');
    if (!(Number(claims.exp) + SKEW_S > now)) throw refuse('The id token has expired');
    if (Number(claims.iat) - SKEW_S > now) throw refuse('The id token is dated in the future');
    if (!claims.nonce || claims.nonce !== nonce) throw refuse('The id token does not answer this sign-in');
    if (!claims.sub) throw refuse('The id token names nobody');
    return claims;
  }

  return {
    issuer,
    name: name || new URL(issuer).hostname,
    /* What start needs: the three secrets of one trip and where to send the
       browser. state and nonce ride the URL; the verifier stays here. fresh
       asks the provider to sign the person in again rather than reuse its
       session (prompt=login, plus select_account where discovery lists it),
       which is how a person switches account where the provider names no
       end_session_endpoint (Issue #570). */
    async begin({ redirectUri, fresh = false }) {
      const doc = await discover();
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const url = new URL(doc.authorization_endpoint);
      for (const [k, v] of Object.entries({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid',
        state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      })) url.searchParams.set(k, v);
      if (fresh) url.searchParams.set('prompt', doc.prompt_values_supported?.includes('select_account') ? 'login select_account' : 'login');
      return { url: url.href, state, nonce, verifier };
    },
    /* RP-initiated logout: the provider's end_session_endpoint, coming back
       to postLogoutRedirectUri, or null when discovery names none.
       ponytail: client_id and no id_token_hint, which the spec allows; a
       provider that insists on the hint needs the id token kept per session. */
    async endSessionUrl({ postLogoutRedirectUri }) {
      const doc = await discover();
      if (!doc.end_session_endpoint) return null;
      const url = new URL(doc.end_session_endpoint);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      return url.href;
    },
    /* The code for a verified identity: the issuer and the subject, and
       nothing else the token may carry. */
    async redeem({ code, redirectUri, verifier, nonce }) {
      const doc = await discover();
      const form = new URLSearchParams({ grant_type: 'authorization_code', code: String(code ?? ''), redirect_uri: redirectUri, code_verifier: verifier });
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
      const methods = doc.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
      if (!clientSecret) form.set('client_id', clientId);
      else if (methods.includes('client_secret_basic')) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
      else { form.set('client_id', clientId); form.set('client_secret', clientSecret); }
      const tokens = await getJson(doc.token_endpoint, { method: 'POST', headers, body: form.toString() });
      const claims = await verifyIdToken(tokens.id_token, { nonce, doc });
      return { issuer, subject: String(claims.sub) };
    },
  };
}
