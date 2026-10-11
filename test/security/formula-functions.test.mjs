import test from 'node:test';
import assert from 'node:assert/strict';
import { check, evaluate } from '../../src/formula.js';

const INHERITED = ['constructor', '__proto__', 'prototype', 'hasOwnProperty', 'toString', 'valueOf', 'CONSTRUCTOR'];

test('an inherited object name is not a formula function: check reports it unknown (Issue #530)', () => {
  for (const name of INHERITED) {
    const out = check(`${name}(1)`);
    assert.equal(out.ok, false, name);
    assert.equal(out.error, `Unknown function '${name}'`, name);
  }
  assert.deepEqual(check('round(1.5)'), { ok: true });
});

test('evaluate throws the unknown-function error for an inherited name instead of calling Object (Issue #530)', () => {
  for (const name of INHERITED) {
    assert.throws(() => evaluate(`${name}(1)`, () => 0), { message: `Unknown function '${name}'` }, name);
  }
  assert.equal(evaluate('ROUND(1.5)', () => 0), 2, 'a real function keeps resolving case-insensitively');
});
