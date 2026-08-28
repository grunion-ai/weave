import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const dir = mkdtempSync(join(tmpdir(), 'weave-cli-'));
const data = join(dir, 'ws.json');

function cli(...args) {
  return execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
}

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('CLI end-to-end flow', () => {
  cli('space', 'create', 'Work');
  cli('db', 'create', 'Work', 'Project');
  cli('db', 'create', 'Work', 'Task');
  cli('field', 'add', 'Task', 'Estimate', 'number');
  cli('field', 'add', 'Task', 'State', 'workflow', '--config',
    '{"states":[{"name":"Open","category":"not-started","default":true},{"name":"Done","category":"done"}]}');
  cli('relation', 'add', 'Task', 'Project', 'Project', '--cardinality', 'many-to-one', '--inverse', 'Tasks');
  cli('field', 'add', 'Project', 'Total', 'rollup', '--config',
    '{"relationField":"Tasks","targetField":"Estimate","aggregate":"sum"}');

  cli('create', 'Project', 'Apollo');
  const created = JSON.parse(cli('create', 'Task', 'Design it', '--values', '{"Estimate": 5, "Project": "Apollo"}'));
  assert.equal(created.fields.Project.name, 'Apollo');

  // Public-id ref form Db#n
  const got = JSON.parse(cli('get', 'Task#1'));
  assert.equal(got.name, 'Design it');

  const proj = JSON.parse(cli('get', 'Project#1'));
  assert.equal(proj.fields.Total, 5);

  const q = JSON.parse(cli('query', 'Task', '--where', '[["Project.Name","=","Apollo"]]', '--select', 'Estimate'));
  assert.equal(q.total, 1);
  assert.equal(q.items[0].Estimate, 5);

  const st = JSON.parse(cli('state', 'Task#1', 'State', 'Done'));
  assert.equal(st.fields.State, 'Done');

  cli('doc', 'set', 'Task#1', '--content', '# Notes\n\nHello **world**');
  assert.match(cli('doc', 'get', 'Task#1'), /Hello \*\*world\*\*/);

  const pdfPath = join(dir, 'out.pdf');
  JSON.parse(cli('doc', 'export', 'Task#1', '--format', 'pdf', '--out', pdfPath));
  assert.ok(existsSync(pdfPath));
  assert.ok(readFileSync(pdfPath, 'latin1').startsWith('%PDF-1.4'));

  const htmlOut = cli('doc', 'export', 'Task#1', '--format', 'html');
  assert.match(htmlOut, /<h1>Notes<\/h1>/);

  cli('comment', 'Task#1', 'looks', 'good');
  const search = JSON.parse(cli('search', 'design'));
  assert.equal(search[0].name, 'Design it');

  const csv = cli('csv', 'Task');
  assert.match(csv, /Design it/);

  const schema = JSON.parse(cli('schema'));
  assert.equal(schema.find((sp) => !sp.system).space, 'Work');

  // errors exit non-zero
  assert.throws(() => cli('get', 'Task#999'));
});

test('CLI target-set relation: --target-dbs makes a one-way polymorphic field', () => {
  cli('db', 'create', 'Work', 'Ticket');
  const made = JSON.parse(cli('relation', 'add', 'Ticket', 'Scope', '--target-dbs', 'Work/Task,Work/Project'));
  assert.deepEqual(made.field.config.targetDbs.length, 2);
  assert.equal(made.inverse, null);
  const t = JSON.parse(cli('create', 'Ticket', 'Bug', '--values', '{"Scope": ["Apollo"]}'));
  assert.equal(t.fields.Scope.db, 'Work/Project'); // resolved across the set, single cardinality
});
