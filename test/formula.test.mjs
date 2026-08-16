import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/formula.js';

const fields = { Price: 10, Qty: 3, Name: 'Widget', Done: true, Empty: null, Tags: ['a', 'b'] };
const get = (name) => {
  if (!(name in fields)) throw new Error(`unknown field ${name}`);
  return fields[name];
};

test('arithmetic and precedence', () => {
  assert.equal(evaluate('1 + 2 * 3', get), 7);
  assert.equal(evaluate('(1 + 2) * 3', get), 9);
  assert.equal(evaluate('10 / 4', get), 2.5);
  assert.equal(evaluate('10 % 3', get), 1);
  assert.equal(evaluate('-5 + 2', get), -3);
});

test('field references, bare and bracketed', () => {
  assert.equal(evaluate('Price * Qty', get), 30);
  assert.equal(evaluate('[Price] * [Qty]', get), 30);
});

test('string concat with +', () => {
  assert.equal(evaluate('"Total: " + Price', get), 'Total: 10');
  assert.equal(evaluate('Name + "!"', get), 'Widget!');
});

test('comparisons and logic', () => {
  assert.equal(evaluate('Price > 5', get), true);
  assert.equal(evaluate('Price = 10', get), true);
  assert.equal(evaluate('Price != 10', get), false);
  assert.equal(evaluate('Price > 5 and Qty < 2', get), false);
  assert.equal(evaluate('Price > 5 or Qty < 2', get), true);
  assert.equal(evaluate('!Done', get), false);
});

test('functions', () => {
  assert.equal(evaluate('if(Price > 5, "big", "small")', get), 'big');
  assert.equal(evaluate('concat(Name, " x", Qty)', get), 'Widget x3');
  assert.equal(evaluate('round(10 / 3, 2)', get), 3.33);
  assert.equal(evaluate('min(Price, Qty)', get), 3);
  assert.equal(evaluate('max(Price, Qty)', get), 10);
  assert.equal(evaluate('len(Name)', get), 6);
  assert.equal(evaluate('len(Tags)', get), 2);
  assert.equal(evaluate('upper(Name)', get), 'WIDGET');
  assert.equal(evaluate('contains(Name, "wid")', get), true);
  assert.equal(evaluate('empty(Empty)', get), true);
  assert.equal(evaluate('empty(Name)', get), false);
  assert.equal(evaluate('days("2026-01-01", "2026-01-11")', get), 10);
  assert.match(evaluate('today()', get), /^\d{4}-\d{2}-\d{2}$/);
});

test('errors', () => {
  assert.throws(() => evaluate('1 +', get));
  assert.throws(() => evaluate('nope(1)', get));
  assert.throws(() => evaluate('[Unclosed', get));
  assert.throws(() => evaluate('"unclosed', get));
});
