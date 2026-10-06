import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';
import { startServer } from '../src/server.js';
import { VOCABULARY, searchIcons } from '../src/vocabulary.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const call = (w, name, args) => dispatchTool(w, name, args ?? {});
const refusal = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected a refusal'); };
const json = (v) => JSON.parse(JSON.stringify(v));

test('weave_vocabulary {sections:[...]} answers every named section in one call, keyed by name', () => {
  const w = new Weave();
  const r = call(w, 'weave_vocabulary', { sections: ['optionColors', 'numberFormats', 'formulaFunctions'] });
  assert.deepEqual(Object.keys(r), ['optionColors', 'numberFormats', 'formulaFunctions']);
  assert.deepEqual(r.optionColors, VOCABULARY.optionColors);
  assert.deepEqual(r.numberFormats, VOCABULARY.numberFormats);
  assert.deepEqual(r.formulaFunctions, VOCABULARY.formulaFunctions);
  assert.deepEqual(call(w, 'weave_vocabulary', { section: ['optionColors', 'numberFormats'] }), { optionColors: VOCABULARY.optionColors, numberFormats: VOCABULARY.numberFormats });
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'optionColors, numberFormats' }), { optionColors: VOCABULARY.optionColors, numberFormats: VOCABULARY.numberFormats });
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'numberFormats' }), VOCABULARY.numberFormats);
  assert.deepEqual(call(w, 'weave_vocabulary', { sections: ['numberFormats'] }), VOCABULARY.numberFormats);
  assert.match(refusal(() => call(w, 'weave_vocabulary', { sections: ['optionColors', 'nope'] })).message, /Unknown vocabulary section 'nope' \(fieldTypes, optionColors,/);
});

test('a query rides along: it searches the icons section and leaves the others whole', () => {
  const w = new Weave();
  const r = call(w, 'weave_vocabulary', { sections: ['icons', 'optionColors'], query: 'wallet' });
  assert.deepEqual(r.icons, searchIcons('wallet'));
  assert.deepEqual(r.optionColors, VOCABULARY.optionColors);
  assert.match(refusal(() => call(w, 'weave_vocabulary', { sections: ['optionColors', 'numberFormats'], query: 'x' })).message, /query searches the icons section/);
});

test('several icon queries in one call: a list, or a comma-separated string', () => {
  const w = new Weave();
  const r = call(w, 'weave_vocabulary', { section: 'icons', query: ['wallet', 'phone'] });
  assert.equal(r.form, 'lucide:<name>');
  assert.deepEqual(r.searches, [searchIcons('wallet'), searchIcons('phone')].map(({ form, ...rest }) => rest));
  assert.deepEqual(call(w, 'weave_vocabulary', { query: 'wallet, phone' }), r);
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'icons', query: 'phone' }), searchIcons('phone'));
  const all = call(w, 'weave_vocabulary', { sections: ['icons', 'optionColors', 'numberFormats'], query: ['wallet', 'bank', 'tag', 'chart'] });
  assert.equal(all.icons.searches.length, 4);
  assert.ok(JSON.stringify(all).length < 6000, `the combined answer stays short: ${JSON.stringify(all).length}`);
});

test('the MCP schema declares sections; REST and CLI take the comma list', async () => {
  const t = TOOLS.find((x) => x.name === 'weave_vocabulary');
  assert.equal(t.inputSchema.properties.sections.type, 'array');
  assert.match(t.description, /sections/);
  const { server } = await startServer(new Weave(), { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/api/vocabulary`;
  try {
    assert.deepEqual(await (await fetch(`${base}?section=optionColors,numberFormats`)).json(), json({ optionColors: VOCABULARY.optionColors, numberFormats: VOCABULARY.numberFormats }));
    assert.deepEqual(await (await fetch(`${base}?section=icons,numberFormats&query=wallet`)).json(), json({ icons: searchIcons('wallet'), numberFormats: VOCABULARY.numberFormats }));
  } finally { server.close(); }
  const dir = mkdtempSync(join(tmpdir(), 'weave-vocab-sections-'));
  try {
    const out = execFileSync('node', [BIN, '--data', join(dir, 'ws.db'), 'vocabulary', 'optionColors,numberFormats'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.deepEqual(JSON.parse(out), json({ optionColors: VOCABULARY.optionColors, numberFormats: VOCABULARY.numberFormats }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const BUDGET = () => ({
  spaces: [{
    name: 'Budget',
    tables: [
      {
        name: 'Category',
        fields: [
          { name: 'Kind', type: 'select', options: [{ name: 'Needs' }, { name: 'Wants' }] },
          { name: 'Spending', type: 'rollup', relationField: 'Transactions', targetField: 'Amount', aggregate: 'sum' },
        ],
        rows: [{ Name: 'Groceries', Kind: 'Needs' }, { Name: 'Fun', Kind: 'Wants' }],
      },
      {
        name: 'Transaction',
        fields: [
          { name: 'Amount', type: 'number', format: 'currency', currency: 'USD' },
          { name: 'Category', type: 'relation', to: 'Category', cardinality: 'many-to-one' },
          { name: 'Category name', type: 'lookup', relationField: 'Category', targetField: 'Name' },
          { name: 'Doubled', type: 'formula', expression: 'Amount * 2' },
        ],
        rows: [
          { Name: 'Whole Foods', Amount: 142.18, Category: 'Groceries' },
          { Name: 'Trader Joes', Amount: 57.82, Category: 'Groceries' },
          { Name: 'Cinema', Amount: 30, Category: 'Fun' },
          { Name: 'Rent', Amount: 2400 },
        ],
      },
    ],
  }],
});

test('the build reply carries a few computed values per formula, lookup and rollup it made', () => {
  const w = new Weave();
  const r = w.build(BUDGET());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(Object.keys(r.computed).sort(), ['Budget/Category.Spending', 'Budget/Transaction.Category name', 'Budget/Transaction.Doubled']);
  assert.deepEqual(r.computed['Budget/Category.Spending'], ['$200.00', '$30.00']);
  assert.deepEqual(r.computed['Budget/Transaction.Doubled'], [284.36, 115.64, 60]);
  assert.deepEqual(r.computed['Budget/Transaction.Category name'], ['Groceries', 'Groceries', 'Fun']);
  assert.ok(!('Budget/Transaction.Amount' in r.computed));
  const mcp = JSON.parse(call(new Weave(), 'weave_build', { spec: BUDGET() }));
  assert.deepEqual(mcp.computed, r.computed);
});

test('dryRun samples the trial, so the values are seen before anything is written', () => {
  const w = new Weave();
  const r = w.build(BUDGET(), { dryRun: true });
  assert.deepEqual(r.computed['Budget/Transaction.Doubled'], [284.36, 115.64, 60]);
  assert.ok(!w.findTable('Transaction'), 'nothing written');
});

test('a computed field over an empty table says so; an existing field is not re-sampled', () => {
  const w = new Weave();
  const spec = BUDGET();
  for (const t of spec.spaces[0].tables) delete t.rows;
  assert.deepEqual(w.build(spec).computed['Budget/Transaction.Doubled'], [], 'no rows: nothing computed yet, said plainly');
  const again = w.build(BUDGET());
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(again.computed, undefined, 'no computed field made this time: the key is left out');
});

test('a table spec carries fieldOrder, hidden and sort, applied to its default view', () => {
  const w = new Weave();
  const spec = BUDGET();
  Object.assign(spec.spaces[0].tables[1], {
    fieldOrder: ['Amount', 'Category', 'Name'],
    hidden: ['Description', 'Category name'],
    sort: [{ field: 'Amount', dir: 'desc' }],
  });
  const r = w.build(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.ignored, [], 'the layout keys are taken, not dropped');
  const [view] = w.tableView('Budget/Transaction').views;
  assert.deepEqual(view.fields, ['Amount', 'Category', 'Name', 'Doubled']);
  assert.deepEqual(view.sort, [{ field: 'Amount', dir: 'desc' }]);
  const tx = w.findTable('Transaction');
  assert.deepEqual(tx.fieldOrder.map((id) => tx.fields[id].name).slice(0, 3), ['Amount', 'Category', 'Name']);
});

test('sort takes the short spelling; a bad layout name is an error with its path, and nothing is written', () => {
  const w = new Weave();
  const spec = BUDGET();
  spec.spaces[0].tables[1].sort = 'Amount desc, Name';
  const r = w.build(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(w.tableView('Budget/Transaction').views[0].sort, [{ field: 'Amount', dir: 'desc' }, { field: 'Name', dir: 'asc' }]);

  const w2 = new Weave();
  const bad = BUDGET();
  bad.spaces[0].tables[1].hidden = ['Nope'];
  const r2 = w2.build(bad);
  assert.equal(r2.ok, false);
  assert.equal(r2.errors.length, 1);
  assert.equal(r2.errors[0].path, 'spaces[0].tables[1].hidden');
  assert.match(r2.errors[0].error, /Nope/);
  assert.ok(!w2.findTable('Transaction'), 'a failed trial writes nothing');
});

test('layout on a table that already exists is applied on the re-run', () => {
  const w = new Weave();
  w.build(BUDGET());
  const spec = BUDGET();
  for (const t of spec.spaces[0].tables) delete t.rows;
  spec.spaces[0].tables[0].hidden = ['Description'];
  const r = w.build(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(!w.tableView('Budget/Category').views[0].fields.includes('Description'));
});

test('the weave_build description names the layout keys', () => {
  const t = TOOLS.find((x) => x.name === 'weave_build');
  assert.match(t.inputSchema.properties.spec.description, /fieldOrder/);
  assert.match(t.inputSchema.properties.spec.description, /hidden/);
  assert.match(t.inputSchema.properties.spec.description, /sort/);
  assert.match(t.description, /computed/);
  assert.match(TOOLS.find((x) => x.name === 'weave_vocabulary').description, /"wallet, bank"/, 'several icon queries are named');
});
