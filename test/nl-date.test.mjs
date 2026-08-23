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

/* Smart typing (Kyle, 2026-08-23): "type the date month year in any format
   and autodetect, like Airtable and Fibery". Everything a person pastes or
   types lands on the day they meant. */
test('any numeric order: slashes, dashes, dots, 2- or 4-digit years, day-first when unambiguous', () => {
  assert.equal(parse('9/15/2026', NOW), '2026-09-15');
  assert.equal(parse('15/9/2026', NOW), '2026-09-15', 'day > 12 means day-first');
  assert.equal(parse('15-09-2026', NOW), '2026-09-15');
  assert.equal(parse('09-15-2026', NOW), '2026-09-15');
  assert.equal(parse('2026/09/15', NOW), '2026-09-15');
  assert.equal(parse('15.9.26', NOW), '2026-09-15');
  assert.equal(parse('9/15/26', NOW), '2026-09-15');
});

test('a day-first hint (eu-format fields) settles the ambiguous numerics', () => {
  assert.equal(parse('3/4/2026', NOW), '2026-03-04');
  assert.equal(parse('3/4/2026', NOW, { dayFirst: true }), '2026-04-03');
});

test('month names in any position, with commas, ordinals, 4-letter abbreviations, or only a month + year', () => {
  assert.equal(parse('15 sep 2026', NOW), '2026-09-15');
  assert.equal(parse('Sep 15, 2026', NOW), '2026-09-15');
  assert.equal(parse('Sept 15', NOW), `${NOW.getFullYear()}-09-15`);
  assert.equal(parse('15th September 2026', NOW), '2026-09-15');
  assert.equal(parse('september 2026', NOW), '2026-09-01');
  assert.equal(parse('2026 sep 15', NOW), '2026-09-15');
});

test('a pasted datetime keeps its day; stray whitespace is fine', () => {
  assert.equal(parse('2026-09-15T14:30', NOW), '2026-09-15');
  assert.equal(parse('  2026-09-15 14:30 ', NOW), '2026-09-15');
});
