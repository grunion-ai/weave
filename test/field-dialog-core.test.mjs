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

await import('../public/date-grain.js');
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

/* ---------- credentials (Feature #143) ---------- */

test('the credential sets mirror the engine, so the tray cannot offer a refused kind', async () => {
  const { CREDENTIAL_KINDS, KEYSTORES } = await import('../src/engine.js');
  assert.deepEqual(core.CREDENTIAL_KINDS, CREDENTIAL_KINDS);
  assert.deepEqual(core.KEYSTORES, KEYSTORES);
});

test('a credential column always states its kind and its keystore', () => {
  const blank = core.blankState('key');
  assert.deepEqual(core.definitionFromState({ ...blank, type: 'key' }).config,
    { kind: 'apikey', keystore: 'local' }, 'the defaults are written down, never implied');

  const ssn = core.stateFromDefinition({ type: 'key', config: { kind: 'id', keystore: 'local' } });
  assert.equal(ssn.credential.kind, 'id');
  assert.deepEqual(core.definitionFromState({ ...ssn, type: 'key' }).config, { kind: 'id', keystore: 'local' },
    'a definition round-trips through the form unchanged');
});

test('the dialog refuses a kind or keystore in the same words the engine would', async () => {
  const { Weave } = await import('../src/engine.js');
  const w = new Weave({ keystorePath: '/dev/null/nope' });
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });

  for (const [config, key] of [[{ kind: 'passphrase' }, 'kind'], [{ keystore: 'lastpass' }, 'keystore']]) {
    const mirrored = core.parseDefinition(JSON.stringify({ type: 'key', config }));
    assert.equal(mirrored.ok, false, `the dialog catches a bad ${key}`);
    const engine = assert.throws(() => w.addField('T', { name: `F-${key}`, type: 'key', config } ), Error);
    void engine;
    try {
      w.addField('T', { name: `G-${key}`, type: 'key', config });
    } catch (e) {
      assert.equal(mirrored.error, e.message, 'the dialog repeats the engine verbatim');
    }
  }
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
  assert.equal(icon('select'), 'lucide:chevron-down', 'a select wears the chevron the control itself opens with');
});

test('url wears a link icon, not the command glyph (Kyle, 2026-08-23)', () => {
  // Still a link, no longer an emoji: the mark set draws it, so the tile is
  // monochrome and the same size as the marks beside it (#138).
  assert.equal(core.FIELD_TYPES.find((t) => t.id === 'url').icon, 'lucide:link');
  assert.equal(core.FIELD_TYPES.find((t) => t.id === 'key').icon, '✱', 'a key reads as redacted text');
});

test('no field-type tile is a colour emoji (Feature #138)', () => {
  // Emoji_Presentation, not Extended_Pictographic: the ballot box is a dingbat
  // that renders as monochrome text and belongs beside the other typed marks.
  const emoji = /\p{Emoji_Presentation}/u;
  for (const t of core.FIELD_TYPES) {
    assert.doesNotMatch(t.icon, emoji, `${t.id} still wears an emoji`);
  }
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

/* ---------- one icon catalogue (Issue #87) ----------
   A table picked from 101 flat SVGs; a select option picked from fourteen
   typographic marks in a different file, through a different control, at a
   different size. `iconChoices` is the one vocabulary both draw from: the
   marks that carry meaning a glyph cannot, then the whole flat set. */

test('one catalogue serves a table and a select option alike', () => {
  const flat = ['activity', 'bug', 'star'];
  const choices = core.iconChoices(flat);

  assert.equal(choices[0].id, '', 'clearing the icon is the first choice');
  const ids = choices.map((c) => c.id);
  assert.ok(ids.includes('lucide:bug'), 'the flat set is in the catalogue');
  assert.ok(ids.includes('✓'), 'the marks are in the same catalogue');
  assert.equal(new Set(ids).size, ids.length, 'no choice appears twice');

  // Every mark that a stored state already wears must still be offered, or
  // opening the picker on an old row would drop its icon.
  for (const mark of core.STATE_ICONS.filter(Boolean)) assert.ok(ids.includes(mark), mark);
});

test('a mark is labelled by what it means, so search finds it by word', () => {
  const choices = core.iconChoices(['bug']);
  const tick = choices.find((c) => c.id === '✓');
  assert.match(tick.label, /done|complete|tick|check/i, 'a mark needs a searchable name');
  const bug = choices.find((c) => c.id === 'lucide:bug');
  assert.equal(bug.label, 'bug');
  assert.equal(bug.lucide, 'bug', 'the picker draws the SVG, not the raw value');
});

test('inside a category the marks come first — they say a state, the icons name a thing', () => {
  // Since 2026-08-29 marks no longer sit in one block ahead of everything;
  // they sort into their categories and lead within each.
  const choices = core.iconChoices(['activity', 'bug', 'chart-bar']);
  const status = choices.filter((c) => c.hint === 'status');
  const firstFlat = status.findIndex((c) => c.lucide);
  const lastMark = status.map((c) => !!c.mark).lastIndexOf(true);
  assert.ok(lastMark < firstFlat, 'marks lead their own category');
  assert.equal(choices.find((c) => c.id === 'lucide:bug').hint, 'status');
  assert.equal(choices.find((c) => c.id === 'lucide:chart-bar').hint, 'data');
});

/* ---------- categories (Kyle, 2026-08-29) ----------
   "Icons should be shown in a grid not a list, no names are needed next to
   each." A grid needs somewhere to break, so every choice carries the
   category it belongs to. The category rides in `hint`, which pickerCore
   already ranks against, so searching 'money' finds the whole group without
   a second search path. */

test('every offered icon lands in exactly one category', () => {
  const flat = ['wallet', 'dollar-sign', 'user', 'calendar', 'arrow-up', 'message-circle', 'lock', 'camera', 'house', 'file', 'chart-bar'];
  const choices = core.iconChoices(flat).filter((c) => c.id);
  for (const c of choices) {
    assert.ok(c.hint, `${c.id} has no category`);
    assert.ok(core.ICON_CATEGORIES.some((g) => g.name === c.hint), `${c.hint} is not a category`);
  }
  assert.equal(choices.find((c) => c.id === 'lucide:dollar-sign').hint, 'money');
  assert.equal(choices.find((c) => c.id === 'lucide:user').hint, 'people');
  assert.equal(choices.find((c) => c.id === 'lucide:arrow-up').hint, 'arrows');
});

test('the marks sort into the same categories — there is no "marks" group', () => {
  const choices = core.iconChoices([]);
  assert.equal(choices.find((c) => c.id === '✓').hint, 'status');
  assert.equal(choices.find((c) => c.id === '⛓').hint, 'data');
  assert.equal(choices.find((c) => c.id === '→').hint, 'arrows');
  assert.equal(core.ICON_CATEGORIES.some((g) => /mark|flat/i.test(g.name)), false);
});

test('choices come out grouped, in category order, ready for a grid', () => {
  const flat = ['wallet', 'user', 'arrow-up'];
  const groups = core.iconGroups(core.iconChoices(flat));
  assert.deepEqual(groups.map((g) => g.name), core.ICON_CATEGORIES.map((g) => g.name).filter((n) => groups.some((g) => g.name === n)));
  for (const g of groups) assert.ok(g.items.length, `${g.name} is empty and should not be a group`);
  // 'No icon' is a control, not an icon, and never sits inside a category.
  assert.equal(groups.some((g) => g.items.some((i) => i.id === '')), false);
});

test('a name nobody classified still gets offered rather than vanishing', () => {
  const choices = core.iconChoices(['not-a-real-icon']);
  const odd = choices.find((c) => c.id === 'lucide:not-a-real-icon');
  assert.ok(odd, 'an unclassified name must still reach the picker');
  assert.ok(odd.hint, 'and must still land in some category');
});

/* Issue #128 — the formula builder's field chips must insert a token the
   parser accepts: bare only when the name is a safe identifier, [bracketed]
   for spaces, punctuation, keywords, and function-name collisions. */
test('formulaFieldToken quotes exactly what the grammar cannot take bare', () => {
  const t = core.formulaFieldToken;
  assert.equal(t('Estimate'), 'Estimate');
  assert.equal(t('_private2'), '_private2');
  assert.equal(t('Due Date'), '[Due Date]');
  assert.equal(t('Owner email'), '[Owner email]');
  assert.equal(t('P&L'), '[P&L]');
  assert.equal(t('2nd'), '[2nd]');
  assert.equal(t('or'), '[or]', 'keywords never go bare');
  assert.equal(t('True'), '[True]');
  assert.equal(t('min'), '[min]', 'a function name would parse as a call');
});

/* ---------- grain and costume (2026-09-02) ----------
   The tray offers the parts a date field captures (year · month · day, a
   time), and lists only the styles the chosen grain can wear. The state is
   the dialog's shape; the definition is the engine's minimal config. */
test('DATE_FORMATS is the engine\'s nine styles; NUMBER_FORMATS gained compact', () => {
  assert.deepEqual(core.DATE_FORMATS, ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'ordinal', 'relative']);
  assert.deepEqual(core.NUMBER_FORMATS, ['number', 'currency', 'percent', 'compact']);
  assert.deepEqual(core.CLOCKS, ['24h', '12h']);
  assert.deepEqual(core.ZONES, ['floating', 'fixed', 'instant']);
});

test('date state → config: a full grain and a 24h floating clock say nothing; everything else is named', () => {
  const full = core.definitionFromState({ type: 'date', date: { grain: { year: true, month: true, day: true }, format: 'iso', time: false, clock: '24h', zone: 'floating', pad: false } });
  assert.deepEqual(full.config, {});
  const expiry = core.definitionFromState({ type: 'date', date: { grain: { year: true, month: true, day: false }, format: 'us', pad: true, time: false } });
  assert.deepEqual(expiry.config, { grain: ['year', 'month'], format: 'us', pad: true });
  const rent = core.definitionFromState({ type: 'date', date: { grain: { year: false, month: false, day: true }, format: 'ordinal', time: false } });
  assert.deepEqual(rent.config, { grain: ['day'], format: 'ordinal' });
  const opening = core.definitionFromState({ type: 'date', date: { grain: { year: false, month: false, day: false }, format: 'iso', time: true, clock: '12h', zone: 'fixed', zoneName: 'America/Los_Angeles' } });
  assert.deepEqual(opening.config, { grain: [], time: true, clock: '12h', zone: 'fixed', zoneName: 'America/Los_Angeles' });
  const meeting = core.definitionFromState({ type: 'date', date: { grain: { year: true, month: true, day: true }, format: 'long', time: true, clock: '12h', zone: 'instant' } });
  assert.deepEqual(meeting.config, { format: 'long', time: true, clock: '12h', zone: 'instant' });
  const hours = core.definitionFromState({ type: 'daterange', date: { grain: { year: false, month: false, day: false }, time: true, elapsed: true } });
  assert.deepEqual(hours.config, { grain: [], time: true, elapsed: true });
  const noElapsed = core.definitionFromState({ type: 'date', date: { grain: { year: true, month: true, day: true }, time: true, elapsed: true } });
  assert.equal(noElapsed.config.elapsed, undefined, 'elapsed belongs to a range');
});

test('config → date state round-trips, and a config with no grain reads as the full grain', () => {
  const s = core.stateFromDefinition({ type: 'date', config: { grain: ['month', 'day'], format: 'long', time: true, clock: '12h', zone: 'instant', pad: true } });
  assert.deepEqual(s.date.grain, { year: false, month: true, day: true });
  assert.equal(s.date.format, 'long');
  assert.equal(s.date.time, true);
  assert.equal(s.date.clock, '12h');
  assert.equal(s.date.zone, 'instant');
  assert.equal(s.date.pad, true);
  const plain = core.stateFromDefinition({ type: 'date', config: {} });
  assert.deepEqual(plain.date.grain, { year: true, month: true, day: true });
  assert.equal(plain.date.clock, '24h');
  assert.equal(plain.date.zone, 'floating');
  const t = core.stateFromDefinition({ type: 'daterange', config: { grain: [], time: true, elapsed: true } });
  assert.deepEqual(t.date.grain, { year: false, month: false, day: false });
  assert.equal(t.date.elapsed, true);
  for (const def of [
    { type: 'date', config: { grain: ['year', 'month'], format: 'quarter' } },
    { type: 'date', config: { grain: [], time: true, clock: '12h' } },
    { type: 'daterange', config: { time: true, elapsed: true, zone: 'fixed', zoneName: 'Europe/Berlin' } },
  ]) {
    assert.deepEqual(core.definitionFromState(core.stateFromDefinition(def)), def, JSON.stringify(def));
  }
});

test('legalFormats and parseDefinition mirror the engine: a style needing a missing part is refused with the part named', () => {
  assert.deepEqual(core.legalFormats({ year: false, month: false, day: true }), ['iso', 'us', 'eu', 'long', 'short', 'ordinal']);
  assert.deepEqual(core.legalFormats({ year: true, month: true, day: false }), ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'relative']);
  assert.deepEqual(core.legalFormats({ year: false, month: false, day: false }), []);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "grain": ["day"], "format": "quarter" } }').error, /month/);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "grain": ["month", "day"], "format": "relative" } }').error, /year/);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "grain": ["year", "day"] } }').error, /grain/i);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "grain": [] } }').error, /time/i);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "time": true, "clock": "10h" } }').error, /clock/i);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "time": true, "zone": "fixed" } }').error, /zoneName/i);
  assert.match(core.parseDefinition('{ "type": "date", "config": { "zone": "instant" } }').error, /time/i);
  assert.match(core.parseDefinition('{ "type": "number", "config": { "accounting": true } }').error, /accounting/i);
  assert.match(core.parseDefinition('{ "type": "number", "config": { "format": "compact", "separator": true } }').error, /separator/i);
  assert.equal(core.parseDefinition('{ "type": "date", "config": { "grain": ["year", "month"], "format": "us", "pad": true } }').error, undefined);
});

test('number state carries accounting and the compact format', () => {
  const acc = core.definitionFromState({ type: 'number', number: { format: 'currency', currency: 'USD', accounting: true, decimals: null, separator: false } });
  assert.deepEqual(acc.config, { format: 'currency', currency: 'USD', accounting: true });
  const plainAcc = core.definitionFromState({ type: 'number', number: { format: 'number', accounting: true, decimals: null, separator: false } });
  assert.equal(plainAcc.config.accounting, undefined, 'accounting only rides a currency');
  const compact = core.definitionFromState({ type: 'number', number: { format: 'compact', currency: 'EUR', separator: true, decimals: 0 } });
  assert.deepEqual(compact.config, { format: 'compact', currency: 'EUR', decimals: 0 }, 'compact keeps its currency and drops the separator');
  const s = core.stateFromDefinition({ type: 'number', config: { format: 'currency', currency: 'USD', accounting: true } });
  assert.equal(s.number.accounting, true);
  assert.deepEqual(core.definitionFromState(s).config, { format: 'currency', currency: 'USD', accounting: true });
});

test('the Name field\'s row term rides the definition both ways', () => {
  const s = core.stateFromDefinition({ type: 'text', config: { term: { singular: 'deal', plural: 'deals' } } });
  assert.deepEqual(s.term, { singular: 'deal', plural: 'deals' });
  assert.deepEqual(core.definitionFromState(s).config.term, { singular: 'deal', plural: 'deals' });
  assert.equal(core.definitionFromState(core.blankState('text')).config.term, undefined, 'unset stays absent');
});
