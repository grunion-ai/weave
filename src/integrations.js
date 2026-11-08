import { isIP } from 'node:net';
import { WeaveError } from './store.js';

export const INTEGRATIONS_DESCRIPTION = 'Every outside tool this workspace talks to with an API key, as a row: its provider, the one host its key may reach, whether the key works and when it was last used. The key goes in once, is tested on save and never comes back out: weave keeps only its last four characters as a hint.';
export const INTEGRATION_PROVIDERS = ['Fibery', 'Generic API key'];
export const INTEGRATION_STATES = [
  { name: 'Setup incomplete', category: 'not-started', default: true },
  { name: 'Checking', category: 'in-progress' },
  { name: 'Connected', category: 'done' },
  { name: 'Failed', category: 'canceled' },
];
export const INTEGRATION_COLUMNS = [
  ['On', 'toggle', { on: 'On', off: 'Off' }],
  ['Provider', 'select', { options: INTEGRATION_PROVIDERS.map((name) => ({ name, hue: 'slate' })) }],
  ['Host', 'text', {}],
  ['Credential', 'key', { kind: 'apikey', keystore: 'local' }],
  ['Key Hint', 'text', {}],
  ['State', 'workflow', { states: INTEGRATION_STATES }],
  ['Connected As', 'text', {}],
  ['Health Reason', 'text', {}],
  ['Last Checked', 'date', { time: true }],
  ['Last Used', 'date', { time: true }],
];
export const INTEGRATION_KEPT = ['Credential', 'Key Hint', 'State', 'Connected As', 'Health Reason', 'Last Checked', 'Last Used'];
export const INTEGRATION_KEY_PREFIX = 'integration:';
export const integrationKeyName = (rowId) => `${INTEGRATION_KEY_PREFIX}${rowId}`;
export const isIntegrationKey = (name) => String(name ?? '').startsWith(INTEGRATION_KEY_PREFIX);
export const HINT_MIN_LENGTH = 16;
export const SECRET_MAX_LENGTH = 4096;
export const CHECK_TIMEOUT_MS = 10000;

export function refuseIntegrationKey(name) {
  if (isIntegrationKey(name)) {
    throw new WeaveError(`'${name}' belongs to a System/Integrations row: its key is set with Replace on that row and is never read back`, 'forbidden');
  }
}

export function ensureIntegrationColumns(w, t) {
  const has = (name) => Object.values(t.fields).some((f) => f.name === name);
  for (const [name, type, config] of INTEGRATION_COLUMNS) {
    if (!has(name)) w.addField(t.id, { name, type, config }).system = true;
  }
}

export function integrationHost(raw, provider = null) {
  let text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('://')) {
    let u;
    try { u = new URL(text); } catch { throw new WeaveError(`Host '${raw}' is not a host name`, 'invalid'); }
    if (u.protocol !== 'https:') throw new WeaveError('An integration only talks https: give the Host as a name such as acme.fibery.io', 'invalid');
    if (u.username || u.password || u.port || (u.pathname && u.pathname !== '/') || u.search || u.hash) {
      throw new WeaveError(`Host '${raw}' carries more than a host name: give just the name, such as acme.fibery.io`, 'invalid');
    }
    text = u.hostname;
  }
  text = text.replace(/\.$/, '');
  if (isIP(text.replace(/^\[|\]$/g, ''))) throw new WeaveError('An integration Host is a name, never an IP address', 'invalid');
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(text)) {
    throw new WeaveError(`Host '${raw}' is not a host name such as acme.fibery.io`, 'invalid');
  }
  if (provider === 'Fibery' && !text.endsWith('.fibery.io')) {
    throw new WeaveError(`A Fibery Host ends in .fibery.io, such as acme.fibery.io ('${text}' does not)`, 'invalid');
  }
  return text;
}

export function cleanSecret(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new WeaveError('Paste the key: an empty value is not a credential', 'invalid');
  if (s.length > SECRET_MAX_LENGTH) throw new WeaveError(`A key is at most ${SECRET_MAX_LENGTH} characters`, 'invalid');
  if (/[\u0000-\u001f\u007f\s]/.test(s)) throw new WeaveError('A key holds no spaces, line breaks or control characters: copy it again', 'invalid');
  return s;
}

export const keyHint = (secret) => (secret.length >= HINT_MIN_LENGTH ? `…${secret.slice(-4)}` : 'set');

export function redact(text, secret) {
  if (text == null || !secret) return text;
  return String(text).split(secret).join('••••');
}

export function authHeader(provider, secret) {
  return provider === 'Fibery' ? `Token ${secret}` : `Bearer ${secret}`;
}

export function checkRequest(provider, host, secret) {
  const headers = { Authorization: authHeader(provider, secret), Accept: 'application/json' };
  if (provider === 'Fibery') {
    return {
      url: `https://${host}/api/commands`,
      init: {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ command: 'fibery.entity/query', args: { query: {
          'q/from': 'fibery/user', 'q/select': ['user/name', 'user/email'], 'q/where': ['=', ['fibery/id'], '$my-id'], 'q/limit': 1,
        } } }]),
      },
    };
  }
  return { url: `https://${host}/`, init: { method: 'GET', headers } };
}

export async function readCheck(provider, host, res) {
  const label = provider === 'Fibery' ? 'Fibery' : host;
  if (res.status >= 300 && res.status < 400) return { ok: false, reason: `${label} answered with a redirect (HTTP ${res.status}); weave never follows a redirect with a key` };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `${label} refused the key (HTTP ${res.status})` };
  if (provider !== 'Fibery') {
    return res.status >= 500 ? { ok: false, reason: `${label} answered HTTP ${res.status}` } : { ok: true, connectedAs: null };
  }
  if (!res.ok) return { ok: false, reason: `Fibery answered HTTP ${res.status}` };
  let user = null;
  try {
    const out = await res.json();
    user = out?.[0]?.success ? out[0].result?.[0] : null;
  } catch {}
  if (!user) return { ok: false, reason: 'Fibery answered without the current user: is this a Fibery API token?' };
  const name = typeof user['user/name'] === 'string' ? user['user/name'].trim() : '';
  const email = typeof user['user/email'] === 'string' ? user['user/email'].trim() : '';
  return { ok: true, connectedAs: (name || email || null)?.slice(0, 200) ?? null };
}

export function unreachable(host, err) {
  const code = err?.cause?.code ?? err?.code ?? err?.name ?? 'error';
  return code === 'TimeoutError' ? `${host} did not answer within ${CHECK_TIMEOUT_MS / 1000} s` : `Could not reach ${host} (${code})`;
}
