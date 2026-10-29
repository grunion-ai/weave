import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed } from '../scripts/bench-query.mjs';
import { fnBody } from './lib/source.mjs';

const ROWS = 2000;
const PAGE = 200;
const PAGE_BUDGET_BYTES = 400 * 1024;
const WHOLE_TO_PAGE_RATIO = 10;

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const sized = (n) => `${n.toLocaleString('en-US')} bytes`;

const seeded = () => {
  const w = new Weave();
  const { row } = seed(w, { rows: ROWS, owners: 400 });
  return { w, row };
};

const tableOpen = (w, row) => w.query(row.id, {
  limit: PAGE,
  offset: 0,
  fields: ['Name', 'Amount', 'Due', 'Stage', 'Owner'],
  relations: 'chip',
  trashCount: true,
  countAll: true,
});

test('opening a table asks for one page with chip relations, never the whole table (Issue #1194)', () => {
  const body = fnBody('readAndDrawTable');
  assert.match(body, /limit: globalThis\.WeaveGridWindow\.PAGE/, 'the paged path must send a limit');
  assert.match(body, /offset: 0/, 'the paged path must send an offset');
  assert.match(body, /relations: 'chip'/, 'a list query must resolve relations to chips, not full rows');
  assert.match(body, /fields: gridFields\(db\)/, 'a list query must project only the fields the view draws');
});

test('opening a table counts the trash in the query instead of fetching it (Issue #1194)', () => {
  const body = fnBody('readAndDrawTable');
  assert.match(body, /trashCount: true/, 'the open query must carry trashCount');
  assert.doesNotMatch(body, /\/trash/, 'the table-open path must not fetch the trash; the trash panel loads it');
});

test(`a ${ROWS}-row table opens in under ${PAGE_BUDGET_BYTES / 1024} KB, not the whole-table payload (Issue #1194)`, (t) => {
  const { w, row } = seeded();
  const page = tableOpen(w, row);
  const whole = w.query(row.id, {});
  const pageBytes = bytes(page);
  const wholeBytes = bytes(whole);
  t.diagnostic(`table open ${sized(pageBytes)} for ${page.items.length} rows; whole table ${sized(wholeBytes)} for ${whole.items.length} rows`);
  assert.equal(page.items.length, PAGE);
  assert.equal(page.total, ROWS);
  assert.ok(pageBytes < PAGE_BUDGET_BYTES, `table open sends ${sized(pageBytes)}, budget ${sized(PAGE_BUDGET_BYTES)}: Issue #1194 was a 10 MB open that froze the tab for 17 to 52 s`);
  assert.ok(wholeBytes > pageBytes * WHOLE_TO_PAGE_RATIO, `the whole-table payload (${sized(wholeBytes)}) must stay at least ${WHOLE_TO_PAGE_RATIO}x the page (${sized(pageBytes)}), or this budget is measuring nothing`);
});

test('a chip relation carries the id, number and name, never the related row (Issue #1194)', () => {
  const { w, row } = seeded();
  const chip = tableOpen(w, row).items[0].fields.Owner;
  assert.deepEqual(Object.keys(chip).sort(), ['id', 'name', 'publicId']);
  const full = w.query(row.id, { limit: 1, relations: 'full' }).items[0].fields.Owner;
  assert.ok(bytes(full) > bytes(chip) * 2, `a full relation (${sized(bytes(full))}) renders the related row; a chip (${sized(bytes(chip))}) must not`);
});
