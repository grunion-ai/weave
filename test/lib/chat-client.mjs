import { createHash, randomBytes } from 'node:crypto';

export const CHAT_APPS = {
  claude: { name: 'Claude', redirect: 'https://claude.ai/api/mcp/auth_callback', ua: 'Claude-User' },
  chatgpt: { name: 'ChatGPT', redirect: 'https://chatgpt.com/connector_platform_oauth_redirect', ua: 'openai-mcp/1.0.0' },
};

export async function connectLikeChatApp(mcpUrl, app = CHAT_APPS.claude) {
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
    body: JSON.stringify({ client_name: app.name, redirect_uris: [app.redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (reg.status !== 201) throw new Error(`registration answered ${reg.status}`);
  const { client_id: clientId } = await reg.json();
  trace.push('registered');

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(8).toString('hex');
  const auth = new URL(asMeta.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: app.redirect, state, resource: mcpUrl,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    scope: (resource.scopes_supported ?? ['openid']).join(' '),
  })) auth.searchParams.set(k, v);
  const consent = await fetch(auth, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location') ?? 'about:blank');
  if (back.searchParams.get('state') !== state || !back.searchParams.get('code')) throw new Error(`sign-in did not return a code (${consent.status} ${back.href})`);
  trace.push('authorized');

  const tok = await fetch(asMeta.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: app.redirect, client_id: clientId, code_verifier: verifier, resource: mcpUrl }),
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
