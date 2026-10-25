import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export const CHAT_APPS = {
  claude: { name: 'Claude', redirect: 'https://claude.ai/api/mcp/auth_callback', ua: 'Claude-User' },
  chatgpt: { name: 'ChatGPT', redirect: 'https://chatgpt.com/connector_platform_oauth_redirect', ua: 'openai-mcp/1.0.0' },
};

export async function beginConnect(mcpUrl, app = CHAT_APPS.claude, redirect = app.redirect) {
  const trace = [];
  const rpc = async (token, method, params, id = trace.length + 1) => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': app.ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id != null ? { id } : {}), method, ...(params ? { params } : {}) }),
    });
    trace.push(`${method} ${res.status}`);
    return res;
  };

  const challenge = await rpc(null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: app.name, version: '1' } });
  if (challenge.status !== 401) throw new Error(`expected 401 from an anonymous initialize, got ${challenge.status}`);
  const metaUrl = /resource_metadata="([^"]+)"/.exec(challenge.headers.get('www-authenticate') ?? '')?.[1];
  if (!metaUrl) throw new Error('the 401 named no resource_metadata');
  const resource = await (await fetch(metaUrl)).json();
  if (resource.resource !== mcpUrl) throw new Error(`resource ${resource.resource} is not the URL the person pasted (${mcpUrl})`);
  const as = resource.authorization_servers[0];
  const asMeta = await fetch(`${as}/.well-known/oauth-authorization-server`).then((r) => (r.ok ? r.json() : null))
    ?? await fetch(`${as}/.well-known/openid-configuration`).then((r) => r.json());
  if (!asMeta.code_challenge_methods_supported?.includes('S256')) throw new Error('the authorization server does not offer S256');
  if (!asMeta.registration_endpoint) throw new Error('the authorization server offers no dynamic client registration');
  trace.push('discovered');

  const reg = await fetch(asMeta.registration_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: app.name, redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (reg.status !== 201) throw new Error(`registration answered ${reg.status}`);
  const { client_id: clientId } = await reg.json();
  trace.push('registered');

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(8).toString('hex');
  const auth = new URL(asMeta.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: redirect, state, resource: mcpUrl,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    scope: (resource.scopes_supported ?? ['openid']).join(' '),
  })) auth.searchParams.set(k, v);

  async function finish(code) {
    const tok = await fetch(asMeta.token_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: mcpUrl }),
    });
    if (!tok.ok) throw new Error(`token exchange answered ${tok.status} ${await tok.text()}`);
    const { access_token: token } = await tok.json();
    trace.push('token');

    const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: app.name, version: '1' } });
    if (init.status !== 200) throw new Error(`initialize answered ${init.status}`);
    await rpc(token, 'notifications/initialized', undefined, null);
    const list = await (await rpc(token, 'tools/list')).json();
    const names = (list.result?.tools ?? []).map((t) => t.name);
    const call = await (await rpc(token, 'tools/call', { name: 'weave_schema', arguments: {} })).json();
    return { trace, clientId, tools: names, schema: call.result, token };
  }

  return { trace, clientId, state, authorize: auth.href, finish };
}

export async function connectLikeChatApp(mcpUrl, app = CHAT_APPS.claude) {
  const flow = await beginConnect(mcpUrl, app);
  const consent = await fetch(flow.authorize, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location') ?? 'about:blank');
  if (back.searchParams.get('state') !== flow.state || !back.searchParams.get('code')) throw new Error(`sign-in did not return a code (${consent.status} ${back.href})`);
  flow.trace.push('authorized');
  return flow.finish(back.searchParams.get('code'));
}

const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const doc = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${attr(title)}</title><body style="font-family:system-ui;margin:24px">${body}</body>`;

export async function startConnectorPage(app = CHAT_APPS.claude) {
  const pending = new Map();
  const connected = [];
  let origin = '';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const send = (status, body, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
    try {
      if (url.pathname === '/connectors' && req.method === 'GET') {
        return send(200, doc(`${app.name}: connectors`, `<h1>Add custom connector</h1><form method="post" action="/connectors"><label>Remote MCP server URL <input name="url" type="url" required></label> <button id="add" type="submit">Add</button></form>`));
      }
      if (url.pathname === '/connectors' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const flow = await beginConnect(new URLSearchParams(raw).get('url'), app, `${origin}/api/mcp/auth_callback`);
        pending.set(flow.state, flow);
        return send(200, doc(`${app.name}: weave`, `<h1>weave</h1><p>You started connecting to weave but didn't finish.</p><button id="connect" type="button" data-href="${attr(flow.authorize)}">Connect</button><script>document.getElementById('connect').onclick = (e) => window.open(e.currentTarget.dataset.href, '_blank');</script>`));
      }
      if (url.pathname === '/api/mcp/auth_callback') {
        const flow = pending.get(url.searchParams.get('state'));
        pending.delete(url.searchParams.get('state'));
        if (!flow || !url.searchParams.get('code')) return send(400, doc('Not connected', `<h1 data-error="${attr(url.searchParams.get('error') ?? 'state')}">Not connected</h1>`));
        flow.trace.push('authorized');
        const done = await flow.finish(url.searchParams.get('code'));
        connected.push(done);
        return send(200, doc(`${app.name}: weave connected`, `<h1 data-connected="${done.tools.length}">weave connected</h1>`));
      }
      return send(404, 'not found', 'text/plain');
    } catch (err) {
      return send(500, String(err.stack ?? err), 'text/plain');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/connectors`, origin, connected, stop: () => server.close() };
}
