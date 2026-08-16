import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave, parseCSV } from '../src/engine.js';
import { startServer } from '../src/server.js';

test('parseCSV handles quotes, commas, newlines', () => {
  const rows = parseCSV('a,b\n"x, y","line1\nline2"\n"quo""te",plain\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'line1\nline2'], ['quo"te', 'plain']]);
});

function smallWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const db = w.createDatabase({ space: 'S', name: 'Item' });
  w.addField(db, { name: 'Points', type: 'number' });
  w.addField(db, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b', 'c'] } });
  w.addField(db, { name: 'Ready', type: 'checkbox' });
  return { w, db };
}

test('CSV import creates entities with typed values', () => {
  const { w, db } = smallWorkspace();
  const result = w.importCSV(db, 'Name,Points,Tags,Ready\nFirst,5,a; b,true\nSecond,3,c,\nBadNum,notanumber,,\n');
  assert.equal(result.created, 2);
  assert.equal(result.errors.length, 1);
  const items = w.query(db, { sort: ['Name'] }).items;
  assert.deepEqual(items[0].fields.Tags, ['a', 'b']);
  assert.equal(items[0].fields.Ready, true);
  assert.equal(items[1].fields.Points, 3);
});

test('CSV export → import roundtrip', () => {
  const { w, db } = smallWorkspace();
  w.createEntity(db, { name: 'Round, trip', values: { Points: 9, Tags: ['a'] } });
  const csv = w.exportCSV(db);
  const w2 = new Weave();
  w2.createSpace({ name: 'S' });
  const db2 = w2.createDatabase({ space: 'S', name: 'Item' });
  w2.addField(db2, { name: 'Points', type: 'number' });
  w2.addField(db2, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b', 'c'] } });
  w2.addField(db2, { name: 'Ready', type: 'checkbox' });
  const result = w2.importCSV(db2, csv);
  assert.equal(result.created, 1);
  const item = w2.query(db2, {}).items[0];
  assert.equal(item.name, 'Round, trip');
  assert.equal(item.fields.Points, 9);
});

test('file attach with disk persistence and read-back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-files-'));
  try {
    const w = new Weave({ path: join(dir, 'ws.json') });
    w.createSpace({ name: 'S' });
    const db = w.createDatabase({ space: 'S', name: 'Doc' });
    const e = w.createEntity(db, { name: 'E' });
    const file = w.attachFile(e.id, { name: 'note.txt', mime: 'text/plain', bytes: Buffer.from('hello weave') });
    assert.ok(existsSync(join(dir, 'files', file.id)));
    const { meta, bytes } = w.readFile(file.id);
    assert.equal(meta.name, 'note.txt');
    assert.equal(bytes.toString(), 'hello weave');
    w.deleteFile(e.id, file.id);
    assert.throws(() => w.readFile(file.id), /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file and CSV endpoints over HTTP', async () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const db = w.createDatabase({ space: 'S', name: 'Item' });
  w.addField(db, { name: 'Points', type: 'number' });
  const e = w.createEntity(db, { name: 'E' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const up = await fetch(`${base}/api/entities/${e.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a.txt', mime: 'text/plain', contentBase64: Buffer.from('file body').toString('base64') }),
    });
    assert.equal(up.status, 201);
    const meta = await up.json();
    const dl = await fetch(`${base}/api/files/${meta.id}`);
    assert.equal(dl.headers.get('content-type'), 'text/plain');
    assert.equal(await dl.text(), 'file body');

    const imp = await fetch(`${base}/api/databases/Item/import.csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: 'Name,Points\nImported,7\n' }),
    });
    assert.deepEqual((await imp.json()).created, 1);
  } finally {
    server.close();
  }
});

test('webhook automation fires on state change', async () => {
  const received = [];
  const hook = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.end('ok');
    });
  });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const port = hook.address().port;
  try {
    const w = new Weave();
    w.createSpace({ name: 'S' });
    const db = w.createDatabase({ space: 'S', name: 'Job' });
    w.addField(db, {
      name: 'State', type: 'workflow',
      config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
    });
    w.createAutomation(db, {
      name: 'notify',
      trigger: { type: 'state-changed', field: 'State', toState: 'Done' },
      actions: [{ type: 'webhook', url: `http://127.0.0.1:${port}/hook` }],
    });
    const e = w.createEntity(db, { name: 'Deploy' });
    w.setState(e.id, 'State', 'Done');
    // fire-and-forget: give the event loop a beat
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'state-changed');
    assert.equal(received[0].entity.name, 'Deploy');

    // invalid url rejected at creation
    assert.throws(() => w.createAutomation(db, {
      name: 'bad', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: 'ftp://x' }],
    }), /http/);
  } finally {
    hook.close();
  }
});
