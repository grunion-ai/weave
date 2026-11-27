import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seeded } from './lib/fixtures.mjs';

function chain(length) {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'L0', type: 'text' });
  for (let n = 1; n <= length; n++) {
    w.addField(t.id, { name: `L${n}`, type: 'formula', config: { expression: `concat(L${n - 1}, "")` } });
  }
  const e = w.createEntity(t.id, { Name: 'Acme', L0: 'seed' });
  return { w, t, e };
}

test('a chain past the depth limit reads #DEPTH with its path, not null (Issue #1607)', () => {
  const { w, e } = chain(10);
  const row = w.getEntity(e.id);
  for (let n = 1; n <= 8; n++) assert.equal(w.resolveField(row, `L${n}`), 'seed', `L${n} is inside the limit`);
  assert.equal(w.resolveField(row, 'L9'), '#DEPTH: L9 → L8 → L7 → L6 → L5 → L4 → L3 → L2 → L1 → L0');
  assert.equal(w.resolveField(row, 'L10'), '#DEPTH: L10 → L9 → L8 → L7 → L6 → L5 → L4 → L3 → L2 → L1');
  const read = w.readEntity(e.id);
  assert.match(String(read.fields.L9), /^#DEPTH: /, 'the row read carries the marker');
  assert.match(String(read.fields.L10), /^#DEPTH: /);
});

test('a rollup over a cut-off value reports the marker rather than aggregating it (Issue #1607)', () => {
  const { w, t, e } = chain(9);
  w.addRelation(t.id, { name: 'Peer', targetDb: t.id, cardinality: 'many-to-many', inverseName: 'PeerOf' });
  w.addField(t.id, { name: 'Joined', type: 'rollup', config: { relationField: 'Peer', targetField: 'L8', aggregate: 'join' } });
  w.addField(t.id, { name: 'Seen', type: 'lookup', config: { relationField: 'Peer', targetField: 'L8' } });
  const top = w.createEntity(t.id, { Name: 'Top' });
  w.updateEntity(top.id, { Peer: [e.id] });
  const row = w.getEntity(top.id);
  assert.match(String(w.resolveField(row, 'Joined')), /^#DEPTH: Top › Joined → Acme › L8 → /);
  assert.match(String(w.resolveField(row, 'Seen')), /^#DEPTH: Top › Seen → Acme › L8 → /);
});

test('checkFormula counts a depth cutoff as an error and samples its marker (Issue #1607)', () => {
  const { w, t } = chain(8);
  const verdict = w.checkFormula(t.id, 'concat(L8, "")', { scan: true });
  assert.equal(verdict.type, 'error');
  assert.match(String(verdict.preview), /^#DEPTH: /);
  assert.equal(verdict.scan.errors, 1);
  assert.equal(verdict.scan.nulls, 0);
  assert.match(verdict.scan.sampleByOutcome.error.error, /^#DEPTH: /);
});

test('the formula, lookup and rollup guides name the depth limit (Issue #1607)', () => {
  for (const doc of ['formula', 'lookup', 'rollup']) {
    const text = readFileSync(new URL(`../src/handbook/fields/${doc}.md`, import.meta.url), 'utf8');
    assert.match(text, /#DEPTH:/, `${doc}.md names the marker`);
    assert.match(text, /eight/, `${doc}.md names the limit`);
  }
});
