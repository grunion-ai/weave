import test from 'node:test';
import assert from 'node:assert/strict';
import { check, evaluate, MAX_EXPRESSION_CHARS, MAX_EXPRESSION_DEPTH } from '../src/formula.js';
import { Weave } from '../src/engine.js';

const TOO_LONG = /Formula is longer than 8192 characters/;
const TOO_DEEP = /Formula nests more than 100 levels deep/;
const STACK = /call stack/i;

function sized(chars) {
  const body = '1' + '+1'.repeat(Math.floor((chars - 1) / 2));
  return body + ' '.repeat(chars - body.length);
}

const nested = (levels) => '('.repeat(levels) + '1' + ')'.repeat(levels);
const negated = (levels) => '-'.repeat(levels) + '1';

function ifChain(levels) {
  let expr = '0';
  for (let i = 0; i < levels; i++) expr = `if(Amount > ${i}, ${i}, ${expr})`;
  return expr;
}

function probe(rows = 0, expression = null) {
  const w = new Weave();
  w.createSpace({ name: 'Probe' });
  const t = w.createTable({ space: 'Probe', name: 'Row' });
  w.addField(t.id, { name: 'Amount', type: 'number' });
  for (let i = 0; i < rows; i++) w.createEntity(t.id, { Name: `r${i}`, Amount: i });
  if (expression) w.addField(t.id, { name: 'Total', type: 'formula', config: { expression } });
  return { w, t };
}

test('the expression budget is a documented length and nesting depth (Issues #1605, #1612)', () => {
  assert.equal(MAX_EXPRESSION_CHARS, 8192);
  assert.equal(MAX_EXPRESSION_DEPTH, 100);
});

test('check takes an expression at the length budget and refuses one character more (Issue #1605)', () => {
  const atCap = sized(MAX_EXPRESSION_CHARS);
  assert.equal(atCap.length, MAX_EXPRESSION_CHARS);
  assert.deepEqual(check(atCap), { ok: true });
  const overCap = sized(MAX_EXPRESSION_CHARS + 1);
  const refused = check(overCap);
  assert.equal(refused.ok, false);
  assert.match(refused.error, TOO_LONG);
});

test('addField and updateField inherit the length budget (Issue #1605)', () => {
  const { w, t } = probe(1);
  const overCap = sized(MAX_EXPRESSION_CHARS + 1);
  assert.throws(() => w.addField(t.id, { name: 'Huge', type: 'formula', config: { expression: overCap } }), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, TOO_LONG);
    return true;
  });
  w.addField(t.id, { name: 'Total', type: 'formula', config: { expression: 'Amount + 1' } });
  assert.throws(() => w.updateField(t.id, 'Total', { config: { expression: overCap } }), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, TOO_LONG);
    return true;
  });
});

test('check takes nesting at the depth budget and refuses one level more (Issue #1612)', () => {
  assert.deepEqual(check(nested(MAX_EXPRESSION_DEPTH)), { ok: true });
  assert.deepEqual(check(negated(MAX_EXPRESSION_DEPTH)), { ok: true });
  for (const deep of [nested(MAX_EXPRESSION_DEPTH + 1), negated(MAX_EXPRESSION_DEPTH + 1)]) {
    const refused = check(deep);
    assert.equal(refused.ok, false);
    assert.match(refused.error, TOO_DEEP);
    assert.doesNotMatch(refused.error, STACK);
  }
});

test('a formula that nests the way a real one does still passes (Issue #1612)', () => {
  assert.deepEqual(check(ifChain(30), ['Amount']), { ok: true });
  assert.equal(evaluate(ifChain(30), () => 5), 4);
});

test('the inputs that used to answer with V8 stack text name a limit instead (Issues #1605, #1612)', () => {
  for (const hostile of [nested(2000), nested(50000), negated(100000)]) {
    const refused = check(hostile);
    assert.equal(refused.ok, false);
    assert.doesNotMatch(refused.error, STACK);
    assert.match(refused.error, /Formula (is longer than|nests more than)/);
  }
});

test('addField answers a worded limit, not a RangeError, on a deep expression (Issue #1612)', () => {
  const { w, t } = probe(1);
  assert.throws(() => w.addField(t.id, { name: 'Deep', type: 'formula', config: { expression: nested(2000) } }), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, TOO_DEEP);
    assert.doesNotMatch(err.message, STACK);
    return true;
  });
});

test('a grid page over a formula at the length budget stays inside its millisecond budget (Issue #1605)', () => {
  const { w, t } = probe(200, sized(MAX_EXPRESSION_CHARS));
  const started = performance.now();
  const page = w.query(t.id, { limit: 200 });
  const ms = performance.now() - started;
  assert.equal(page.items.length, 200);
  assert.ok(ms < 1000, `a 200-row page over the longest allowed formula took ${Math.round(ms)}ms, budget 1000ms`);
});

test('the check surface the CLI, route and MCP tool share answers the same limits (Issues #1605, #1612)', () => {
  const { w, t } = probe(1);
  assert.deepEqual(w.checkFormula(t.id, sized(MAX_EXPRESSION_CHARS + 1)), {
    ok: false,
    error: `Formula is longer than ${MAX_EXPRESSION_CHARS} characters`,
  });
  assert.deepEqual(w.checkFormula(t.id, nested(MAX_EXPRESSION_DEPTH + 1)), {
    ok: false,
    error: `Formula nests more than ${MAX_EXPRESSION_DEPTH} levels deep`,
  });
  assert.equal(w.checkFormula(t.id, 'Amount + 1').ok, true);
});
