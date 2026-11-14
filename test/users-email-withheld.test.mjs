import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { withViewers } = await import('../src/access.js');
const { startServer } = await import('../src/server.js');

const ISS = 'https://idp.test';
const addresses = (text) => String(text).match(/[\w.+-]+@example\.com/g) ?? [];
const PRIVATE = ['Email', 'Identities'];
const users = (w) => w.getTable('System/Users');

function workspace() {
  const w = new Weave({ actor: 'kyle' });
  w.inviteIssuer = ISS;
  const architect = w.createAccount({ name: 'arch', role: 'architect' });
  w.redeemIdentityInvite(w.linkIdentity('arch', { issuer: ISS }).code, { issuer: ISS, subject: 'user_arch' });
  w.accountForIdentity({ issuer: ISS, subject: 'user_arch', email: 'arch@example.com' });
  const editor = w.createAccount({ name: 'ed', role: 'editor' });
  const observer = w.createAccount({ name: 'ob', role: 'observer' });
  w.inviteMember({ email: 'dana@example.com', role: 'editor', issuer: ISS });
  w.createSpace({ name: 'Work' });
  const tasks = w.createTable({ space: 'Work', name: 'Tasks' });
  const owner = w.addRelation(tasks.id, { name: 'Owner', targetDb: users(w).id, cardinality: 'many-to-one', inverseName: 'Owned' });
  w.addField(tasks.id, { name: 'Owner Email', type: 'lookup', config: { relationField: owner.field.id, targetField: 'Email' } });
  const dana = w.findEntity(users(w).id, 'dana');
  w.createEntity(tasks.id, { name: 'a task', values: { Owner: dana.id } });
  const arch = w.findEntity(users(w).id, 'arch');
  const as = {
    observer: (fn) => w.asAccount(observer.account, fn),
    editor: (fn) => w.asAccount(editor.account, fn),
    anonymous: (fn) => withViewers({ of: () => undefined }, fn),
    architect: (fn) => w.asAccount(architect.account, fn),
    owner: (fn) => fn(),
  };
  const tokens = { architect: architect.token, editor: editor.token, observer: observer.token };
  return { w, t: users(w), tasks, arch, dana, as, tokens };
}

const BELOW = ['observer', 'editor', 'anonymous'];
const ABOVE = ['architect', 'owner'];
const privateActivity = (list) => list.filter((a) => a.kind === 'field-updated' && PRIVATE.includes(a.detail?.field));

test('engine: observer, editor and anonymous reads of System/Users carry no Email and no Identities (Issue #1571)', () => {
  const s = workspace();
  for (const who of BELOW) {
    const read = s.as[who];
    const rows = read(() => s.w.query(s.t.id).items);
    assert.equal(rows.length, 4, `${who} lists every seat and invite`);
    for (const row of rows) {
      for (const n of PRIVATE) {
        assert.ok(!(n in row.fields), `${who}: ${row.name} fields carry no ${n}`);
        assert.ok(!(n in row.raw), `${who}: ${row.name} raw carries no ${n}`);
      }
    }
    assert.deepEqual(addresses(JSON.stringify(rows)), [], `${who}: query rows carry no address`);
    const one = read(() => s.w.readEntity(s.arch.id));
    assert.equal(one.fields.Role, 'Architect', `${who} still reads the seat`);
    assert.deepEqual(privateActivity(one.activity), [], `${who}: the record's history names no Email or Identities change`);
    assert.deepEqual(addresses(JSON.stringify(one)), [], `${who}: the entity carries no address`);
    assert.deepEqual(addresses(JSON.stringify(read(() => s.w.readEntity(s.dana.id)))), [], `${who}: the invite carries no address`);
    const picked = read(() => s.w.query(s.t.id, { fields: PRIVATE }).items);
    assert.ok(picked.every((r) => PRIVATE.every((n) => !(n in r.fields))), `${who}: asking for the fields by name gets none`);
    const selected = read(() => s.w.query(s.t.id, { select: ['Name', ...PRIVATE] }).items);
    assert.ok(selected.every((r) => r.Email == null && r.Identities == null), `${who}: a select reads them empty`);
    assert.equal(read(() => s.w.query(s.t.id, { where: [['Email', 'contains', 'arch@']] }).total), 0, `${who}: a filter on Email matches nothing`);
    assert.equal(read(() => s.w.query(s.t.id, { where: [['Identities', '>', 0]] }).total), 0, `${who}: a filter on Identities matches nothing`);
    assert.equal(read(() => s.w.query(s.t.id, { search: 'example.com' }).total), 0, `${who}: a search inside the table finds no address`);
    const through = read(() => s.w.query(s.tasks.id, { select: ['Owner.Email'] }).items);
    assert.equal(through[0]['Owner.Email'], null, `${who}: a path through a relation reads it empty`);
    assert.equal(read(() => s.w.query(s.tasks.id, { where: [['Owner.Email', 'contains', 'dana@']] }).total), 0, `${who}: a filter through a relation matches nothing`);
    const task = read(() => s.w.query(s.tasks.id).items[0]);
    assert.ok(!task.fields['Owner Email'], `${who}: a lookup of Email reads empty`);
    assert.deepEqual(addresses(JSON.stringify(task)), [], `${who}: the task, its chip and card included, carries no address`);
    const csv = read(() => s.w.exportCSV(s.t.id));
    assert.deepEqual(addresses(csv), [], `${who}: the CSV export carries no address`);
    assert.deepEqual(csv.split('\n')[0].split(',').filter((c) => PRIVATE.includes(c)), [], `${who}: the CSV export has no Email or Identities column`);
    assert.deepEqual(read(() => s.w.search('example.com', { table: s.t.id })), [], `${who}: search finds no row by its address`);
    assert.deepEqual(addresses(JSON.stringify(read(() => s.w.universalSearch('example.com')))), [], `${who}: universal search shows no address`);
    for (const shape of ['card', 'chip']) {
      const card = read(() => s.w.renderView(s.arch.id, shape));
      assert.deepEqual(card.fields.filter((f) => PRIVATE.includes(f.label)), [], `${who}: the ${shape} shows no Email or Identities`);
    }
    assert.deepEqual(addresses(JSON.stringify(read(() => s.w.previewFields(s.dana.id)))), [], `${who}: the hover preview shows no address`);
    const feed = read(() => s.w.activityFeed({ tableRef: s.t.id, limit: -1 })).items;
    assert.deepEqual(privateActivity(feed), [], `${who}: the activity feed names no Email or Identities change`);
    assert.deepEqual(addresses(JSON.stringify(feed)), [], `${who}: the activity feed carries no address`);
    const stats = read(() => s.w.tableStats(s.t.id)).columns.map((c) => c.name);
    assert.deepEqual(stats.filter((n) => PRIVATE.includes(n)), [], `${who}: table stats describe no Email or Identities column`);
    const dump = read(() => s.w.exportJSON({ blobs: false }));
    const privateIds = Object.values(dump.tables[s.t.id].fields).filter((f) => PRIVATE.includes(f.name)).map((f) => f.id);
    for (const e of Object.values(dump.entities).filter((x) => x.dbId === s.t.id)) {
      assert.deepEqual(privateIds.filter((id) => id in e.values), [], `${who}: the JSON export holds no Email or Identities value`);
      assert.deepEqual(privateActivity(e.activity ?? []), [], `${who}: the JSON export holds no Email or Identities history`);
    }
  }
});

test('engine: architect and owner reads of System/Users carry Email and Identities, invites included (Issue #1571)', () => {
  const s = workspace();
  for (const who of ABOVE) {
    const read = s.as[who];
    const arch = read(() => s.w.readEntity(s.arch.id));
    assert.equal(arch.fields.Email, 'arch@example.com', `${who} reads the member's address`);
    assert.equal(arch.raw.Identities, 1, `${who} reads the identity count`);
    assert.deepEqual(privateActivity(arch.activity).map((a) => a.detail.field).sort(), PRIVATE, `${who} reads the record's history in full`);
    assert.equal(read(() => s.w.readEntity(s.dana.id)).fields.Email, 'dana@example.com', `${who} reads the invitee's address`);
    const selected = read(() => s.w.query(s.t.id, { select: ['Email'] }).items).map((r) => r.Email).filter(Boolean).sort();
    assert.deepEqual(selected, ['arch@example.com', 'dana@example.com'], `${who}: a select reads both addresses`);
    assert.equal(read(() => s.w.query(s.t.id, { where: [['Email', 'contains', 'arch@']] }).total), 1, `${who}: a filter on Email finds the member`);
    assert.equal(read(() => s.w.query(s.tasks.id, { select: ['Owner.Email'] }).items[0]['Owner.Email']), 'dana@example.com', `${who}: a path through a relation reads it`);
    assert.equal(read(() => s.w.query(s.tasks.id).items[0]).fields['Owner Email'], 'dana@example.com', `${who}: a lookup of Email reads it`);
    const csv = read(() => s.w.exportCSV(s.t.id));
    assert.match(csv, /arch@example\.com/);
    assert.match(csv, /dana@example\.com/);
    assert.deepEqual(csv.split('\n')[0].split(',').filter((c) => PRIVATE.includes(c)), PRIVATE, `${who}: the CSV export keeps both columns`);
    assert.equal(read(() => s.w.search('example.com', { table: s.t.id })).length, 2, `${who}: search finds both rows by address`);
    assert.ok(read(() => s.w.renderView(s.arch.id, 'card')).fields.some((f) => f.label === 'Email'), `${who}: the card shows the address`);
    const feed = read(() => s.w.activityFeed({ tableRef: s.t.id, limit: -1 })).items;
    assert.ok(privateActivity(feed).some((a) => a.detail.to === 'arch@example.com'), `${who}: the activity feed keeps the address change`);
    const stats = read(() => s.w.tableStats(s.t.id)).columns.map((c) => c.name);
    assert.deepEqual(stats.filter((n) => PRIVATE.includes(n)), PRIVATE, `${who}: table stats describe both columns`);
  }
});

test('engine: a cached filter or sort on Email answers each reader by role (Issue #1571)', () => {
  const s = workspace();
  const where = { where: [['Email', 'contains', 'arch@']] };
  assert.equal(s.as.architect(() => s.w.query(s.t.id, where).total), 1);
  assert.equal(s.as.observer(() => s.w.query(s.t.id, where).total), 0, 'the architect\'s cached hits do not reach the observer');
  assert.equal(s.as.architect(() => s.w.query(s.t.id, where).total), 1, 'the observer\'s empty answer does not reach the architect');
  const sort = { sort: [{ field: 'Email', dir: 'desc' }], select: ['Name'] };
  const names = (who) => s.as[who](() => s.w.query(s.t.id, sort).items.map((r) => r.name));
  assert.deepEqual(names('architect').slice(0, 2), ['dana', 'arch'], 'an architect sorts by address');
  assert.deepEqual(names('observer'), ['arch', 'ed', 'ob', 'dana'], 'an observer\'s sort by Email keeps record order');
});

test('engine: weave export carries no address anywhere, the Users rows\' history included (Issue #1745)', () => {
  const s = workspace();
  const dump = JSON.stringify(s.w.exportJSON({ blobs: false }));
  assert.deepEqual(addresses(dump), []);
});

test('http: observer, editor and anonymous requests read Users without Email; an architect token reads it (Issue #1571)', async () => {
  const s = workspace();
  const { server } = await startServer(s.w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token = null, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, text: await res.text() };
  };
  const reads = (token) => [
    call('GET', `/api/tables/${s.t.id}/entities`, { token }),
    call('GET', `/api/entities/${s.arch.id}`, { token }),
    call('GET', `/api/tables/${s.t.id}/export.csv`, { token }),
    call('GET', '/api/search?q=example.com', { token }),
    ...(token ? [
      call('POST', `/api/tables/${s.t.id}/query`, { token, body: {} }),
      call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_get_entity', arguments: { entity: s.arch.id } } } }),
    ] : []),
  ];
  try {
    for (const [who, token] of [['observer', s.tokens.observer], ['editor', s.tokens.editor], ['anonymous', null]]) {
      for (const res of await Promise.all(reads(token))) {
        assert.equal(res.status, 200, `${who}: ${res.text.slice(0, 200)}`);
        assert.deepEqual(addresses(res.text), [], `${who} reads no address`);
      }
    }
    const [rows, one, csv, , query, mcp] = await Promise.all(reads(s.tokens.architect));
    assert.match(rows.text, /arch@example\.com/);
    assert.match(rows.text, /dana@example\.com/);
    assert.match(one.text, /arch@example\.com/);
    assert.match(csv.text, /dana@example\.com/);
    assert.match(query.text, /dana@example\.com/);
    assert.match(mcp.text, /arch@example\.com/);
  } finally { server.close(); }
});
