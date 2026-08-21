import test from 'node:test';
import assert from 'node:assert/strict';

/* The type-or-pick control's parser (Feature #44). A classic script that also
   loads in node: importing it registers parseNaturalDate on globalThis. */
await import('../public/nl-date.js');
const parse = globalThis.parseNaturalDate;
const NOW = new Date(2026, 7, 21); // Fri Aug 21 2026, local

test('typed dates beat phrases', () => {
  assert.equal(parse('2026-08-21', NOW), '2026-08-21');
  assert.equal(parse('8/21', NOW), '2026-08-21');
  assert.equal(parse('21.8.2027', NOW), '2027-08-21');
});

test('the phrases people actually type', () => {
  assert.equal(parse('today', NOW), '2026-08-21');
  assert.equal(parse('tomorrow', NOW), '2026-08-22');
  assert.equal(parse('in 2 weeks', NOW), '2026-09-04');
  assert.equal(parse('next friday', NOW), '2026-08-28');
  assert.equal(parse('monday', NOW), '2026-08-24');
  assert.equal(parse('last monday', NOW), '2026-08-17');
  assert.equal(parse('jun 21', NOW), '2026-06-21');
  assert.equal(parse('21 june 2027', NOW), '2027-06-21');
});

test('garbage is null, never a throw', () => {
  assert.equal(parse('', NOW), null);
  assert.equal(parse('not a date at all', NOW), null);
});
