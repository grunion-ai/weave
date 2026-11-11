import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, check, MAX_RESULT_CHARS } from '../src/formula.js';
import { Weave } from '../src/engine.js';

const KB = 'x'.repeat(1024);
const args = (expr, n) => Array.from({ length: n }, () => expr).join(', ');
const TOO_LONG = /longer than 65536 characters/;

test('the result budget is a character count big enough for real text', () => {
  assert.equal(MAX_RESULT_CHARS, 65536);
});

test('concat refuses to grow a result past the budget (Issue #1604)', () => {
  const get = () => KB;
  assert.equal(evaluate(`concat(${args('Text', 40)})`, get).length, 40 * 1024);
  assert.throws(() => evaluate(`concat(${args('Text', 4000)})`, get), TOO_LONG);
});

test('string + refuses to grow a result past the budget (Issue #1604)', () => {
  const get = () => KB;
  assert.throws(() => evaluate(Array.from({ length: 4000 }, () => 'Text').join(' + '), get), TOO_LONG);
});

test('one oversized value is refused before it is joined (Issue #1604)', () => {
  const get = () => 'y'.repeat(MAX_RESULT_CHARS + 1);
  assert.throws(() => evaluate('concat(Big, "tail")', get), TOO_LONG);
  assert.throws(() => evaluate('Big + "tail"', get), TOO_LONG);
});

test('check still passes an expression whose stand-in values are small (Issue #1604)', () => {
  assert.deepEqual(check(`concat(${args('Text', 4000)})`, ['Text']), { ok: true });
});

function chained(rows) {
  const w = new Weave();
  w.createSpace({ name: 'Probe' });
  const t = w.createTable({ space: 'Probe', name: 'Row' });
  w.addField(t.id, { name: 'Text', type: 'text' });
  w.addField(t.id, { name: 'Boom', type: 'formula', config: { expression: `concat(${args('Text', 40)})` } });
  w.addField(t.id, { name: 'Boom2', type: 'formula', config: { expression: `concat(${args('Boom', 200)})` } });
  for (let i = 0; i < rows; i++) w.createEntity(t.id, { Name: `r${i}`, Text: KB });
  return { w, t };
}

test('a read of a concat chain carries a marker, not megabytes (Issue #1604)', () => {
  const { w, t } = chained(1);
  const row = w.listEntities(t.id)[0];
  const read = w.readEntity(row.id);
  assert.equal(read.fields.Boom.length, 40 * 1024);
  assert.match(read.fields.Boom2, /^#ERR: /);
  assert.match(read.fields.Boom2, TOO_LONG);
});

test('a grid page over a concat chain stays inside the budget (Issue #1604)', () => {
  const { w, t } = chained(60);
  const page = w.query(t.id, { limit: 60 });
  assert.equal(page.items.length, 60);
  for (const item of page.items) {
    assert.match(item.fields.Boom2, TOO_LONG);
    assert.ok(item.fields.Boom2.length <= MAX_RESULT_CHARS, 'no row holds an unbounded string');
  }
});

test('the formula preview answers instead of exhausting the heap (Issue #1604)', () => {
  const { w, t } = chained(1);
  const previewed = w.checkFormula(t.id, `concat(${args('Boom2', 200)})`, { scan: true });
  assert.equal(previewed.ok, true);
  assert.match(String(previewed.preview), TOO_LONG);
  assert.ok(String(previewed.preview).length <= MAX_RESULT_CHARS, 'the preview is bounded too');
  assert.equal(previewed.scan.rows, 1);
});
