import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = mkdtempSync(join(tmpdir(), 'weave-sec-csv-'));
process.env.WEAVE_KEYSTORE = join(ROOT, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
test.after(() => rmSync(ROOT, { recursive: true, force: true }));

function fresh() {
  const w = new Weave({ keystorePath: process.env.WEAVE_KEYSTORE });
  w.createSpace({ name: 'S' });
  const db = w.createTable({ space: 'S', name: 'Item' });
  w.addField(db, { name: 'Note', type: 'text' });
  w.addField(db, { name: 'Points', type: 'number' });
  w.addField(db, { name: 'Tags', type: 'multiselect', config: { options: ['=a', 'b'] } });
  return { w, db };
}

const DANGEROUS = ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd', "'=already", "''=twice"];
const lineFor = (csv, name) => csv.split('\n').find((l) => l.includes(`,${name},`));

test('exportCSV prefixes a cell that opens on = + - @ tab or CR with a quote; a number is left as a number (Issue #531)', () => {
  const { w, db } = fresh();
  DANGEROUS.forEach((note, i) => w.createEntity(db, { name: `n${i}`, values: { Note: note, Points: -12 } }));
  w.createEntity(db, { name: 'plain', values: { Note: 'abc', Points: 7 } });
  w.createEntity(db, { name: 'tagged', values: { Tags: ['=a', 'b'] } });
  const csv = w.exportCSV(db);
  assert.match(csv, /^Public Id,Name,Description,Note,Points,Tags,/);
  DANGEROUS.forEach((note, i) => {
    const cell = note.includes('\r') ? `"'${note}"` : `'${note}`;
    assert.ok(lineFor(csv, `n${i}`).includes(`,${cell},-12,`), `${JSON.stringify(note)} is written as ${JSON.stringify(cell)}: ${JSON.stringify(lineFor(csv, `n${i}`))}`);
  });
  assert.ok(lineFor(csv, 'plain').includes(',abc,7,'), 'a harmless cell is untouched');
  assert.ok(lineFor(csv, 'tagged').includes(",'=a; b,"), 'a joined list is one cell and gets one quote');
  for (const line of csv.split('\n')) assert.doesNotMatch(line, /(^|,)[=+@\t]|(^|,)-(?!\d)/, `no cell opens on a formula character, a negative number aside: ${JSON.stringify(line)}`);
});

test('importCSV strips the one quote the export added, so the round trip is lossless and -12 stays a number (Issue #531)', () => {
  const { w, db } = fresh();
  DANGEROUS.forEach((note, i) => w.createEntity(db, { name: `n${i}`, values: { Note: note, Points: -12 } }));
  w.createEntity(db, { name: 'tagged', values: { Tags: ['=a', 'b'] } });
  const csv = w.exportCSV(db);
  const { w: w2, db: db2 } = fresh();
  const result = w2.importCSV(db2, csv);
  assert.deepEqual(result.errors, []);
  assert.equal(result.created, DANGEROUS.length + 1);
  const rows = Object.fromEntries(w2.query(db2, {}).items.map((e) => [e.name, e.fields]));
  DANGEROUS.forEach((note, i) => {
    assert.equal(rows[`n${i}`].Note, note, JSON.stringify(note));
    assert.equal(rows[`n${i}`].Points, -12);
    assert.equal(typeof rows[`n${i}`].Points, 'number');
  });
  assert.deepEqual(rows.tagged.Tags, ['=a', 'b']);
});

test('importCSV strips a leading quote only when a formula character follows it (Issue #531)', () => {
  const { w, db } = fresh();
  const result = w.importCSV(db, "Name,Note,Points\na,'=cmd,'-3\nb,'abc,4\nc,-5,-6\n");
  assert.deepEqual(result.errors, []);
  const rows = Object.fromEntries(w.query(db, {}).items.map((e) => [e.name, e.fields]));
  assert.equal(rows.a.Note, '=cmd');
  assert.equal(rows.a.Points, -3);
  assert.equal(rows.b.Note, "'abc", 'an apostrophe before a letter is content');
  assert.equal(rows.c.Note, '-5', 'a bare negative in a text column is text');
  assert.equal(rows.c.Points, -6);
});
