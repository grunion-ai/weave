/* Tests for public/field-dialog-core.js — the pure logic behind the unified
   field dialog (design review 2026-08-22: direction A+E). The dialog's state
   object, the canonical {type, config} definition it round-trips with the
   code pane, and the client-side mirror of the engine's config validation.
   Source-contract tests keep the catalog and formula function list from
   drifting away from src/engine.js and src/formula.js. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

await import('../public/field-dialog-core.js');
const core = globalThis.fieldDialogCore;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
const FORMULA = readFileSync(join(ROOT, 'src/formula.js'), 'utf8');

/* ---------- source contracts ---------- */

test('type catalog matches the engine DEFINABLE_TYPES exactly', () => {
  const literal = ENGINE.match(/export const DEFINABLE_TYPES = \[([\s\S]*?)\];/)[1];
  const engineTypes = [...literal.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  // relation is a grid tile too (Kyle, 2026-08-23) but is created through
  // addRelation, not addField — it sits outside DEFINABLE_TYPES.
  const gridTypes = core.FIELD_TYPES.filter((t) => !t.computed && t.id !== 'relation').map((t) => t.id);
  assert.deepEqual(gridTypes.sort(), [...engineTypes].sort());
  assert.ok(core.FIELD_TYPES.some((t) => t.id === 'relation'), 'relation is a type of field');
});

test('computed catalog entries are lookup and rollup (formula is the toggle)', () => {
  const computed = core.FIELD_TYPES.filter((t) => t.computed).map((t) => t.id);
  assert.deepEqual(computed.sort(), ['lookup', 'rollup']);
});

test('formula function list matches FUNCS keys in src/formula.js', () => {
  const body = FORMULA.match(/const FUNCS = \{([\s\S]*?)\n\};/)[1];
  const keys = [...body.matchAll(/^  ([a-z][a-z0-9]*):/gm)].map((m) => m[1]);
  assert.deepEqual(core.FORMULA_FUNCTIONS.map((f) => f.name).sort(), [...keys].sort());
});

test('state categories match the engine', () => {
  const literal = ENGINE.match(/const STATE_CATEGORIES = \[([\s\S]*?)\];/)[1];
  const cats = [...literal.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(core.STATE_CATEGORIES, cats);
});

test('aggregates match the engine', () => {
  const literal = ENGINE.match(/const AGGREGATES = \[([\s\S]*?)\];/)[1];
  const aggs = [...literal.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(core.AGGREGATES, aggs);
});

/* ---------- definitionFromState ---------- */

test('select state produces options config, colors kept', () => {
  const def = core.definitionFromState({
    type: 'select',
    options: [{ name: 'Low', color: '#2ea043' }, { name: 'High', color: '' }],
  });
  assert.deepEqual(def, {
    type: 'select',
    config: { options: [{ name: 'Low', color: '#2ea043' }, { name: 'High', color: '' }] },
  });
});

test('workflow state produces states config with categories, in list order, no default flag', () => {
  const def = core.definitionFromState({
    type: 'workflow',
    states: [
      { name: 'Open', category: 'not-started' },
      { name: 'Doing', category: 'in-progress' },
    ],
  });
  assert.deepEqual(def.config.states, [{ name: 'Open', category: 'not-started' }, { name: 'Doing', category: 'in-progress' }]);
});

test('number config is canonical-minimal, like the engine normaliser output', () => {
  // format 'number' and empty unit are defaults — they must not appear.
  const plain = core.definitionFromState({ type: 'number', number: { format: 'number', unit: '', decimals: null, separator: false } });
  assert.deepEqual(plain, { type: 'number', config: {} });
  const rich = core.definitionFromState({ type: 'number', number: { format: 'currency', currency: 'USD', decimals: 2, separator: true } });
  assert.deepEqual(rich.config, { format: 'currency', currency: 'USD', decimals: 2, separator: true });
});

test('date config drops iso format, keeps time only when true', () => {
  assert.deepEqual(core.definitionFromState({ type: 'date', date: { format: 'iso', time: false } }).config, {});
  assert.deepEqual(core.definitionFromState({ type: 'date', date: { format: 'long', time: true } }).config, { format: 'long', time: true });
});

test('field type carries depth', () => {
  assert.deepEqual(core.definitionFromState({ type: 'field', depth: 3 }).config, { depth: 3 });
});

test('formula toggle wins over the grid type', () => {
  const def = core.definitionFromState({
    type: 'number', computed: 'formula', expression: 'if(Estimate > 5, "big", "small")',
  });
  assert.deepEqual(def, { type: 'formula', config: { expression: 'if(Estimate > 5, "big", "small")' } });
});

test('rollup includes targetField only when aggregate needs one', () => {
  const count = core.definitionFromState({ type: 'rollup', relationField: 'Tasks', aggregate: 'count', targetField: 'Estimate' });
  assert.deepEqual(count.config, { relationField: 'Tasks', aggregate: 'count' });
  const sum = core.definitionFromState({ type: 'rollup', relationField: 'Tasks', aggregate: 'sum', targetField: 'Estimate' });
  assert.deepEqual(sum.config, { relationField: 'Tasks', aggregate: 'sum', targetField: 'Estimate' });
});

test('default value is typed per field type, empty means absent', () => {
  assert.equal(core.definitionFromState({ type: 'text', default: '' }).config.default, undefined);
  assert.equal(core.definitionFromState({ type: 'checkbox', default: 'true' }).config.default, true);
  assert.equal(core.definitionFromState({ type: 'number', default: '5' }).config.default, 5);
  assert.deepEqual(core.definitionFromState({ type: 'multiselect', options: [], default: 'a, b' }).config.default, ['a', 'b']);
});

/* ---------- stateFromDefinition round trip ---------- */

test('definition -> state -> definition round-trips for every shape', () => {
  const defs = [
    { type: 'text', config: {} },
    { type: 'select', config: { options: [{ name: 'A', color: '' }, { name: 'B', color: '#e5484d' }] } },
    { type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started' }] } },
    { type: 'number', config: { format: 'percent', decimals: 1 } },
    { type: 'date', config: { format: 'us', time: true } },
    { type: 'field', config: { depth: 2 } },
    { type: 'formula', config: { expression: 'len(Name)' } },
    { type: 'rollup', config: { relationField: 'Tasks', aggregate: 'sum', targetField: 'Estimate' } },
    { type: 'lookup', config: { relationField: 'Project', targetField: 'Owner' } },
  ];
  for (const def of defs) {
    const state = core.stateFromDefinition(def);
    assert.deepEqual(core.definitionFromState(state), def, `round trip failed for ${def.type}`);
  }
});

test('string options normalise into {name, color} state rows', () => {
  const state = core.stateFromDefinition({ type: 'select', config: { options: ['A', 'B'] } });
  assert.deepEqual(state.options, [{ name: 'A', color: '' }, { name: 'B', color: '' }]);
});

/* ---------- code pane: serialize + parse ---------- */

test('serializeDefinition emits pretty JSON that parseDefinition accepts', () => {
  const state = core.stateFromDefinition({ type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  const text = core.serializeDefinition(state);
  assert.match(text, /"currency"/);
  const parsed = core.parseDefinition(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.def, core.definitionFromState(state));
});

test('parseDefinition: malformed JSON fails with a message, never throws', () => {
  const r = core.parseDefinition('{ "type": "number", ');
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});

test('parseDefinition rejects unknown types, naming the allowed set', () => {
  const r = core.parseDefinition('{ "type": "portal", "config": {} }');
  assert.equal(r.ok, false);
  assert.match(r.error, /portal/);
});

test('parseDefinition mirrors engine bounds: decimals 0..6, depth 1..4', () => {
  const dec = core.parseDefinition('{ "type": "number", "config": { "decimals": 9 } }');
  assert.equal(dec.ok, false);
  assert.match(dec.error, /0\.\.6/);
  const dep = core.parseDefinition('{ "type": "field", "config": { "depth": 9 } }');
  assert.equal(dep.ok, false);
  assert.match(dep.error, /1\.\.4/);
});

test('parseDefinition mirrors engine enums: date format, state category, aggregate', () => {
  assert.match(core.parseDefinition('{ "type": "date", "config": { "format": "dmy" } }').error, /iso, us, eu, long/);
  assert.match(core.parseDefinition('{ "type": "workflow", "config": { "states": [{ "name": "X", "category": "later" }] } }').error, /not-started/);
  assert.match(core.parseDefinition('{ "type": "rollup", "config": { "relationField": "T", "aggregate": "median" } }').error, /count, sum/);
});

test('parseDefinition requires a formula expression and at least one workflow state', () => {
  assert.match(core.parseDefinition('{ "type": "formula", "config": {} }').error, /expression/);
  assert.match(core.parseDefinition('{ "type": "workflow", "config": { "states": [] } }').error, /at least one state/);
});

test('option and state ids survive the round trip when present', () => {
  const def = {
    type: 'select',
    config: { options: [{ id: 'low', name: 'Renamed', color: '' }] },
  };
  const back = core.definitionFromState(core.stateFromDefinition(def));
  assert.equal(back.config.options[0].id, 'low');
  const wf = {
    type: 'workflow',
    config: { states: [{ id: 'open', name: 'Opened', category: 'not-started', default: true }] },
  };
  const wfBack = core.definitionFromState(core.stateFromDefinition(wf));
  assert.equal(wfBack.config.states[0].id, 'open');
});

/* ---------- type migration offer (2026-08-23) ---------- */

test('TYPE_MIGRATIONS mirrors the engine export exactly', async () => {
  const { TYPE_MIGRATIONS } = await import('../src/engine.js');
  assert.deepEqual(core.TYPE_MIGRATIONS, TYPE_MIGRATIONS);
});

test('typeChoices: a new field sees the whole grid; an existing one sees itself plus compatible moves', () => {
  assert.deepEqual(core.typeChoices(null).map((t) => t.id), core.FIELD_TYPES.map((t) => t.id));
  assert.deepEqual(core.typeChoices('select').map((t) => t.id), ['select', 'multiselect', 'workflow', 'text']);
  assert.deepEqual(core.typeChoices('formula').map((t) => t.id), []);
  assert.deepEqual(core.typeChoices('document').map((t) => t.id), ['document']);
  assert.deepEqual(core.typeChoices('relation').map((t) => t.id), ['relation'], 'a relation keeps its type');
});

test('migrateState carries config across a compatible move so the form can be adjusted before saving', () => {
  const sel = core.stateFromDefinition({ type: 'select', config: { options: [{ id: 'lo', name: 'Low', color: '#2ea043' }, { id: 'hi', name: 'High', color: '' }] } });
  const wf = core.migrateState(sel, 'workflow');
  assert.equal(wf.type, 'workflow');
  assert.deepEqual(wf.states.map((s) => [s.id, s.name, s.category]), [['lo', 'Low', 'in-progress'], ['hi', 'High', 'in-progress']]);
  const multi = core.migrateState(sel, 'multiselect');
  assert.deepEqual(multi.options, sel.options);
  const back = core.migrateState(wf, 'select');
  assert.deepEqual(back.options.map((o) => o.name), ['Low', 'High']);
  const num = core.migrateState(core.stateFromDefinition({ type: 'text', config: { default: 'x' } }), 'number');
  assert.equal(num.type, 'number');
  assert.equal(num.default, '', 'a default of the old type does not survive');
});

/* ---------- units vs currency, numbers and formulas (2026-08-23) ---------- */

test('number state: currency code rides `currency`, free text rides `unit`, never both', () => {
  const cur = core.definitionFromState({ type: 'number', number: { format: 'currency', currency: 'EUR', unit: 'days', decimals: 2, separator: false } });
  assert.deepEqual(cur.config, { format: 'currency', currency: 'EUR', decimals: 2 });
  const unit = core.definitionFromState({ type: 'number', number: { format: 'number', currency: 'EUR', unit: 'days', decimals: null, separator: false } });
  assert.deepEqual(unit.config, { unit: 'days' });
});

test('a formula carries the number costume and round-trips it', () => {
  const def = { type: 'formula', config: { expression: 'Price * Count', format: 'currency', currency: 'USD', decimals: 0 } };
  const state = core.stateFromDefinition(def);
  assert.equal(state.number.currency, 'USD');
  assert.deepEqual(core.definitionFromState(state), def);
  const plain = core.definitionFromState({ type: 'text', computed: 'formula', expression: 'len(Name)', number: core.blankState().number });
  assert.deepEqual(plain, { type: 'formula', config: { expression: 'len(Name)' } });
});

test('CURRENCIES lists ISO codes the engine will accept, USD first', () => {
  assert.equal(core.CURRENCIES[0].id, 'USD');
  assert.ok(core.CURRENCIES.length >= 12);
  for (const c of core.CURRENCIES) assert.match(c.id, /^[A-Z]{3}$/);
});

test('the currency list leads with USD, EUR, MXN, CNY, JPY, RUB, CAD (Kyle, 2026-08-23)', () => {
  assert.deepEqual(core.CURRENCIES.slice(0, 7).map((c) => c.id), ['USD', 'EUR', 'MXN', 'CNY', 'JPY', 'RUB', 'CAD']);
});


/* ---------- relation as a field type; files vs documents (2026-08-23) ---------- */

test('relation state produces the addRelation payload; files carry multiple; documents carry kind', () => {
  const rel = core.definitionFromState({ type: 'relation', relation: { targetDb: 'tbl-1', cardinality: 'many-to-many', inverseName: 'Tasks' } });
  assert.deepEqual(rel, { type: 'relation', config: { targetDb: 'tbl-1', cardinality: 'many-to-many', inverseName: 'Tasks' } });
  assert.deepEqual(core.definitionFromState({ type: 'attachments', multiple: false }).config, { multiple: false });
  assert.deepEqual(core.definitionFromState({ type: 'attachments', multiple: true }).config, {});
  assert.deepEqual(core.definitionFromState({ type: 'document', kind: 'html' }).config, { kind: 'html' });
  assert.deepEqual(core.definitionFromState({ type: 'document', kind: 'markdown' }).config, {});
  const back = core.stateFromDefinition({ type: 'attachments', config: { multiple: false } });
  assert.equal(back.multiple, false);
  assert.equal(core.stateFromDefinition({ type: 'document', config: { kind: 'code' } }).kind, 'code');
  assert.deepEqual(core.DOCUMENT_KINDS, ['markdown', 'html', 'code']);
});

test('select and files wear distinct icons from multiselect and document', () => {
  const icon = (id) => core.FIELD_TYPES.find((t) => t.id === id).icon;
  assert.notEqual(icon('select'), icon('multiselect'));
  assert.notEqual(icon('attachments'), icon('document'));
  assert.equal(icon('select'), '▾');
});

test('url wears a link icon, not the command glyph (Kyle, 2026-08-23)', () => {
  assert.equal(core.FIELD_TYPES.find((t) => t.id === 'url').icon, '🔗');
  assert.equal(core.FIELD_TYPES.find((t) => t.id === 'key').icon, '✱', 'a key reads as redacted text');
});

/* ---------- workflow states: icons, reorder, no default radio (2026-08-23) ---------- */
test('states keep icons; no default is sent (the first state is the default); moveItem reorders', () => {
  const def = core.definitionFromState({ type: 'workflow', states: [{ id: 'a', name: 'A', category: 'other', icon: '⚑' }, { id: 'b', name: 'B', category: 'done' }] });
  assert.deepEqual(def.config.states, [{ id: 'a', name: 'A', category: 'other', icon: '⚑' }, { id: 'b', name: 'B', category: 'done' }]);
  const back = core.stateFromDefinition(def);
  assert.equal(back.states[0].icon, '⚑');
  assert.deepEqual(core.moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(core.moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.ok(core.STATE_ICONS.includes('') && core.STATE_ICONS.length >= 8);
});
