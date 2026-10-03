/* Feature #253: one call builds a workspace outline. A 2026-10-02 eval ran 32
   stock agents against weave over MCP; a five-table budget workspace took 50
   to 100 turns, one field, relation or row per call, and weave_apply_schema
   was used 0 times because it takes the 22 KB document weave_schema emits.
   build() takes the short spec an agent writes by hand and runs it through
   the verbs that already exist. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { TOOLS, handleMcpMessage } from '../src/mcp.js';

const SPEC = () => ({
  workspace: 'personal-finance',
  spaces: [{
    name: 'Budget', icon: 'lucide:wallet',
    tables: [
      {
        name: 'Account', icon: 'lucide:credit-card',
        fields: [{ name: 'Kind', type: 'select', options: [{ name: 'Credit card' }, { name: 'Checking' }] }],
        rows: [{ Name: 'Amex Gold', Kind: 'Credit card' }, { Name: 'Chase', Kind: 'Checking' }],
      },
      {
        name: 'Category',
        fields: [{ name: 'Monthly', type: 'number', format: 'currency', currency: 'USD' }],
        rows: [{ Name: 'Groceries', Monthly: 600 }],
      },
      {
        name: 'Transaction',
        fields: [
          { name: 'Amount', type: 'number', format: 'currency', currency: 'USD' },
          { name: 'Date', type: 'date' },
          { name: 'Account', type: 'relation', to: 'Account', cardinality: 'many-to-one' },
          { name: 'Category', type: 'relation', to: 'Category' },
          { name: 'Account kind', type: 'lookup', relationField: 'Account', targetField: 'Kind' },
          { name: 'Doubled', type: 'formula', expression: 'Amount * 2' },
        ],
        rows: [
          { Name: 'Whole Foods', Amount: 142.18, Date: '2026-08-03', Account: 'Amex Gold', Category: 'Groceries' },
          { Name: 'Rent', Amount: 2400, Date: '2026-08-01', Account: 'Chase' },
        ],
      },
    ],
  }],
});

const userSpaces = (w) => w.listSpaces().filter((s) => !s.system).map((s) => s.name);

test('a three-table build makes the spaces, tables, fields, relations and rows, linked by name', () => {
  const w = new Weave();
  const r = w.build(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.created, { spaces: 1, tables: 3, fields: 6, relations: 2, rows: 5 });
  assert.deepEqual(r.errors, []);
  assert.equal(w.getWorkspace().name, 'personal-finance');
  assert.equal(w.findSpace('Budget').icon, 'lucide:wallet');
  assert.equal(w.findTable('Budget/Account').icon, 'lucide:credit-card');

  const tx = w.query('Transaction', { where: [['Name', '=', 'Whole Foods']] }).items[0];
  const wf = w.readEntity(tx.id);
  assert.equal(wf.raw.Amount, 142.18);
  assert.equal(wf.raw.Date, '2026-08-03');
  assert.equal(wf.fields.Account.name, 'Amex Gold');
  assert.equal(wf.fields.Category.name, 'Groceries');
  assert.match(String(wf.fields['Account kind']), /credit/i, 'the lookup reads through the relation');
  assert.equal(wf.raw.Doubled, 284.36);
  const amount = w.findField(w.findTable('Transaction'), 'Amount');
  assert.deepEqual([amount.config.format, amount.config.currency], ['currency', 'USD']);
  // The inverse was made by addRelation, so the account sees its transaction.
  const amex = w.query('Account', { where: [['Name', '=', 'Amex Gold']] }).items[0];
  assert.equal(w.readEntity(amex.id).fields.Transactions.length, 1);
});

test('dryRun writes nothing and reports what it would make', () => {
  const w = new Weave();
  const before = JSON.stringify(w.state);
  const audits = w.listAudit({ limit: -1 }).length;
  const r = w.build(SPEC(), { dryRun: true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.created, { spaces: 1, tables: 3, fields: 6, relations: 2, rows: 5 });
  assert.equal(JSON.stringify(w.state), before, 'state untouched');
  assert.deepEqual(userSpaces(w), []);
  assert.equal(w.listAudit({ limit: -1 }).length, audits, 'no audit rows from the trial');
});

test('every error comes back at once, each with its path, and nothing is written', () => {
  const w = new Weave();
  const spec = SPEC();
  const [account, , txn] = spec.spaces[0].tables;
  account.fields.push({ name: 'Score', type: 'nonsense' });
  txn.fields[2].to = 'Nowhere';
  txn.rows[1].Amount = 'lots';
  spec.spaces.push({ name: 'Other', tables: [{ fields: [] }] });
  const r = w.build(spec);
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('spaces[0].tables[0].fields[1]'), paths.join(', '));
  assert.ok(paths.includes('spaces[0].tables[2].fields[2]'), paths.join(', '));
  assert.ok(paths.includes('spaces[0].tables[2].rows[1]'), paths.join(', '));
  assert.ok(paths.includes('spaces[1].tables[0]'), paths.join(', '));
  for (const e of r.errors) assert.ok(e.error, `${e.path} carries the engine's message`);
  assert.match(r.errors.find((e) => e.path === 'spaces[0].tables[0].fields[1]').error, /nonsense/);
  assert.deepEqual(userSpaces(w), [], 'a spec with errors writes nothing');
});

test('config keys the type does not take are reported as ignored', () => {
  const w = new Weave();
  const r = w.build({ spaces: [{ name: 'S', tables: [{ name: 'T', fields: [
    { name: 'Amount', type: 'number', format: 'number', currency: 'USD', colour: 'red' },
    { name: 'When', type: 'date', options: ['a'] },
    { name: 'Link', type: 'relation', to: 'T', many: true },
  ] }] }] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.ignored, [
    { path: 'spaces[0].tables[0].fields[0]', keys: ['colour'] },
    { path: 'spaces[0].tables[0].fields[1]', keys: ['options'] },
    { path: 'spaces[0].tables[0].fields[2]', keys: ['many'] },
  ]);
});

test('existing spaces, tables and same-typed fields are reused; rows always append', () => {
  const w = new Weave();
  w.build(SPEC());
  const again = w.build({ spaces: [{ name: 'Budget', tables: [{ name: 'Account',
    fields: [{ name: 'Kind', type: 'select', options: [{ name: 'Credit card' }] }],
    rows: [{ Name: 'Savings', Kind: 'Checking' }] }] }] });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.deepEqual(again.created, { spaces: 0, tables: 0, fields: 0, relations: 0, rows: 1 });
  assert.deepEqual(again.existing, ['space Budget', 'table Budget/Account', 'field Budget/Account.Kind']);
  assert.equal(w.query('Account', {}).total, 3);
  const clash = w.build({ spaces: [{ name: 'Budget', tables: [{ name: 'Account', fields: [{ name: 'Kind', type: 'text' }] }] }] });
  assert.equal(clash.ok, false);
  assert.match(clash.errors[0].error, /already exists as select/);
});

/* Second eval, 2026-10-02 (8 runs against a proxy build tool): three ways a
   build failed that are now the common path. */
test('a refused icon or colour is dropped and reported, never a cascade', () => {
  const w = new Weave();
  const r = w.build({ spaces: [{ name: 'Budget', icon: 'wallet', tables: [
    { name: 'Account', icon: 'lucide:not-an-icon',
      fields: [{ name: 'Kind', type: 'select', options: [{ name: 'Card', color: 'mauve-ish' }, { name: 'Cash', color: 'green' }] },
        { name: 'Stars', type: 'rating', icon: 'lucide:nope' }],
      rows: [{ Name: 'Amex', Kind: 'Card' }] },
    { name: 'Txn', fields: [{ name: 'Account', type: 'relation', to: 'Account' }], rows: [{ Name: 'Coffee', Account: 'Amex' }] },
  ] }] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.created, { spaces: 1, tables: 2, fields: 2, relations: 1, rows: 2 });
  assert.deepEqual(r.ignored.map((i) => [i.path, i.keys]), [
    ['spaces[0]', ['icon']],
    ['spaces[0].tables[0]', ['icon']],
    ['spaces[0].tables[0].fields[0].options[0]', ['color']],
    ['spaces[0].tables[0].fields[1]', ['icon']],
  ]);
  for (const i of r.ignored) assert.match(i.reason, /not in the inventory|Unknown option colour/);
  assert.equal(w.findTable('Budget/Account').icon, '');
  const kind = w.findField(w.findTable('Account'), 'Kind');
  assert.deepEqual(kind.config.options.map((o) => o.hue), ['slate', 'green'], 'the good colour stays');
});

test('resending the whole spec is a no-op for structure; skipExistingRows skips rows already in', () => {
  const w = new Weave();
  assert.equal(w.build(SPEC()).ok, true);
  const again = w.build(SPEC(), { skipExistingRows: true });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.deepEqual(again.created, { spaces: 0, tables: 0, fields: 0, relations: 0, rows: 0 });
  assert.ok(again.existing.includes('space Budget'));
  assert.ok(again.existing.includes('table Budget/Transaction'));
  assert.ok(again.existing.includes('field Budget/Transaction.Account'));
  assert.ok(again.existing.includes('row Budget/Account: Amex Gold'));
  assert.equal(w.query('Transaction', {}).total, 2);
  // Without the flag a re-run appends the rows again, as documented.
  assert.equal(w.build(SPEC()).created.rows, 5);
  assert.equal(w.query('Transaction', {}).total, 4);
});

test('every error is found before any write, rows checked against the fields the spec declares', () => {
  const w = new Weave();
  const r = w.build({ spaces: [{ name: 'S', tables: [
    { name: 'A', fields: [{ name: 'Kind', type: 'nope' }, { name: 'Size', type: 'number' }],
      rows: [{ Name: 'a1', Kind: 'x', Size: 'big' }, { Name: 'a2', Colour: 'red' }] },
    { name: 'B', fields: [{ name: 'A', type: 'relation', to: 'Missing' }, { name: 'A kind', type: 'lookup', relationField: 'A', targetField: 'Kind' },
      { name: 'Twice', type: 'formula', expression: 'Size * 2' }],
      rows: [{ Name: 'b1', A: 'a1' }] },
  ] }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.path).sort(), [
    'spaces[0].tables[0].fields[0]',
    'spaces[0].tables[0].rows[0]',
    'spaces[0].tables[0].rows[1]',
    'spaces[0].tables[1].fields[0]',
    'spaces[0].tables[1].fields[2]',
  ], JSON.stringify(r.errors));
  assert.deepEqual(userSpaces(w), [], 'nothing written');
});

test('the reply is one line of compact JSON on MCP, and weave_build is listed with a full example', () => {
  const w = new Weave();
  const tool = TOOLS.find((t) => t.name === 'weave_build');
  assert.ok(tool, 'weave_build is listed');
  assert.ok(tool.description.length <= 1500, `description is ${tool.description.length} characters`);
  for (const k of ['"relation"', '"options"', '"currency"', '"date"', 'dryRun']) assert.ok(tool.description.includes(k), `the example shows ${k}`);
  const example = JSON.parse(tool.description.match(/(\{"workspace".*\})\s*$/m)[1]);
  assert.equal(w.build(example, { dryRun: true }).ok, true, 'the example in the description builds');
  const reply = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_build', arguments: { spec: SPEC() } } });
  const text = reply.result.content[0].text;
  assert.ok(!text.includes('\n'), 'one line');
  assert.deepEqual(JSON.parse(text).created, { spaces: 1, tables: 3, fields: 6, relations: 2, rows: 5 });
  const dry = handleMcpMessage(w, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'weave_build', arguments: { spec: { spaces: [{ name: 'X' }] }, dryRun: true } } });
  assert.equal(JSON.parse(dry.result.content[0].text).dryRun, true);
  assert.equal(w.findSpace('X'), undefined);
});

test('POST /api/build is the HTTP door', async () => {
  const w = new Weave();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (body) => fetch(`${base}/api/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const dry = await (await post({ spec: SPEC(), dryRun: true })).json();
    assert.equal(dry.dryRun, true);
    assert.deepEqual(userSpaces(w), []);
    const res = await post(SPEC());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created.rows, 5);
    const bad = await post({ spaces: [{ name: 'Y', tables: [{ name: 'Z', fields: [{ name: 'Q', type: 'nope' }] }] }] });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).errors[0].path, 'spaces[0].tables[0].fields[0]');
  } finally { server.close(); }
});

test('weave build <file.json> is the CLI door, with --dry-run', () => {
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-build-'));
  const data = join(dir, 'ws.db');
  const file = join(dir, 'spec.json');
  writeFileSync(file, JSON.stringify(SPEC()));
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
  try {
    const dry = JSON.parse(cli('build', file, '--dry-run'));
    assert.equal(dry.dryRun, true);
    assert.equal(JSON.parse(cli('schema')).some((sp) => sp.space === 'Budget'), false, 'the dry run wrote nothing');
    const out = cli('build', file);
    assert.equal(out.trim().split('\n').length, 1, 'one line');
    assert.deepEqual(JSON.parse(out).created, { spaces: 1, tables: 3, fields: 6, relations: 2, rows: 5 });
    writeFileSync(file, JSON.stringify({ spaces: [{ name: 'B', tables: [{ name: 'C', fields: [{ name: 'D', type: 'nope' }] }] }] }));
    assert.throws(() => cli('build', file), 'a failed build exits non-zero');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
