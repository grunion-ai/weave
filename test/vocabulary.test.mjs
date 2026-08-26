/* The vocabulary is only useful if it is true. Every list in src/vocabulary.js
   is a copy of a closed set that lives somewhere else — the engine's private
   constants, the browser's field dialog, the vendored icon file — so each one
   is held against its source here. Drift fails the suite, not the agent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VOCABULARY, FIELD_TYPE_VOCABULARY, OPTION_COLORS, ICONS } from '../src/vocabulary.js';
import { FIELD_TYPES, Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
const DIALOG = readFileSync(join(ROOT, 'public/field-dialog-core.js'), 'utf8');
const list = (src, name) => JSON.parse((src.match(new RegExp(`${name} = (\\[[^\\]]*\\])`))?.[1] ?? '[]').replace(/'/g, '"').replace(/,\s*\]/, ']'));

test('every field type the engine accepts is described, and nothing else', () => {
  assert.deepEqual(FIELD_TYPE_VOCABULARY.map((f) => f.type).sort(), [...FIELD_TYPES].sort());
});

test('every described type says what it renders as and which config keys it takes', () => {
  for (const f of FIELD_TYPE_VOCABULARY) {
    assert.ok(f.renders && f.renders.length > 8, `${f.type} must say what a reader sees`);
    assert.ok(Array.isArray(f.config), `${f.type} must name its config keys`);
  }
  // The keys that decide how a number reads are the engine's, not a guess.
  const costume = list(ENGINE, 'NUMBER_COSTUME_KEYS');
  const number = FIELD_TYPE_VOCABULARY.find((f) => f.type === 'number');
  for (const k of costume) assert.ok(number.config.includes(k), `number is missing the ${k} key`);
});

test('the option palette is the palette the field dialog paints', () => {
  const dialog = list(DIALOG, 'OPTION_COLORS');
  assert.deepEqual(OPTION_COLORS.map((c) => c.value), dialog);
  for (const c of OPTION_COLORS) assert.ok(c.name, `${c.value} needs a name an agent can reason about`);
});

test('the icon names are the vendored icon set', () => {
  const vendor = readFileSync(join(ROOT, 'public/vendor/iconly-flat.js'), 'utf8');
  const names = [...vendor.matchAll(/['"]([a-z0-9-]+)['"]\s*:/g)].map((m) => m[1]);
  assert.deepEqual([...ICONS].sort(), [...new Set(names)].sort());
});

test('the icon vocabulary gives the value form, not just the names', () => {
  // A bare 'ticksquare' is a legal string that paints the word "ticksquare" in
  // the nav — verified live, 2026-08-24. The stored value is prefixed.
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const renderer = app.slice(app.indexOf('function iconEl'), app.indexOf('function iconEl') + 400);
  assert.match(renderer, /\^iconly:/, 'the renderer takes the prefixed form');
  assert.equal(VOCABULARY.icons.form, 'iconly:<name>');
  assert.match(VOCABULARY.icons.fallback, /renders as text/, 'and says what any other string does');
  assert.ok(VOCABULARY.icons.names.includes('discovery'));
  // The picker writes the same form the vocabulary promises.
  // The catalogue moved into field-dialog-core with Issue #87 so one list
  // serves a table, a select option and a workflow state alike.
  const core = readFileSync(join(ROOT, 'public/field-dialog-core.js'), 'utf8');
  assert.match(core, /id: `iconly:\$\{n\}`/, 'the UI picker stores the prefixed form');
  assert.match(app, /fieldDialogCore\.iconChoices/, 'and the app picks from that catalogue');
});

test('the closed sets match the engine and the field dialog', () => {
  assert.deepEqual(VOCABULARY.stateCategories, list(ENGINE, 'STATE_CATEGORIES'));
  assert.deepEqual(VOCABULARY.aggregates, list(ENGINE, 'AGGREGATES'));
  assert.deepEqual(VOCABULARY.documentKinds, list(ENGINE, 'DOCUMENT_KINDS'));
  assert.deepEqual(VOCABULARY.numberFormats, list(DIALOG, 'NUMBER_FORMATS'));
  assert.deepEqual(VOCABULARY.dateFormats, list(DIALOG, 'DATE_FORMATS'));
  assert.deepEqual(VOCABULARY.cardinalities, list(DIALOG, 'CARDINALITIES'));
});

test('the system columns are the ones updateTable accepts', () => {
  const known = ENGINE.match(/const known = (\[[^\]]*\])/)?.[1] ?? '[]';
  assert.deepEqual(VOCABULARY.systemFields, JSON.parse(known.replace(/'/g, '"')));
});

test('the column width rules are the ones the grid enforces', () => {
  assert.equal(VOCABULARY.columnWidth.min, Number(ENGINE.match(/MIN_COLUMN_WIDTH = (\d+)/)[1]));
  const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, new RegExp(`max-width: ${VOCABULARY.columnWidth.unsetCap}px`), 'the cap is what the grid caps at');
});

test('the registries name the columns that are schema writes', () => {
  // Writing these runs the schema verb (engine #interceptUpdate).
  assert.deepEqual(Object.keys(VOCABULARY.registries), ['Workspace/Spaces', 'Workspace/Tables', 'Workspace/Fields']);
  assert.ok(VOCABULARY.registries['Workspace/Tables'].includes('Field Order'));
  assert.ok(VOCABULARY.registries['Workspace/Fields'].includes('Definition'));
});

test('the vocabulary is served, so a remote agent has it too', async () => {
  const { server } = await startServer(new Weave(), { port: 0 });
  try {
    const got = await (await fetch(`http://127.0.0.1:${server.address().port}/api/vocabulary`)).json();
    assert.deepEqual(got.icons.names, ICONS);
    assert.equal(got.icons.form, 'iconly:<name>');
    assert.equal(got.fieldTypes.length, FIELD_TYPES.length);
    assert.equal(got.columnWidth.min, VOCABULARY.columnWidth.min);
  } finally { server.close(); }
});
