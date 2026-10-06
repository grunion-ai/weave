import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { startServer } from '../src/server.js';
import { FIELD_PATHS, nextFor, fieldHints, containerHints } from '../src/field-hints.js';
import { FIELD_TYPE_VOCABULARY } from '../src/vocabulary.js';

let rpcId = 0;
function call(w, name, args) {
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } });
  const text = res.result.content[0].text;
  assert.ok(!res.result.isError, `${name}: ${text}`);
  return JSON.parse(text);
}
function budget() {
  const w = new Weave();
  call(w, 'weave_create_space', { name: 'Budget', icon: 'lucide:wallet' });
  call(w, 'weave_create_table', { space: 'Budget', name: 'Account', icon: 'lucide:landmark' });
  call(w, 'weave_create_table', { space: 'Budget', name: 'Transaction', icon: 'lucide:receipt' });
  return w;
}
const has = (list, re) => (list ?? []).some((h) => re.test(h));

test('every key the pathways offer is one the type takes, so next[] never names a key weave drops', () => {
  const opened = (node) => Object.values(node.opens ?? {}).flat();
  for (const [type, tree] of Object.entries(FIELD_PATHS)) {
    const takes = FIELD_TYPE_VOCABULARY.find((v) => v.type === type)?.config;
    assert.ok(takes, `${type} is a field type`);
    for (const [key, node] of Object.entries(tree)) {
      assert.ok(takes.includes(key), `${type}.${key} is in the vocabulary`);
      for (const child of opened(node)) assert.ok(takes.includes(child), `${type}.${key} opens ${child}, which the type takes`);
    }
  }
});

test('a new number field lists its display options; a choice reveals only its own branch (Issue #579)', () => {
  const first = nextFor('number', {});
  assert.deepEqual(first.map((l) => l.split(':')[0]), ['format', 'unit', 'display']);
  assert.ok(has(first, /currency/), 'currency is named on the first layer');
  assert.ok(!has(first, /^scale:/), 'the graphic scale waits until a display is chosen');
  const money = nextFor('number', { format: 'currency', currency: 'USD' });
  assert.ok(!has(money, /^format:/), 'a chosen format is not offered again');
  assert.ok(has(money, /^accounting:/) && has(money, /^decimals:/), 'currency opens accounting and decimals');
  assert.ok(!has(money, /^currency:/), 'a set currency is not offered again');
  const bar = nextFor('number', { display: 'bar' });
  assert.ok(has(bar, /^scale:/) && has(bar, /^color:/), 'a display opens scale and colour');
  assert.ok(has(nextFor('date', {}), /^grain:.*\["year","month"\]/), 'a date names the grain as a list');
  assert.ok(has(nextFor('rating', {}), /^icon:/), 'a rating names its icon');
  assert.deepEqual(nextFor('checkbox', {}), [], 'a type with nothing to choose says nothing');
});

test('weave_add_field answers with next[] for the type, on the compact reply (Issue #579)', () => {
  const w = budget();
  const amount = call(w, 'weave_add_field', { db: 'Transaction', name: 'Fee', type: 'number' });
  assert.ok(has(amount.next, /^format:.*currency/), JSON.stringify(amount));
  const done = call(w, 'weave_add_field', { db: 'Transaction', name: 'Paid on', type: 'checkbox' });
  assert.equal(done.next, undefined, 'no empty list rides a reply');
  const def = handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/list' }).result.tools.find((t) => t.name === 'weave_add_field');
  assert.match(def.description, /next\[\]/, 'the tool description says the reply lists the options');
  assert.match(def.description, /currency/, 'and names the number costume');
});

test('a money-named number with no currency is hinted; with currency it is not', () => {
  const w = budget();
  const bare = call(w, 'weave_add_field', { db: 'Transaction', name: 'Amount', type: 'number' });
  assert.ok(has(bare.hints, /format:"currency"/), JSON.stringify(bare));
  const dressed = call(w, 'weave_add_field', { db: 'Transaction', name: 'Balance', type: 'number', config: { format: 'currency', currency: 'USD' } });
  assert.equal(dressed.hints, undefined);
});

test('a text field named like money is steered to a number (Issue #574)', () => {
  const w = budget();
  const amount = call(w, 'weave_add_field', { db: 'Transaction', name: 'Amount', type: 'text' });
  assert.ok(has(amount.hints, /type:"number"/), JSON.stringify(amount));
  const memo = call(w, 'weave_add_field', { db: 'Transaction', name: 'Memo', type: 'text' });
  assert.equal(memo.hints, undefined, 'a plain text field is left alone');
});

test('a text field named like a table is steered to a relation, singular or plural (Issue #582)', () => {
  const w = budget();
  for (const name of ['Account', 'accounts']) {
    const r = call(w, 'weave_add_field', { db: 'Transaction', name, type: 'text' });
    assert.ok(has(r.hints, /relation/) && has(r.hints, /targetDb:"Account"/), `${name}: ${JSON.stringify(r.hints)}`);
  }
  call(w, 'weave_create_entity', { db: 'Account', name: 'Checking' });
  call(w, 'weave_create_entity', { db: 'Transaction', name: 'Rent', values: { Account: 'Checking' } });
  const linked = call(w, 'weave_update_field', { db: 'Transaction', field: 'Account', type: 'relation', config: { targetDb: 'Account' } });
  assert.equal(linked.type, 'relation');
  assert.equal(linked.hints, undefined, 'a relation is not hinted again');
});

test('options all slate and status options with no icons are hinted; meaningful ones are not (Issue #581)', () => {
  const w = budget();
  const grey = call(w, 'weave_add_field', { db: 'Transaction', name: 'Kind', type: 'select', config: { options: [{ name: 'Income' }, { name: 'Expense' }] } });
  assert.ok(has(grey.hints, /slate/), JSON.stringify(grey));
  const status = call(w, 'weave_add_field', { db: 'Transaction', name: 'Status', type: 'select', config: { options: [{ name: 'Cleared', hue: 'green' }, { name: 'Pending', hue: 'amber' }] } });
  assert.ok(!has(status.hints, /slate/), 'a hue on any option answers the colour hint');
  assert.ok(has(status.hints, /icon/), 'a status with no icons is hinted');
  const marked = call(w, 'weave_add_field', { db: 'Transaction', name: 'Stage', type: 'select', config: { options: [{ name: 'Cleared', hue: 'green', icon: 'lucide:check' }, { name: 'Pending', icon: 'lucide:clock' }] } });
  assert.equal(marked.hints, undefined, JSON.stringify(marked.hints));
  const flow = call(w, 'weave_add_field', { db: 'Transaction', name: 'Review', type: 'workflow', config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  assert.ok(has(flow.hints, /each state an icon/), JSON.stringify(flow));
});

test('a key the type does not take is named instead of vanishing', () => {
  const w = budget();
  const r = call(w, 'weave_add_field', { db: 'Transaction', name: 'Kind', type: 'select', config: { options: [{ name: 'A', hue: 'red' }, { name: 'B' }], colour: 'red' } });
  assert.ok(has(r.hints, /^Ignored colour: select takes options/), JSON.stringify(r.hints));
  const fine = call(w, 'weave_add_field', { db: 'Transaction', name: 'Note', type: 'text', config: { width: 200, description: 'free text' } });
  assert.equal(fine.hints, undefined, 'width and description are every field\'s');
});

test('weave_update_field answers with the branch the change opened', () => {
  const w = budget();
  call(w, 'weave_add_field', { db: 'Transaction', name: 'Amount', type: 'number' });
  const r = call(w, 'weave_update_field', { db: 'Transaction', field: 'Amount', config: { format: 'currency', currency: 'USD' } });
  assert.ok(has(r.next, /^accounting:/), JSON.stringify(r));
  assert.equal(r.hints, undefined, 'the money hint is answered');
});

test('a space or table named after its workspace is hinted; an icon-less one is asked for an icon (Issues #578, #581)', () => {
  const w = new Weave();
  call(w, 'weave_workspace', { action: 'update', name: 'budget' });
  const space = call(w, 'weave_create_space', { name: 'Budget' });
  assert.ok(has(space.hints, /repeats the workspace name/), JSON.stringify(space));
  assert.ok(has(space.hints, /No icon/), 'a space with no icon is asked for one');
  const table = call(w, 'weave_create_table', { space: 'Budget', name: 'Transaction', icon: 'lucide:receipt' });
  assert.equal(table.hints, undefined, JSON.stringify(table));
  assert.deepEqual(containerHints('space', { name: 'Budget', icon: 'lucide:wallet' }, { workspace: 'personal-finance' }), []);
});

test('the hints are pure: the field passed in is not touched', () => {
  const field = Object.freeze({ type: 'number', name: 'Amount', config: Object.freeze({}) });
  assert.equal(fieldHints(field).length, 1);
});

test('REST and the CLI answer with the same guidance (Issue #579)', async () => {
  const w = budget();
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/tables/Transaction/fields`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Amount', type: 'number' }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.ok(has(body.next, /^format:/) && has(body.hints, /currency/), JSON.stringify(body));
    assert.equal(w.getField('Transaction', 'Amount').next, undefined, 'nothing is stored on the field');
  } finally { server.close(); }

  const dir = mkdtempSync(join(tmpdir(), 'weave-hints-'));
  try {
    const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', join(dir, 'ws.db')], { encoding: 'utf8' });
    cli('space', 'create', 'Budget');
    cli('table', 'create', 'Budget', 'Transaction');
    const out = JSON.parse(cli('field', 'add', 'Transaction', 'Amount', 'number'));
    assert.ok(has(out.next, /^format:/) && has(out.hints, /currency/), JSON.stringify(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
