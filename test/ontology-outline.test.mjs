import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, listTools } from '../src/mcp.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/ontology-weave.json'), 'utf8'));

function tracker(w = new Weave()) {
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  w.createTable({ space: 'Dev', name: 'Release' });
  w.addField('Issue', { name: 'Status', type: 'workflow', config: { description: 'Where the fix stands', states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Fixed', category: 'done' }] } });
  w.addField('Issue', { name: 'Severity', type: 'select', config: { options: ['Low', 'High'], description: 'How much it hurts' } });
  w.addField('Issue', { name: 'Symptom', type: 'multiselect', config: { options: ['Slow', 'Error'] } });
  w.addField('Issue', { name: 'Points', type: 'number' });
  w.addField('Release', { name: 'Date', type: 'date' });
  w.addRelation('Issue', { name: 'Fixed in', targetDb: 'Release', cardinality: 'many-to-many', inverseName: 'Fixes' });
  w.addField('Issue', { name: 'Release date', type: 'lookup', config: { relationField: 'Fixed in', targetField: 'Date' } });
  w.addField('Release', { name: 'Fix count', type: 'rollup', config: { relationField: 'Fixes', aggregate: 'count' } });
  w.addField('Issue', { name: 'Weight', type: 'formula', config: { expression: 'Points * 2' } });
  w.createSpace({ name: 'CRM' });
  w.createTable({ space: 'CRM', name: 'Company' });
  w.addField('Company', { name: 'Website', type: 'url' });
  return w;
}

const spaceVersion = (w, name) => w.spaceVersions().spaces.find((s) => s.name === name).version;

test('outline: one line per table, grouped by space, ending with the etag', () => {
  const w = tracker();
  const text = w.ontology({ depth: 'outline' });
  const lines = text.split('\n');
  assert.equal(lines.at(-1), `etag ${w.spaceVersions().etag}`);
  const tableLines = lines.filter((l) => l.startsWith('  '));
  assert.equal(tableLines.length, w.listTables().filter((t) => !t.system).length, 'one line per table');
  assert.match(text, /\nWorkspace \(system registry[^\n]*: Spaces, Tables/, 'the registry is one line of names');
  const dev = lines.findIndex((l) => l.startsWith('Dev'));
  const crm = lines.findIndex((l) => l.startsWith('CRM'));
  assert.ok(dev >= 0 && crm > dev, 'spaces head their tables');
  const issue = tableLines.find((l) => l.startsWith('  Issue: '));
  assert.ok(issue, text);
  assert.match(issue, /Status flow\[Open\|Fixed\]/);
  assert.match(issue, /Severity one\[Low\|High\]/);
  assert.match(issue, /Symptom many\[Slow\|Error\]/);
  assert.match(issue, /Points num/);
  assert.match(issue, /Fixed in -> Release\* \(Fixes\)/);
  assert.match(issue, /Release date = Fixed in\.Date/);
  assert.match(issue, /Weight = Points \* 2/);
  const release = tableLines.find((l) => l.startsWith('  Release: '));
  assert.match(release, /Fixes -> Issue\* \(Fixed in\)/);
  assert.match(release, /Fix count = count\(Fixes\)/);
  for (const l of tableLines) {
    for (const part of l.slice(l.indexOf(': ') + 2).split('; ')) {
      assert.doesNotMatch(part, /^(Name|Description|Chip|Card) /, `the auto fields are left out: ${l}`);
    }
  }
  assert.deepEqual(w.ontology(), text, 'outline is the default depth');
  assert.throws(() => w.ontology({ depth: 'full' }), /outline/);
});

test('outline names a table by its bare name unless two spaces share it', () => {
  const w = tracker();
  w.createTable({ space: 'CRM', name: 'Release' });
  w.addRelation('Company', { name: 'Launch', targetDb: 'CRM/Release', cardinality: 'many-to-one', inverseName: 'Company' });
  const text = w.ontology();
  assert.match(text, /Launch -> CRM\/Release \(Company\)/);
  assert.match(text, /Fixed in -> Dev\/Release\* \(Fixes\)/);
});

test('concept: one table in full, by bare or Space/Table name', () => {
  const w = tracker();
  const text = w.ontology({ concept: 'Issue' });
  assert.equal(w.ontology({ concept: 'Dev/Issue' }), text);
  assert.match(text, /^Dev\/Issue/);
  assert.match(text, /Where the fix stands/, 'field descriptions');
  assert.match(text, /How much it hurts/);
  assert.match(text, /Open \(not-started, default\)/, 'states with their category');
  assert.match(text, /Fixed \(done\)/);
  assert.match(text, /Low, High/, 'options');
  assert.match(text, /Fixed in: relation -> Dev\/Release, many; inverse Fixes/, 'relation target and inverse');
  assert.match(text, /Name: text/, 'the auto fields are named in full');
  assert.doesNotMatch(text, /CRM/, 'only the one table');
  assert.throws(() => w.ontology({ concept: 'Nope' }), /not found/);
  w.createTable({ space: 'CRM', name: 'Issue' });
  assert.throws(() => w.ontology({ concept: 'Issue' }), /Space\/Name/);
});

test('a structural change bumps only its own space', () => {
  const w = tracker();
  const before = w.spaceVersions();
  const crm = spaceVersion(w, 'CRM');
  w.addField('Issue', { name: 'Area', type: 'text' });
  const after = w.spaceVersions();
  assert.ok(spaceVersion(w, 'Dev') > before.spaces.find((s) => s.name === 'Dev').version);
  assert.equal(spaceVersion(w, 'CRM'), crm);
  assert.notEqual(after.etag, before.etag);
  assert.match(after.etag, /^[0-9a-f]{8}$/);
});

test('a row write bumps nothing', () => {
  const w = tracker();
  const before = w.spaceVersions();
  const e = w.createEntity('Issue', { name: 'Grid flickers', values: { Severity: 'High', Points: 3 } });
  w.updateEntity(e.id, { Points: 5 });
  w.setState(e.id, 'Status', 'Fixed');
  w.createEntity('Company', { name: 'Acme' });
  assert.deepEqual(w.spaceVersions(), before);
});

test('renames, config edits, relations and deletes bump the spaces they touch', () => {
  const w = tracker();
  let v = w.spaceVersions();
  const step = (fn, moved, still) => {
    fn();
    const next = w.spaceVersions();
    for (const s of moved) assert.ok(next.spaces.find((x) => x.name === s).version > v.spaces.find((x) => x.name === s).version, `${s} moved`);
    for (const s of still) assert.equal(next.spaces.find((x) => x.name === s).version, v.spaces.find((x) => x.name === s).version, `${s} stayed`);
    v = next;
  };
  step(() => w.updateField('Issue', 'Severity', { config: { options: ['Low', 'High', 'Blocker'] } }), ['Dev'], ['CRM']);
  step(() => w.updateTable('Company', { name: 'Account' }), ['CRM'], ['Dev']);
  step(() => w.addRelation('Account', { name: 'Issues', targetDb: 'Issue', cardinality: 'one-to-many', inverseName: 'Account' }), ['CRM', 'Dev'], []);
  step(() => w.deleteField('Issue', 'Symptom'), ['Dev'], ['CRM']);
  step(() => w.updateSpace('CRM', { description: 'Customers' }), ['CRM'], ['Dev']);
  step(() => w.updateField('Issue', 'Points', { config: { width: 140 } }), [], ['Dev', 'CRM']);
  step(() => w.deleteTable('Release', { hard: true }), ['Dev'], []);
});

test('versions survive a reopen: they live in the audit log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ontology-'));
  try {
    const path = join(dir, 'w.db');
    const w = tracker(new Weave({ path }));
    const v = w.spaceVersions();
    const again = new Weave({ path });
    assert.deepEqual(again.spaceVersions(), v);
    assert.equal(again.ontology(), w.ontology());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('since: nothing changed is a near-empty reply', () => {
  const w = tracker();
  const { etag } = w.spaceVersions();
  const reply = w.ontology({ since: etag });
  assert.ok(reply.length < 80, reply);
  assert.match(reply, /unchanged/);
  assert.ok(reply.includes(etag));
});

test('since: only the spaces that moved, then the new etag', () => {
  const w = tracker();
  const { etag } = w.spaceVersions();
  w.addField('Company', { name: 'Tier', type: 'select', config: { options: ['Gold', 'Silver'] } });
  const reply = w.ontology({ since: etag });
  const lines = reply.split('\n');
  assert.ok(lines.some((l) => l.startsWith('CRM')), reply);
  assert.match(reply, /Tier one\[Gold\|Silver\]/);
  assert.ok(!lines.some((l) => l.startsWith('Dev')), 'Dev did not move');
  assert.ok(!reply.includes('Issue:'));
  assert.equal(lines.at(-1), `etag ${w.spaceVersions().etag}`);
});

test('since: a trashed space is named as gone', () => {
  const w = tracker();
  const { etag } = w.spaceVersions();
  w.deleteSpace('CRM');
  const reply = w.ontology({ since: etag });
  assert.match(reply, /gone: CRM/);
  assert.ok(!reply.includes('Issue:'));
});

test('since: an etag the workspace never issued answers the whole outline', () => {
  const w = tracker();
  const reply = w.ontology({ since: 'deadbeef' });
  assert.match(reply.split('\n')[0], /deadbeef/);
  assert.ok(reply.endsWith(w.ontology()));
});

test('the outline of a workspace the size of the live weave docs stays under 8,000 characters', () => {
  const w = new Weave();
  w.applySchema(FIXTURE, {});
  assert.equal(w.listTables().filter((t) => !t.system).length, 36, 'the fixture has the live table count');
  const outline = w.ontology();
  const schema = JSON.stringify(w.describeSchema());
  assert.ok(outline.length < 8000, `outline is ${outline.length} characters`);
  assert.ok(outline.length * 10 < schema.length, `outline ${outline.length} vs schema ${schema.length}`);
});

let rpcId = 0;
const call = (w, name, args) => handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }).result;

test('weave_ontology is listed by default and answers plain text', () => {
  assert.ok(listTools('core').some((t) => t.name === 'weave_ontology'));
  const w = tracker();
  const outline = call(w, 'weave_ontology', { depth: 'outline' });
  assert.ok(!outline.isError, outline.content[0].text);
  assert.equal(outline.content[0].text, w.ontology());
  assert.equal(call(w, 'weave_ontology', {}).content[0].text, w.ontology());
  assert.equal(call(w, 'weave_ontology', { concept: 'Issue' }).content[0].text, w.ontology({ concept: 'Issue' }));
  const { etag } = w.spaceVersions();
  assert.match(call(w, 'weave_ontology', { since: etag }).content[0].text, /unchanged/);
  assert.equal(call(w, 'weave_ontology', { concept: 'Nope' }).isError, true);
});

test('GET /api/ontology mirrors the tool, and the CLI prints it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ontology-door-'));
  const path = join(dir, 'w.db');
  const w = tracker(new Weave({ path }));
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/ontology`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain/);
    assert.equal(await res.text(), w.ontology());
    assert.equal(await (await fetch(`${base}/api/ontology?concept=Dev%2FIssue`)).text(), w.ontology({ concept: 'Dev/Issue' }));
    const { etag } = w.spaceVersions();
    assert.match(await (await fetch(`${base}/api/ontology?since=${etag}`)).text(), /unchanged/);
    assert.equal((await fetch(`${base}/api/ontology?concept=Nope`)).status, 404);
    const cli = (...a) => execFileSync(process.execPath, [BIN, 'ontology', '--data', path, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
    assert.equal(cli(), w.ontology());
    assert.equal(cli('--concept', 'Issue'), w.ontology({ concept: 'Issue' }));
    assert.match(cli('--since', etag), /unchanged/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
