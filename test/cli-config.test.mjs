/* The configuration commands, driven as a terminal would drive them.
   Everything here was browser-only or curl-only before: a table's icon and
   noun, a field's rename and width, saved views, automations read back, the
   activity feed, the workspace record, files, the registry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const dir = mkdtempSync(join(tmpdir(), 'weave-cli-config-'));
const data = join(dir, 'ws.db');
const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
const json = (...args) => JSON.parse(cli(...args));
const schema = () => json('schema');
const table = () => schema().find((s) => s.space === 'Ops').tables.find((t) => t.name === 'Invoice');

test.before(() => {
  cli('space', 'create', 'Ops', '--description', 'how work runs');
  cli('table', 'create', 'Ops', 'Invoice');
  cli('field', 'add', 'Invoice', 'Stage', 'select', '--config', '{"options":["Draft","Sent"]}');
});
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('the terminal creates a space with its icon in one call', () => {
  cli('space', 'create', 'Field', '--description', 'work in the field', '--icon', 'iconly:location');
  const sp = schema().find((s) => s.space === 'Field');
  assert.equal(sp.icon, 'iconly:location');
  assert.equal(sp.description, 'work in the field');
});

test('the vocabulary is one command away', () => {
  const v = json('vocabulary');
  assert.ok(v.icons.names.includes('wallet'));
  assert.equal(json('vocabulary', 'columnWidth').min, 60);
});

test('a table takes its icon, noun, hidden columns and order from the terminal', () => {
  cli('table', 'update', 'Ops/Invoice', '--icon', 'iconly:wallet', '--noun', 'invoice',
    '--hidden', 'Description', '--order', 'Stage,Name,Description');
  const t = table();
  assert.equal(t.icon, 'iconly:wallet');
  assert.equal(t.noun, 'invoice');
  assert.deepEqual(t.hiddenFields, ['Description']);
  assert.deepEqual(t.fields.map((f) => f.name), ['Stage', 'Name', 'Description']);
});

test('a field is renamed, recolored and widened from the terminal', () => {
  cli('field', 'update', 'Invoice', 'Stage', '--name', 'Phase', '--width', '240',
    '--config', '{"options":[{"name":"Draft","color":"#f59f00"},{"name":"Sent","color":"#2ea043"}]}');
  const f = table().fields.find((x) => x.name === 'Phase');
  assert.equal(f.width, 240);
  assert.equal(f.optionsFull[0].color, '#f59f00');
  cli('field', 'update', 'Invoice', 'Phase', '--width', 'null');
  assert.equal(table().fields.find((x) => x.name === 'Phase').width, undefined, '--width null resets to auto');
});

test('a space is updated and a schema document applies from a file', () => {
  cli('space', 'update', 'Ops', '--icon', 'iconly:work');
  assert.equal(schema().find((s) => s.space === 'Ops').icon, 'iconly:work');
  const doc = schema();
  doc.find((s) => s.space === 'Ops').tables.find((t) => t.name === 'Invoice').description = 'one bill';
  const file = join(dir, 'schema.json');
  writeFileSync(file, JSON.stringify(doc));
  const plan = json('schema', 'apply', '--file', file, '--dry-run');
  assert.deepEqual(plan, [{ action: 'update-table', subject: 'Ops/Invoice' }]);
  cli('schema', 'apply', '--file', file);
  assert.equal(table().description, 'one bill');
});

test('views and automations are terminal work', () => {
  const view = json('view', 'create', 'Billing', '--blocks', '[{"table":"Invoice","view":"board"}]');
  assert.equal(json('view', 'list').length, 1);
  assert.ok(json('view', 'share', view.id).token, 'sharing mints a capability token');
  cli('view', 'unshare', view.id);
  cli('view', 'delete', view.id);

  const made = json('automation', 'create', 'Invoice', '--name', 'stamp',
    '--trigger', '{"type":"entity-created"}', '--actions', '[{"type":"add-comment","text":"filed"}]');
  assert.match(cli('automation', 'describe', 'Invoice'), /stamp/);
  cli('automation', 'update', made.id, '--patch', '{"enabled":false}');
  assert.equal(json('automation', 'list')[0].enabled, false);
  cli('automation', 'delete', made.id);
  assert.equal(json('automation', 'list').length, 0);
});

test('the feed, the registry and the map read from the terminal', () => {
  cli('create', 'Invoice', 'INV-1');
  const feed = json('activity', '--table', 'Invoice');
  assert.ok(feed.items.length > 0);
  assert.deepEqual(json('registry').problems, []);
  assert.match(cli('map'), /Invoice/);
});

test('the workspace record and its files are terminal work', () => {
  cli('workspace', 'set', '--name', 'ops-hub', '--description', 'the hub');
  assert.equal(json('workspace').name, 'ops-hub');

  const png = join(dir, 'logo.png');
  writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  cli('workspace', 'logo', '--path', png);
  assert.equal(json('workspace').logo, true);
  cli('workspace', 'logo', '--clear');
  assert.equal(json('workspace').logo, false);

  const note = join(dir, 'note.txt');
  writeFileSync(note, 'hello');
  const file = json('file', 'attach', 'Invoice#1', '--path', note, '--mime', 'text/plain');
  const back = join(dir, 'back.txt');
  cli('file', 'read', file.id, '--out', back);
  assert.equal(readFileSync(back, 'utf8'), 'hello');
  cli('file', 'delete', 'Invoice#1', file.id);
});

test('a comment can be taken back, and CSV goes both ways', () => {
  const e = json('get', 'Invoice#1');
  const c = json('comment', `Invoice#1`, 'wrong thread');
  cli('comment', 'delete', 'Invoice#1', c.id ?? json('get', 'Invoice#1').comments[0].id);
  assert.deepEqual(json('get', 'Invoice#1').comments, []);
  assert.ok(e.name);

  const csv = join(dir, 'rows.csv');
  writeFileSync(csv, 'Name,Phase\nINV-9,Draft\n');
  cli('csv', 'import', 'Invoice', '--file', csv);
  assert.ok(cli('csv', 'Invoice').includes('INV-9'), 'the import lands and the export shows it');
});

test('unlink is a command, not a flag that means the opposite of its command', () => {
  cli('table', 'create', 'Ops', 'Client');
  cli('relation', 'add', 'Invoice', 'Client', 'Client', '--cardinality', 'many-to-one', '--inverse', 'Invoices');
  cli('create', 'Client', 'Acme');
  cli('link', 'Invoice#1', 'Client', 'Acme');
  assert.equal(json('get', 'Invoice#1').fields.Client.name, 'Acme');
  cli('unlink', 'Invoice#1', 'Client', 'Acme');
  assert.equal(json('get', 'Invoice#1').fields.Client, null);
});
