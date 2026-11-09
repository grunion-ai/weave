import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIELD_TYPES } from '../src/engine.js';
import { everyTypeWorkspace, roundTrip, edits, EDITS } from './lib/schema-scenarios.mjs';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/schema-mirror.json', import.meta.url), 'utf8'));
const EDITED = edits();
const NAMED = ['Stage', 'Tags', 'Chip', 'Summary', 'Stars', 'Hearts', 'Face', 'Live', 'Plain toggle', 'About'];

const pinEdits = (names) => {
  const picked = EDITED.filter((e) => names.includes(e.name));
  assert.ok(picked.length, `cases for ${names.join(', ')}`);
  for (const e of picked) {
    const i = EDITED.indexOf(e);
    assert.deepEqual(e, GOLDEN.edits[i], `${e.name} ${JSON.stringify(e.change)}`);
  }
};

test('the workspace carries every field type and every edit case is pinned', () => {
  const w = everyTypeWorkspace();
  const types = new Set(Object.values(w.state.tables).flatMap((t) => Object.values(t.fields).map((f) => f.type)));
  assert.deepEqual(FIELD_TYPES.filter((t) => !types.has(t)), []);
  assert.equal(EDITED.length, GOLDEN.edits.length);
  assert.equal(EDITS.length, GOLDEN.edits.length);
});

test('describeSchema writes every field type as the pinned descriptor', () => {
  assert.deepEqual(roundTrip().described, GOLDEN.roundTrip.described);
});

test('applySchema(describeSchema(x)) into a fresh workspace gives the pinned result, and re-applying is a no-op', () => {
  const r = roundTrip();
  assert.deepEqual(r.plan, GOLDEN.roundTrip.plan);
  assert.deepEqual(r.applied, GOLDEN.roundTrip.applied);
  assert.deepEqual(r.again, []);
  assert.deepEqual(r.self, []);
});

test('options: names, colours and icons apply as pinned', () => pinEdits(['Stage', 'Tags']));
test('view config: the chip and card apply as pinned', () => pinEdits(['Chip', 'Summary']));
test('rating: max, icon and colour apply as pinned', () => pinEdits(['Stars', 'Hearts']));
test('avatar: shape applies as pinned', () => pinEdits(['Face']));
test('toggle: on and off labels apply as pinned', () => pinEdits(['Live', 'Plain toggle']));
test('role: the name, description and view roles apply as pinned', () => {
  pinEdits(['Summary', 'About']);
  const roles = (doc) => doc.tables.flatMap((t) => t.fields.filter((f) => f.role).map((f) => `${t.name}.${f.name}=${f.role}`));
  assert.deepEqual(roles(roundTrip().applied), roles(GOLDEN.roundTrip.described));
});
test('every other field type edits through applySchema as pinned', () => {
  pinEdits([...new Set(EDITS.map(([n]) => n))].filter((n) => !NAMED.includes(n)));
});

const strip = (doc) => doc.tables.map((t) => ({ name: t.name, fields: t.fields.map(({ id, inverseFieldId, targetDbId, viaTableId, ...rest }) => rest) }));

test('Issues #1494 to #1496: text literal, toggle labels and credential keystore and parts survive a round trip', () => {
  const r = roundTrip();
  assert.deepEqual(strip(r.applied), strip(r.described));
});

test('Issues #1494, #1495, #1497, #1498: a literal, label, shape or colour edit in a schema document plans an update and lands', () => {
  const cases = [
    ['Note', { literal: false }, (f) => f.literal === undefined],
    ['Live', { on: 'Up', off: 'Down' }, (f) => f.on === 'Up' && f.off === 'Down'],
    ['Face', { shape: 'round' }, (f) => f.shape === 'round'],
    ['Stars', { color: 'accent' }, (f) => f.color === 'accent'],
    ['Hearts', { color: 'ink' }, (f) => f.color === 'ink'],
    ['Amount', { color: 'accent' }, (f) => f.color === 'accent'],
  ];
  for (const [name, change, landed] of cases) {
    const w = everyTypeWorkspace();
    const doc = w.describeSchema();
    const field = doc.find((sp) => sp.space === 'Ops').tables.find((t) => t.name === 'Deal').fields.find((f) => f.name === name);
    Object.assign(field, change);
    assert.deepEqual(w.applySchema(doc).map((p) => `${p.action} ${p.subject}`), [`update-field Ops/Deal.${name}`], `${name} plans an update`);
    const after = w.describeSchema().find((sp) => sp.space === 'Ops').tables.find((t) => t.name === 'Deal').fields.find((f) => f.name === name);
    assert.ok(landed(after), `${name} ${JSON.stringify(change)} landed: ${JSON.stringify(after)}`);
  }
});
