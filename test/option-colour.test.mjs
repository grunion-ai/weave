/* An option's colour is one name from the ten-hue ramp, and weave used to
   publish one set of names while accepting another (Issue #551). `magenta` was
   the name the vocabulary and the Handbook gave pink's hex; the engine knew it
   as `pink`, did not know `magenta`, and swapped anything it did not know for
   slate while answering 201. So a field created with the documented name came
   back grey and nobody was told.

   The rule this suite holds: reads are forgiving and writes are strict. A
   colour already on disk still resolves, or rests on slate, so no stored
   workspace becomes unreadable. A colour a caller just sent is refused by
   name, on every door that takes one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { VOCABULARY, OPTION_COLORS } from '../src/vocabulary.js';
import { dispatchTool } from '../src/mcp.js';
import { FIELD_DOCS, GUIDES } from '../src/handbook.js';

await import('../public/chip-core.js');
const ramp = globalThis.chipCore;

function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  return { w, t };
}
const optionsOf = (f) => f.config.options.map((o) => ({ name: o.name, hue: o.hue, color: o.color }));
// describeSchema() answers with one entry per space, each carrying its tables.
const tableIn = (doc, name) => doc.flatMap((s) => s.tables).find((x) => x.name === name);
const refusal = (fn) => {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, 'the colour was accepted');
  assert.match(err.message, /Unknown option colour/);
  assert.equal(err.code, 'invalid', 'a refused colour is a 400, not a 500');
  return err.message;
};

/* ---------- the published names are the accepted names ---------- */

test("the vocabulary's colour names are the ramp's hues, in the ramp's order", () => {
  assert.deepEqual(VOCABULARY.optionColors.map((c) => c.name), Object.keys(ramp.HUE_HEX));
  assert.deepEqual(OPTION_COLORS.map((c) => c.value), Object.values(ramp.HUE_HEX));
});

test('the Handbook names every hue of the ramp and no colour outside it', () => {
  const pages = [FIELD_DOCS.find((f) => f.name === 'select').doc,
    GUIDES.find((g) => g.name === 'Making a workspace your own').doc];
  for (const doc of pages) {
    for (const hue of Object.keys(ramp.HUE_HEX)) {
      assert.ok(doc.includes(`\`${hue}\``), `the palette list omits ${hue}`);
    }
    assert.ok(!/eight (values|colours|colors)/.test(doc), 'the page still claims eight colours');
  }
});

/* ---------- a write names a hue, an alias, or a hex ---------- */

test('a hue name, its hex and the published alias all land on the same hue', () => {
  const { w, t } = ws();
  const f = w.addField(t, {
    name: 'Area',
    type: 'select',
    config: {
      options: [
        { name: 'Design', color: 'magenta' },
        { name: 'Backend', hue: 'magenta' },
        { name: 'Docs', color: '#d6409f' },
        { name: 'Infra', hue: 'pink' },
      ],
    },
  });
  for (const o of optionsOf(f)) {
    assert.equal(o.hue, 'pink', `${o.name} did not land on pink`);
    assert.equal(o.color, '#d6409f', `${o.name} carries the wrong hex`);
  }
});

test('the hues the vocabulary grew are storable, not just the first eight', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'A', hue: 'teal' }, { name: 'B', color: 'orange' }] } });
  assert.deepEqual(optionsOf(f).map((o) => o.hue), ['teal', 'orange']);
});

test('an empty colour, the neutral alias and a bare string all rest on slate', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Area', type: 'select', config: { options: ['Plain', { name: 'Empty', color: '' }, { name: 'Neutral', hue: 'neutral' }] } });
  for (const o of optionsOf(f)) {
    assert.equal(o.hue, 'slate', `${o.name} did not rest on slate`);
    assert.equal(o.color, '');
  }
});

/* ---------- every door refuses a colour weave cannot name ---------- */

test('addField refuses an invented colour and names the hues in the message', () => {
  const { w, t } = ws();
  const msg = refusal(() => w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'Design', color: 'banana' }] } }));
  assert.match(msg, /banana/, 'the refusal quotes what was sent');
  for (const hue of Object.keys(ramp.HUE_HEX)) assert.match(msg, new RegExp(hue), `the refusal does not name ${hue}`);
  assert.equal(w.findField(w.getTable(t), 'Area'), undefined, 'the field was created anyway');
});

test('a multiselect and an unknown hex are refused the same way', () => {
  const { w, t } = ws();
  refusal(() => w.addField(t, { name: 'Tags', type: 'multiselect', config: { options: [{ name: 'A', hue: 'chartreuse' }] } }));
  refusal(() => w.addField(t, { name: 'Tags', type: 'multiselect', config: { options: [{ name: 'A', color: '#123456' }] } }));
});

test('an options edit refuses it, and the options it had are untouched', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'Design', hue: 'pink' }] } });
  refusal(() => w.updateField(t, f.id, { config: { options: [{ id: f.config.options[0].id, name: 'Design', hue: 'banana' }] } }));
  assert.deepEqual(optionsOf(w.getField(w.getTable(t).id, f.id)), [{ name: 'Design', hue: 'pink', color: '#d6409f' }]);
  // The same edit with the published alias goes through.
  w.updateField(t, f.id, { config: { options: [{ id: f.config.options[0].id, name: 'Design', hue: 'magenta' }] } });
  assert.equal(w.getField(w.getTable(t).id, f.id).config.options[0].hue, 'pink');
});

test('a type change that carries its own options is refused', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Area', type: 'text' });
  refusal(() => w.updateField(t, f.id, { type: 'select', config: { options: [{ name: 'Design', color: 'banana' }] } }));
});

test('applySchema refuses a colour the document invented', () => {
  const { w, t } = ws();
  const doc = w.describeSchema();
  tableIn(doc, 'Task').fields.push({ name: 'Area', type: 'select', options: ['Design'], optionsFull: [{ name: 'Design', color: 'banana' }] });
  refusal(() => w.applySchema(doc));
  assert.equal(w.findField(w.getTable(t), 'Area'), undefined, 'the schema applied anyway');
});

test('a field definition value is refused by the same normaliser', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Definition', type: 'field', config: { types: ['select'], depth: 1 } });
  refusal(() => w.createEntity(t, { name: 'A column', values: { Definition: { type: 'select', config: { options: [{ name: 'Design', color: 'banana' }] } } } }));
});

test('the field route answers 400 and the vocabulary route names the hues', async () => {
  const { w, t } = ws();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/tables/${t.id}/fields`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const bad = await post({ name: 'Area', type: 'select', config: { options: [{ name: 'Design', color: 'banana' }] } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Unknown option colour 'banana'/);

    const ok = await post({ name: 'Area', type: 'select', config: { options: [{ name: 'Design', color: 'magenta' }] } });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).config.options[0].hue, 'pink');

    const patch = await fetch(`${base}/api/tables/${t.id}/fields/Area`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { options: [{ name: 'Design', hue: 'banana' }] } }),
    });
    assert.equal(patch.status, 400);

    const vocab = await (await fetch(`${base}/api/vocabulary`)).json();
    assert.deepEqual(vocab.optionColors.map((c) => c.name), Object.keys(ramp.HUE_HEX));
    assert.ok(vocab.optionColors.find((c) => c.name === 'pink').aliases.includes('magenta'));
  } finally {
    server.close();
  }
});

/* ---------- a colour already on disk still reads ---------- */

test('an imported workspace whose option holds a retired hex still loads and reads as slate', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'Design', hue: 'pink' }] } });
  const dump = w.exportJSON();
  const field = Object.values(dump.tables[w.getTable(t).id].fields).find((x) => x.name === 'Area');
  field.config.options[0] = { id: 'design', name: 'Design', hue: 'fuchsia', color: '#ff00ff', icon: '' };
  const fresh = new Weave();
  fresh.importJSON(dump);
  const described = tableIn(fresh.describeSchema(), 'Task').fields.find((x) => x.name === 'Area');
  assert.equal(described.optionsFull[0].hue, 'slate', 'a colour weave cannot name reads as slate');
  assert.equal(described.optionsFull[0].name, 'Design');
  assert.ok(f.id, 'the field was there before the dump');
});

test('a schema apply keeps the colour an option already stored without re-validating it', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'Design', hue: 'pink' }] } });
  const dump = w.exportJSON();
  const stored = Object.values(dump.tables[w.getTable(t).id].fields).find((x) => x.name === 'Area');
  // The pre-ramp shape: a loose hex and no hue at all.
  stored.config.options[0] = { id: 'design', name: 'Design', color: '#ff00ff', icon: '' };
  const fresh = new Weave();
  fresh.importJSON(dump);
  /* Editing the option list is what carries the stored colour back through the
     normaliser. The document names no colour of its own, so the apply must
     keep reading the retired hex rather than refusing the workspace it is
     editing. */
  const doc = fresh.describeSchema();
  const field = tableIn(doc, 'Task').fields.find((x) => x.name === 'Area');
  delete field.optionsFull;
  field.options = ['Design', 'Backend'];
  fresh.applySchema(doc);
  const options = fresh.getField(fresh.getTable('Task').id, 'Area').config.options;
  assert.deepEqual(options.map((o) => o.name), ['Design', 'Backend']);
  assert.deepEqual(options.map((o) => o.hue), ['slate', 'slate']);
});

test('an edit that hands back an option untouched keeps a colour weave cannot name', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'Design', hue: 'pink' }] } });
  const dump = w.exportJSON();
  const stored = Object.values(dump.tables[w.getTable(t).id].fields).find((x) => x.name === 'Area');
  stored.config.options[0] = { id: 'design', name: 'Design', color: '#ff00ff', icon: '' };
  const fresh = new Weave();
  fresh.importJSON(dump);
  const table = fresh.getTable('Task');
  const field = fresh.getField(table.id, 'Area');
  // Widening the list is how weave's own docs sync adds a milestone or a
  // severity (src/weaver-seed.js), and it sends the options it found.
  fresh.updateField(table.id, field.id, { config: { options: [...field.config.options, 'Backend'] } });
  const after = fresh.getField(table.id, 'Area').config.options;
  assert.deepEqual(after.map((o) => o.name), ['Design', 'Backend']);
  // It rests on slate, which is what an edit has always done to a colour
  // outside the ramp. What matters here is that the edit is not refused.
  assert.equal(after[0].hue, 'slate');
  assert.equal(after[0].color, '');
  // Naming a different colour on the same option is a new assertion.
  refusal(() => fresh.updateField(table.id, field.id, { config: { options: [{ id: 'design', name: 'Design', hue: 'banana' }] } }));
});

test('a describeSchema round-trip applies to the workspace it came from', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Area', type: 'select', config: { options: [{ name: 'Design', hue: 'pink' }] } });
  const dump = w.exportJSON();
  Object.values(dump.tables[w.getTable(t).id].fields).find((x) => x.name === 'Area')
    .config.options[0] = { id: 'design', name: 'Design', color: '#ff00ff', icon: '' };
  const fresh = new Weave();
  fresh.importJSON(dump);
  // optionsFull carries the stored colour back verbatim; that is not the
  // document asserting a new one.
  fresh.applySchema(fresh.describeSchema());
  assert.equal(fresh.getField(fresh.getTable('Task').id, 'Area').config.options[0].name, 'Design');
});

test('the MCP door and the CLI door answer the same way as the route', () => {
  const { w, t } = ws();
  // MCP: the same engine verb, so the refusal and the alias both carry over.
  refusal(() => dispatchTool(w, 'weave_add_field', { db: t.id, name: 'Bad', type: 'select', config: { options: [{ name: 'Design', color: 'banana' }] } }));
  const made = dispatchTool(w, 'weave_add_field', { db: t.id, name: 'Area', type: 'select', config: { options: [{ name: 'Design', color: 'magenta' }] } });
  assert.equal(made.config.options[0].hue, 'pink');
  // The schema door, which the CLI and MCP both hand a document to.
  const doc = w.describeSchema();
  tableIn(doc, 'Task').fields.find((f) => f.name === 'Area').optionsFull = [{ name: 'Design', color: 'teal' }];
  w.applySchema(doc);
  assert.equal(w.getField(w.getTable('Task').id, 'Area').config.options[0].hue, 'teal');
});
