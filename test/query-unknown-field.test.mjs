import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave, WeaveError } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

function deals(rows = []) {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Deal' });
  w.addField(t, { name: 'Due', type: 'date' });
  w.addField(t, { name: 'Owner', type: 'text' });
  for (const d of rows) w.createEntity(t, { name: d, values: { Due: d } });
  return { w, t };
}

const message = (fn) => {
  try { fn(); } catch (e) { return { code: e.code, message: e.message }; }
  return null;
};

const TYPOS = [
  { name: 'a misspelt where field', opts: { where: [['Nope', '=', 1]] } },
  { name: 'a misspelt where field inside an or group', opts: { where: [{ or: [['Due', 'not-empty'], ['Nope', 'is-empty']] }] } },
  { name: 'a misspelt sort field', opts: { sort: ['Bogus'] } },
  { name: 'a misspelt sort object field', opts: { sort: [{ field: 'Bogus', dir: 'desc' }] } },
];

for (const c of TYPOS) {
  test(`query answers ${c.name} the same way on an empty and a full table (Issue #1618)`, () => {
    const empty = message(() => deals().w.query('S/Deal', c.opts));
    const full = message(() => deals(['2026-09-15', '2026-10-15']).w.query('S/Deal', c.opts));
    assert.ok(full, 'the full table refuses the typo');
    assert.equal(full.code, 'not-found');
    assert.match(full.message, /; fields: /);
    assert.deepEqual(empty, full);
  });
}

test('query still accepts the system paths a condition and a sort can name on an empty table (Issue #1618)', () => {
  const { w } = deals();
  for (const path of ['id', 'publicId', 'Public Id', 'createdAt', 'updatedAt']) {
    assert.equal(w.query('S/Deal', { where: [[path, 'not-empty']], sort: [path] }).total, 0, path);
  }
});

test('MCP weave_query refuses a misspelt where field on an empty table (Issue #1618)', () => {
  const { w } = deals();
  assert.throws(() => dispatchTool(w, 'weave_query', { db: 'S/Deal', where: [['Nope', '=', 1]] }), (e) => e instanceof WeaveError && e.code === 'not-found' && /Nope/.test(e.message));
});

test('a bare condition passed as where is answered with the wrapped shape (Issue #1618)', () => {
  const { w } = deals(['2026-09-15']);
  const bare = message(() => w.query('S/Deal', { where: ['Owner', '=', 'Kyle'] }));
  assert.equal(bare.code, 'invalid');
  assert.match(bare.message, /\[\["Owner","=","Kyle"\]\]/);
  const object = message(() => w.query('S/Deal', { where: { field: 'Owner', op: '=', value: 'Kyle' } }));
  assert.equal(object.code, 'invalid');
  assert.match(object.message, /\[path, operator, value\]/);
});

test('tableStats accepts a two-item condition and names the shape for a bad node (Issue #1618)', () => {
  const { w } = deals(['2026-09-15', '']);
  assert.equal(w.tableStats('S/Deal', { where: [['Due', 'not-empty']] }).rows, 1);
  const bad = message(() => w.tableStats('S/Deal', { where: ['Due', 'not-empty'] }));
  assert.equal(bad.code, 'invalid');
  assert.match(bad.message, /\[path, operator, value\]/);
});

test('the date field handbook query example returns the rows it describes (Issue #1618)', () => {
  const page = readFileSync(new URL('../src/handbook/fields/date.md', import.meta.url), 'utf8');
  const block = page.split('## Query')[1].match(/```json\n([\s\S]*?)\n```/)[1];
  const { where } = JSON.parse(block);
  const { w } = deals(['2026-09-15', '2026-10-15', '2026-11-15']);
  w.createEntity('S/Deal', { name: 'undated' });
  assert.deepEqual(w.query('S/Deal', { where }).items.map((r) => r.name), ['2026-09-15']);
});
