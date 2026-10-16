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

export async function startIdp({ clientId = 'weave-client', clientSecret = 's3cret', claimsInIdToken = true, endSession = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map();
  const seen = { token: [], userinfo: 0, discovery: 0, jwks: 0, registered: [], authorized: 0 };
  const clients = new Map();
  let issuer = '';
  let tamper = null;
  let browserLogin = null;
  const grant = (q, claims) => {
    const code = randomBytes(12).toString('hex');
    codes.set(code, { claims, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), clientId: q.get('client_id') });
    const back = new URL(q.get('redirect_uri'));
    back.searchParams.set('code', code);
    if (q.get('state') != null) back.searchParams.set('state', q.get('state'));
    return back;
  };

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
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        ...(endSession ? { end_session_endpoint: `${issuer}/oauth/logout` } : {}),
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'], response_types_supported: ['code'] });
    }
    if (url.pathname === '/oauth/register' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const meta = JSON.parse(raw || '{}');
      if (!Array.isArray(meta.redirect_uris) || !meta.redirect_uris.length) return json(400, { error: 'invalid_redirect_uri' });
      const id = `dyn_${randomBytes(6).toString('hex')}`;
      clients.set(id, { redirectUris: meta.redirect_uris, name: meta.client_name ?? null });
      seen.registered.push({ id, name: meta.client_name ?? null });
      return json(201, { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: meta.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
    }
    if (url.pathname === '/oauth/authorize' && req.method === 'GET') {
      seen.authorized += 1;
      const q = url.searchParams;
      const dyn = clients.get(q.get('client_id'));
      if (q.get('client_id') !== clientId && !dyn) return json(400, { error: 'invalid_client' });
      if (dyn && !dyn.redirectUris.includes(q.get('redirect_uri'))) return json(400, { error: 'invalid_redirect_uri' });
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return json(400, { error: 'invalid_request', error_description: 'PKCE S256 required' });
      if (!browserLogin) return json(401, { error: 'login_required' });
      if (browserLogin.deny) {
        const back = new URL(q.get('redirect_uri'));
        back.searchParams.set('error', 'access_denied');
        if (q.get('state') != null) back.searchParams.set('state', q.get('state'));
        res.writeHead(302, { Location: back.href });
        return res.end();
      }
      res.writeHead(302, { Location: grant(q, browserLogin).href });
      return res.end();
    }
    if (url.pathname === '/npm/@clerk/clerk-js@6/dist/clerk.browser.js') {
      seen.clerkScript = (seen.clerkScript ?? 0) + 1;
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' });
      return res.end(`window.Clerk = { user: null, load: async () => {}, unmountSignIn: (el) => el.replaceChildren(), mountSignIn: (el, o) => {
        window.__clerkOptions = o;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Continue with Google';
        b.dataset.fakeClerk = 'google';
        b.onclick = () => { location.href = o.forceRedirectUrl; };
        el.replaceChildren(b);
      } };`);
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
      const publicClient = clients.has(id) && !secret;
      if (!publicClient && (id !== clientId || secret !== clientSecret)) return json(401, { error: 'invalid_client' });
      if (!grant || form.get('grant_type') !== 'authorization_code') return json(400, { error: 'invalid_grant' });
      if (publicClient && grant.clientId !== id) return json(400, { error: 'invalid_grant', error_description: 'code was issued to another client' });
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
    get publishableKey() { return `pk_test_${Buffer.from(`${new URL(issuer).host}$`).toString('base64')}`; },
    tamper: (what) => { tamper = what; },
    signInBrowserAs: (claims) => { browserLogin = claims; },
    approve(authorizeUrl, claims) {
      return grant(new URL(authorizeUrl).searchParams, claims);
    },
    mint(claims, { jwt = null } = {}) {
      const access = jwt ? signJwt({ iss: issuer, sub: claims.sub, ...jwt }, { privateKey }) : randomBytes(16).toString('hex');
      codes.set(`access:${access}`, { claims });
      return access;
    },
    stop: () => server.close(),
  };
}

export const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

export async function serveOidc(w, idp, { configured = true, ...options } = {}) {
  const oidc = configured ? createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' }) : null;
  const { server } = await startServer(w, { port: 0, origin: null, oidc, ...options });
  const port = server.address().port;
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
