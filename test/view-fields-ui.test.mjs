/* The chip and the card in the browser (Kyle, 2026-09-04): the field dialog
   edits a view's config through the same core the other types use, the grid
   draws an unhidden view as a read-only cell, every relation chip carries the
   far row's segments behind a caret, and the entity page shows both views —
   hidden or not — so a reader sees the row the way the rest of the workspace
   will. The DOM paths are source-gated here; the browser suites cover the
   rest. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

await import('../public/date-grain.js');
await import('../public/field-dialog-core.js');
await import('../public/view-core.js');
const core = globalThis.fieldDialogCore;
const viewCore = globalThis.weaveViewCore;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');

// ---------- the dialog core ----------

test('view is a type the dialog knows but never offers as a tile', () => {
  assert.ok(core.FIELD_TYPES.some((t) => t.id === 'view' && t.computed && t.minted), 'view is listed, computed, minted');
  assert.ok(!core.typeChoices().some((t) => t.id === 'view'), 'a new field is never a view');
  assert.deepEqual(core.typeChoices('view'), [], 'an existing view has no migration tray');
});

test('a view round-trips schema → state → definition → patch', () => {
  const f = { name: 'Card', type: 'view', role: 'card', shape: 'card', link: true, state: false, description: 'medium', fields: ['Owner', 'Due'] };
  const def = core.definitionFromFieldView(f);
  assert.deepEqual(def, { type: 'view', config: { shape: 'card', link: true, state: false, description: 'medium', fields: ['Owner', 'Due'] } });
  const state = core.stateFromDefinition(def);
  assert.deepEqual(state.view, { shape: 'card', link: true, state: false, description: 'medium', fields: ['Owner', 'Due'] });
  assert.deepEqual(core.definitionFromState(state), def);
  const patch = core.editPatchConfig(f, def, state);
  assert.deepEqual(patch, { link: true, state: false, description: 'medium', fields: ['Owner', 'Due'] }, 'the shape never rides the patch');
  // Auto fields are null, and stay null through the pane.
  const auto = core.stateFromDefinition({ type: 'view', config: { shape: 'chip', link: false, state: true, description: 'none', fields: null } });
  assert.equal(auto.view.fields, null);
  assert.equal(core.definitionFromState(auto).config.fields, null);
});

test('the code pane refuses what the engine would refuse, in the engine’s words', () => {
  const bad = (config) => core.parseDefinition(JSON.stringify({ type: 'view', config }));
  assert.match(bad({ shape: 'tile' }).error, /chip or a card/);
  assert.match(bad({ shape: 'chip', description: 'huge' }).error, /none, small, medium, large/);
  assert.match(bad({ shape: 'chip', fields: 'Due' }).error, /list of field names/);
  assert.match(bad({ shape: 'chip', link: 'yes' }).error, /true or false/);
  assert.ok(bad({ shape: 'card', fields: ['Due'], description: 'small' }).ok);
  // The messages are the engine's, verbatim.
  for (const msg of ['description is one of ${DESCRIPTION_SIZES.join(', ')}', 'fields is a list of field names, or null for the first few', 'is true or false']) {
    assert.ok(ENGINE.includes(msg), `engine still says: ${msg}`);
  }
});

// ---------- the shared renderer core ----------

test('viewSegments puts the state first and keeps blanks out', () => {
  const v = { shape: 'chip', name: 'x', state: { name: 'Doing', category: 'in-progress' }, fields: [{ label: 'Due', value: '2026-09-12' }, { label: 'Tags', value: '' }] };
  assert.deepEqual(viewCore.viewSegments(v), [
    { kind: 'state', label: 'State', value: 'Doing', category: 'in-progress' },
    { kind: 'field', label: 'Due', value: '2026-09-12' },
  ]);
  assert.deepEqual(viewCore.viewSegments({ shape: 'chip', name: 'x', state: null, fields: [] }), []);
});

test('viewTitle carries the #id only when the view links', () => {
  assert.equal(viewCore.viewTitle({ publicId: 12, name: 'Ship', link: true }), '#12 Ship');
  assert.equal(viewCore.viewTitle({ publicId: 12, name: 'Ship', link: false }), 'Ship');
  assert.equal(viewCore.viewTitle({ publicId: 12, name: '', link: false }), '#12');
});

test('the eligible fields for a view, in column order, are the glanceable ones', () => {
  const db = { fields: [
    { name: 'Name', type: 'text', role: 'name' }, { name: 'Description', type: 'document', role: 'description' },
    { name: 'State', type: 'workflow' }, { name: 'Due', type: 'date' }, { name: 'Spec', type: 'document' },
    { name: 'Files', type: 'attachments' }, { name: 'Key', type: 'key' }, { name: 'Def', type: 'field' },
    { name: 'Owner', type: 'relation' }, { name: 'Chip', type: 'view', role: 'chip' }, { name: 'Card', type: 'view', role: 'card' },
  ] };
  assert.deepEqual(viewCore.eligibleFields(db).map((f) => f.name), ['Due', 'Owner']);
});

// ---------- app.js source gates ----------

test('the grid treats a view as read-only and draws it through the shared renderer', () => {
  assert.match(APP, /READONLY_FIELD_TYPES = \[[^\]]*'view'/, 'view is read-only in the grid');
  assert.match(APP, /if \(f\.type === 'view'\) return viewCell\(/, 'the cell goes to viewCell');
  assert.match(APP, /function viewChipEl\(/);
  assert.match(APP, /function viewCardEl\(/);
});

test('a relation chip carries the far row’s segments behind a caret', () => {
  assert.match(APP, /function relationChipEl\(/, 'one builder for every relation chip');
  assert.match(APP, /s\.chip/, 'it reads the chip the summary carries');
  assert.match(APP, /mention-caret/, 'the same caret the doc chips use');
  assert.match(APP, /\.mention-caret/, 'and the same delegated toggle');
});

/* Issue #193: the retract caret faces the text. The expand › points right,
   at the segments; rotated 90° the open state pointed down, at nothing. Open
   is a half turn — ‹ — so the pair reads as one control folding in and out.
   Two stylesheets draw the chip (style.css in the app, the page CSS in
   src/markdown.js for /doc.html), and they must agree. */
test('the open caret turns a half circle to face the label, in both stylesheets', () => {
  const MD = readFileSync(join(ROOT, 'src/markdown.js'), 'utf8');
  for (const [name, css] of [['style.css', CSS], ['markdown.js', MD]]) {
    const rule = css.match(/\.mention-wrap\.open \.mention-caret\s*\{([^}]*)\}/);
    assert.ok(rule, `${name} styles the open caret`);
    assert.match(rule[1], /rotate\(180deg\)/, `${name}: open = 180°, facing the text — not 90° (down)`);
    assert.doesNotMatch(rule[1], /rotate\(90deg\)/, `${name}: no down-pointing retract caret`);
    const rest = css.match(/\.mention-caret\s*\{([^}]*)\}/);
    assert.ok(rest && !/rotate/.test(rest[1]), `${name}: at rest the caret is unrotated — › points at the segments`);
  }
});

test('the entity page shows both views, hidden or not, with a way to configure each', () => {
  assert.match(APP, /function appearsAsPanel\(/);
  assert.match(APP, /appearsAsPanel\(db, entity/, 'the panel is built from the entity read');
  assert.match(APP, /viewFieldOf\(db, 'chip'\)/);
  assert.match(APP, /viewFieldOf\(db, 'card'\)/);
  assert.match(APP, /f\.role !== 'name' && f\.type !== 'view' && !hidden\.has\(f\.name\)/, 'the value grid leaves the views to their panel');
});

test('the field dialog has a config pane for a view', () => {
  assert.match(APP, /function viewSection\(/);
  assert.match(APP, /existing\.type === 'view'/, 'the dialog knows the shape is fixed');
  assert.match(APP, /DESCRIPTION_SIZES|\['none', 'small', 'medium', 'large'\]/);
  assert.match(APP, /wv-view-preview/, 'the pane shows the view as it will look (Kyle, 2026-09-04)');
  assert.match(APP, /\/view\?shape=\$\{encodeURIComponent\(v\.shape\)\}&config=/, 'drawn through the same renderView, under the candidate config');
});

test('the styles exist for the card tile and the chip segments in both themes', () => {
  for (const cls of ['.wv-card', '.wv-card-head', '.wv-card-desc', '.wv-card-fields', '.wv-appears']) {
    assert.ok(CSS.includes(cls), `${cls} is styled`);
  }
});

// The gates above are greps; this is the parse gate that makes them honest.
test('app.js and view-core.js still parse', () => {
  assert.doesNotThrow(() => new Function(APP));
  assert.doesNotThrow(() => new Function(readFileSync(join(ROOT, 'public/view-core.js'), 'utf8')));
});
