/* An OpenID Connect provider in software, for test/auth-oidc.test.mjs (door
   C, Feature #212): discovery, a JWKS, a token endpoint that checks the
   client, the redirect and the PKCE verifier, and a userinfo endpoint. The
   browser's trip through the provider's sign-in page is approve(): it takes
   the authorize URL weave redirected to and returns the callback URL the
   provider would send the browser back to. serveOidc() puts a workspace
   behind it on a free port, for every suite that signs in through door C. */
import { createServer } from 'node:http';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { startServer } from '../../src/server.js';
import { createOidc } from '../../src/oidc.js';

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function signJwt(payload, { privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const head = `${b64({ alg, kid, typ: 'JWT' })}.${b64(payload)}`;
  const sig = createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url');
  return `${head}.${sig}`;
}

/* endSession: discovery names an end_session_endpoint (RP-initiated logout),
   as Keycloak and Auth0 do and Clerk does not. */
export async function startIdp({ clientId = 'weave-client', clientSecret = 's3cret', claimsInIdToken = true, endSession = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map();
  const seen = { token: [], userinfo: 0, discovery: 0, jwks: 0 };
  let issuer = '';
  /* tamper: what the next id_token gets wrong — 'signature', 'nonce', 'aud',
     'iss', 'expired' — so one provider serves every refusal case. */
  let tamper = null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      seen.discovery += 1;
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        userinfo_endpoint: `${issuer}/oauth/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256'],
        ...(endSession ? { end_session_endpoint: `${issuer}/oauth/logout` } : {}),
      });
    }
    if (url.pathname === '/jwks') {
      seen.jwks += 1;
      return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });
    }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
      const [id, secret] = basic ? Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent) : [form.get('client_id'), form.get('client_secret')];
      seen.token.push({ form: Object.fromEntries(form), basic: Boolean(basic) });
      const grant = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (id !== clientId || secret !== clientSecret) return json(401, { error: 'invalid_client' });
      if (!grant || form.get('grant_type') !== 'authorization_code') return json(400, { error: 'invalid_grant' });
      if (form.get('redirect_uri') !== grant.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== grant.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verifier mismatch' });
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: tamper === 'iss' ? 'https://someone-else.example' : issuer,
        aud: tamper === 'aud' ? 'another-client' : clientId,
        sub: grant.claims.sub,
        nonce: tamper === 'nonce' ? 'not-the-nonce' : grant.nonce,
        iat: now - (tamper === 'expired' ? 7200 : 0),
        exp: now + (tamper === 'expired' ? -3600 : 300),
        ...(claimsInIdToken ? grant.claims : {}),
      };
      let idToken = signJwt(payload, { privateKey });
      if (tamper === 'signature') {
        const [h, p] = idToken.split('.');
        idToken = `${h}.${p}.${randomBytes(256).toString('base64url')}`;
      }
      const access = randomBytes(16).toString('hex');
      codes.set(`access:${access}`, grant);
      return json(200, { access_token: access, token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    if (url.pathname === '/oauth/userinfo') {
      seen.userinfo += 1;
      const grant = codes.get(`access:${/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]}`);
      return grant ? json(200, grant.claims) : json(401, { error: 'invalid_token' });
    }
    json(404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    issuer, clientId, clientSecret, seen, privateKey,
    tamper: (what) => { tamper = what; },
    /* The person signs in at the provider as `claims` and is sent back. */
    approve(authorizeUrl, claims) {
      const q = new URL(authorizeUrl).searchParams;
      const code = randomBytes(12).toString('hex');
      codes.set(code, { claims, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      return back;
    },
    /* An access token for `claims`, as if a client finished its own sign-in
       here (the MCP door, Feature #254): userinfo answers for it. `jwt`
       mints it JWT-shaped with these extra claims (a client_id, say); the
       default is opaque, as Clerk's are. */
    mint(claims, { jwt = null } = {}) {
      const access = jwt ? signJwt({ iss: issuer, sub: claims.sub, ...jwt }, { privateKey }) : randomBytes(16).toString('hex');
      codes.set(`access:${access}`, { claims });
      return access;
    },
    stop: () => server.close(),
  };
}

export const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

/* `w` served on a free port with `idp` as its door C (none when configured is
   false); the other options reach startServer. call() never follows a
   redirect. signIn() is one trip: start at weave, sign in at the provider,
   come back. stop() closes the server and the provider. */
export async function serveOidc(w, idp, { configured = true, ...options } = {}) {
  const oidc = configured ? createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' }) : null;
  const { server } = await startServer(w, { port: 0, origin: null, oidc, ...options });
  const port = server.address().port;
  // localhost, not 127.0.0.1: the loopback origin the callback comes back to.
  const base = `http://localhost:${port}`;
  const call = (method, path, { token, body, cookie, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const signIn = async (claims, { next, invite } = {}) => {
    const q = new URLSearchParams({ ...(next ? { next } : {}), ...(invite ? { invite } : {}) }).toString();
    const start = await call('GET', `/api/auth/oidc/start${q ? `?${q}` : ''}`);
    const authorize = start.headers.get('location');
    const trip = cookieOf(start);
    const back = idp.approve(authorize, claims);
    const res = await call('GET', back.pathname + back.search, { cookie: trip });
    return { start, authorize, back, trip, res, cookie: cookieOf(res) };
  };
  return { port, base, call, signIn, stop: () => { server.close(); idp.stop(); } };
}
