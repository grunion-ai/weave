import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { keyHint, integrationHost } = await import('../src/integrations.js');

const SECRET = 'fib_live_7Hq2ZpW9xLr4Ks8Vd3Mn5Tb6';
const OTHER = 'fib_live_A1b2C3d4E5f6G7h8I9j0K1zz';

function fresh() {
  const keystorePath = join(tempDir('weave-int-'), 'keystore.json');
  const w = new Weave({ actor: 'kyle', keystorePath });
  return { w, keystorePath, t: w.getTable('System/Integrations') };
}

function intercept(answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const fiberyUser = (name = 'Kyle Adriany', email = 'kyle@example.com') => () => new Response(JSON.stringify([{ success: true, result: [{ 'user/name': name, 'user/email': email }] }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
const status = (code) => () => new Response('nope', { status: code });

function fibery(w, t, name = 'Fibery adriany', host = 'adriany.fibery.io') {
  return w.createEntity(t.id, { name, values: { Provider: 'Fibery', Host: host } });
}

const read = (w, id) => w.readEntity(id);

test('System/Integrations is a system table in the System space with the spec columns', () => {
  const { w, t } = fresh();
  assert.equal(t.system, 'integrations');
  assert.equal(w.getSpace(t.spaceId).system, 'workspace');
  const byName = Object.fromEntries(Object.values(t.fields).map((f) => [f.name, f]));
  for (const [n, type] of [['Name', 'text'], ['On', 'toggle'], ['Provider', 'select'], ['Host', 'text'], ['Credential', 'key'], ['Key Hint', 'text'], ['State', 'workflow'], ['Connected As', 'text'], ['Health Reason', 'text'], ['Last Checked', 'date'], ['Last Used', 'date'], ['Workspace', 'relation']]) {
    assert.equal(byName[n]?.type, type, `${n} is a ${type}`);
    assert.equal(byName[n].system, true, `${n} is a system column`);
  }
  assert.deepEqual(byName.Provider.config.options.map((o) => o.name), ['Fibery', 'Generic API key']);
  assert.deepEqual(byName.State.config.states.map((s) => s.name), ['Setup incomplete', 'Checking', 'Connected', 'Failed']);
  assert.ok(w.findEntity('System/Tables', 'Integrations'), 'the table is a registry row like every other');
  assert.throws(() => w.deleteTable(t.id), /system/i);
});

test('a new row starts On, Setup incomplete, in its own workspace, with its Host reduced to a name', () => {
  const { w, t } = fresh();
  const e = w.createEntity(t.id, { name: 'Fibery', values: { Provider: 'Fibery', Host: 'https://Adriany.fibery.io/' } });
  const r = read(w, e.id);
  assert.equal(r.fields.On, true);
  assert.equal(r.fields.State, 'Setup incomplete');
  assert.equal(r.fields.Host, 'adriany.fibery.io');
  assert.equal(r.fields.Workspace, w.readEntity(w.listEntities('System/Workspaces')[0].id).name);
  assert.equal(r.fields['Key Hint'] ?? null, null);
});

test('Host is a bare https host name; a Fibery Host ends in .fibery.io', () => {
  const { w, t } = fresh();
  for (const bad of ['http://adriany.fibery.io', 'https://adriany.fibery.io/api', 'https://u:p@adriany.fibery.io', 'https://adriany.fibery.io:8443', '10.0.0.1', '[::1]', 'localhost', 'not a host']) {
    assert.throws(() => w.createEntity(t.id, { name: bad, values: { Provider: 'Generic API key', Host: bad } }), { code: 'invalid' }, bad);
  }
  assert.throws(() => fibery(w, t, 'x', 'api.airtable.com'), /\.fibery\.io/);
  assert.equal(integrationHost('API.Airtable.com.', 'Generic API key'), 'api.airtable.com');
});

test('weave keeps the credential and status columns: a row write that sets them is refused', () => {
  const { w, t } = fresh();
  assert.throws(() => w.createEntity(t.id, { name: 'x', values: { Credential: SECRET } }), /never goes into a row/);
  const e = fibery(w, t);
  for (const [k, v] of [['Credential', SECRET], ['Key Hint', '…1234'], ['State', 'Connected'], ['Connected As', 'me'], ['Health Reason', 'ok'], ['Last Checked', '2026-11-08'], ['Last Used', '2026-11-08']]) {
    assert.throws(() => w.updateEntity(e.id, { [k]: v }), { code: 'invalid' }, k);
  }
  assert.doesNotThrow(() => w.updateEntity(e.id, { Name: 'Renamed', On: false, Credential: null, 'Key Hint': '' }), 'blanks are no-ops');
  assert.equal(read(w, e.id).fields.Name, 'Renamed');
  assert.equal(JSON.stringify(w.state).includes(SECRET), false);
});

test('a key tests green against Fibery: sealed, hinted, Connected, and the check went only to the row Host', async () => {
  const { w, t, keystorePath } = fresh();
  const e = fibery(w, t);
  const net = intercept(fiberyUser());
  try {
    const out = await w.setIntegrationCredential(e.id, `  ${SECRET}\n`);
    assert.equal(out.connected, true);
  } finally { net.restore(); }
  assert.equal(net.calls.length, 1);
  const [call] = net.calls;
  assert.equal(call.url, 'https://adriany.fibery.io/api/commands');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, `Token ${SECRET}`);
  assert.equal(call.init.redirect, 'manual');
  assert.match(call.init.body, /\$my-id/);
  const r = read(w, e.id);
  assert.equal(r.fields.State, 'Connected');
  assert.equal(r.fields['Connected As'], 'Kyle Adriany');
  assert.equal(r.fields['Key Hint'], `…${SECRET.slice(-4)}`);
  assert.ok(r.fields['Last Checked']);
  assert.equal(r.raw.Credential ?? r.fields.Credential, `integration:${e.id}`);
  assert.equal(w.hasKey(`integration:${e.id}`), true);
  assert.equal(readFileSync(keystorePath, 'utf8').includes(SECRET), false, 'the keystore holds ciphertext only');
});

test('a key that tests red is never stored: Failed with the reason, no hint', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  const net = intercept(status(401));
  try {
    const out = await w.setIntegrationCredential(e.id, SECRET);
    assert.equal(out.connected, false);
  } finally { net.restore(); }
  const r = read(w, e.id);
  assert.equal(r.fields.State, 'Failed');
  assert.match(r.fields['Health Reason'], /refused the key \(HTTP 401\)/);
  assert.equal(r.fields['Key Hint'] ?? null, null);
  assert.equal(w.hasKey(`integration:${e.id}`), false);
});

test('Replace keeps the old key until the new one tests green, then the new one takes its place', async () => {
  const { w, t, keystorePath } = fresh();
  const e = fibery(w, t);
  const ks = () => JSON.parse(readFileSync(keystorePath, 'utf8')).keys[`integration:${e.id}`];
  let net = intercept(fiberyUser());
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  const first = ks();
  net = intercept(status(403));
  try { await w.setIntegrationCredential(e.id, OTHER); } finally { net.restore(); }
  assert.deepEqual(ks(), first, 'a red replace leaves the stored key untouched');
  assert.match(read(w, e.id).fields['Health Reason'], /previous key is still stored/);
  assert.equal(read(w, e.id).fields['Key Hint'], `…${SECRET.slice(-4)}`);
  net = intercept(fiberyUser('Second'));
  try { await w.setIntegrationCredential(e.id, OTHER); } finally { net.restore(); }
  assert.notEqual(ks().ct, first.ct, 'the green replace sealed the new key over the old one');
  assert.ok(ks().rotatedAt);
  const r = read(w, e.id);
  assert.equal(r.fields['Key Hint'], `…${OTHER.slice(-4)}`);
  assert.equal(r.fields.State, 'Connected');
  assert.equal(r.fields['Connected As'], 'Second');
  assert.equal(r.fields['Health Reason'] ?? null, null);
});

test('a Generic API key tests with a bearer GET to the Host root: 401, 403, 5xx and redirects fail, any other answer connects', async () => {
  const { w, t } = fresh();
  const e = w.createEntity(t.id, { name: 'Airtable', values: { Provider: 'Generic API key', Host: 'api.airtable.com' } });
  for (const [code, state] of [[302, 'Failed'], [401, 'Failed'], [403, 'Failed'], [503, 'Failed'], [404, 'Connected'], [200, 'Connected']]) {
    const net = intercept(status(code));
    try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
    assert.equal(net.calls[0].url, 'https://api.airtable.com/');
    assert.equal(net.calls[0].init.method, 'GET');
    assert.equal(net.calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(read(w, e.id).fields.State, state, `HTTP ${code}`);
  }
});

test('an unreachable host fails with a reason that names the host, never the key', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  const net = intercept(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  const r = read(w, e.id);
  assert.equal(r.fields.State, 'Failed');
  assert.equal(r.fields['Health Reason'], 'Could not reach adriany.fibery.io (ENOTFOUND)');
});

test('a host that echoes the key back never lands it in Connected As', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  const net = intercept(fiberyUser(`stolen ${SECRET}`));
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  assert.equal(read(w, e.id).fields['Connected As'], 'stolen ••••');
  assert.equal(JSON.stringify(w.state).includes(SECRET), false);
});

test('a key needs a Provider and a Host first, and is a single token', async () => {
  const { w, t } = fresh();
  const bare = w.createEntity(t.id, { name: 'Bare' });
  await assert.rejects(w.setIntegrationCredential(bare.id, SECRET), /needs a Provider and a Host/);
  const e = fibery(w, t);
  for (const bad of ['', '   ', 'two words', 'line\nbreak', 'x'.repeat(5000)]) {
    await assert.rejects(w.setIntegrationCredential(e.id, bad), { code: 'invalid' }, JSON.stringify(bad).slice(0, 20));
  }
  await assert.rejects(w.setIntegrationCredential('nope', SECRET), { code: 'not-found' });
});

test('a short key shows no characters in its hint', () => {
  assert.equal(keyHint('abcd1234'), 'set');
  assert.equal(keyHint(SECRET), `…${SECRET.slice(-4)}`);
});

test('the keystore API refuses integration keys: no reveal, no resolve, no overwrite, no delete, no share', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  const net = intercept(fiberyUser());
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  const name = `integration:${e.id}`;
  assert.throws(() => w.revealKey(name), { code: 'forbidden' });
  assert.throws(() => w.revealKey(name, { via: 'copy' }), { code: 'forbidden' });
  assert.throws(() => w.resolveKey(name), { code: 'forbidden' });
  assert.throws(() => w.setKey(name, 'x'), { code: 'forbidden' });
  assert.throws(() => w.deleteKey(name), { code: 'forbidden' });
  assert.throws(() => w.grantKey(name, true), { code: 'forbidden' });
  assert.throws(() => w.revokeKey(name, 'x'), { code: 'forbidden' });
  assert.equal(w.listKeys().some((k) => k.name === name), false, 'the generic key list leaves it out');
  assert.equal(w.hasKey(name), true);
});

test('changing the Host or the Provider drops the key: it only ever reaches the host it was tested on', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  let net = intercept(fiberyUser());
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  w.updateEntity(e.id, { Name: 'Still here', On: false });
  assert.equal(w.hasKey(`integration:${e.id}`), true, 'other columns leave the key alone');
  w.updateEntity(e.id, { Host: 'other.fibery.io' });
  assert.equal(w.hasKey(`integration:${e.id}`), false);
  const r = read(w, e.id);
  assert.equal(r.fields.State, 'Setup incomplete');
  assert.equal(r.fields['Key Hint'] ?? null, null);
  assert.match(r.fields['Health Reason'], /Host or Provider changed/);
  net = intercept(fiberyUser());
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  w.updateEntity(e.id, { Provider: 'Generic API key' });
  assert.equal(w.hasKey(`integration:${e.id}`), false);
});

test('deleting the row deletes its key; a restored row comes back without one', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  const net = intercept(fiberyUser());
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  w.deleteEntity(e.id);
  assert.equal(w.hasKey(`integration:${e.id}`), false);
  w.restoreEntity(e.id);
  const r = read(w, e.id);
  assert.equal(r.fields.State, 'Setup incomplete');
  assert.equal(r.fields['Key Hint'] ?? null, null);
  const hard = fibery(w, t, 'Hard');
  const again = intercept(fiberyUser());
  try { await w.setIntegrationCredential(hard.id, SECRET); } finally { again.restore(); }
  w.deleteEntity(hard.id, { hard: true });
  assert.equal(w.hasKey(`integration:${hard.id}`), false);
});

test('key changes land in Activity and the audit log without the key', async () => {
  const { w, t } = fresh();
  const e = fibery(w, t);
  const net = intercept(fiberyUser());
  try { await w.setIntegrationCredential(e.id, SECRET); } finally { net.restore(); }
  const feed = w.getActivity(e.id);
  assert.ok(JSON.stringify(feed).includes('Connected'), 'the State change is on the row record');
  const audit = w.listAudit({ limit: 50 });
  const set = audit.items?.find?.((a) => a.action === 'key-set') ?? audit.find?.((a) => a.action === 'key-set');
  assert.ok(set, 'a key-set audit entry');
  assert.equal(set.detail.integration, 'Fibery adriany');
  assert.equal(JSON.stringify(feed).includes(SECRET) || JSON.stringify(audit).includes(SECRET), false);
});
