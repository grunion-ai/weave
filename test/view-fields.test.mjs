/* Chip and Card: two system view fields on every table (Kyle, 2026-09-04).
   "each weave entity needs a new field which represents its in line chip and
   card view. these should be new system fields hidden by default." The config
   is per table — the same for every row — and says what the chip and the
   card contain: the public-id link, the state, the name, a description
   preview at one of three sizes, and a handful of other fields. The entity
   page renders both so a reader sees how the row will appear elsewhere.

   The two are roles, like the description: a table points at them by id
   (`chipFieldId`, `cardFieldId`), so a rename costs nothing. Unlike the
   description they cannot be deleted — every row has a chip and a card by
   existing — and their type is fixed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave, VIEW_SHAPES, DESCRIPTION_SIZES } from '../src/engine.js';
import { startServer } from '../src/server.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const tasks = w.createTable({ space: 'Dev', name: 'Task' });
  w.createTable({ space: 'Dev', name: 'Person' });
  w.addField(tasks, {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }, { name: 'Done', category: 'done' }] },
  });
  w.addField(tasks, { name: 'Due', type: 'date' });
  w.addField(tasks, { name: 'Notes', type: 'text' });
  w.addField(tasks, { name: 'Points', type: 'number' });
  w.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b'] } });
  w.addRelation(tasks, { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-one' });
  const owner = w.createEntity('Person', { name: 'Ada' });
  const t = w.createEntity('Task', { name: 'Ship the editor', doc: 'First line of the story.\n\nSecond paragraph goes on for a while and then some more words to make it long enough to be clipped by the medium size.' });
  w.setState(t.id, 'State', 'Doing');
  w.updateEntity(t.id, { Due: '2026-09-12', Notes: 'polish pass', Points: 3 });
  w.link(t.id, 'Owner', [owner.id]);
  return { w, tasks, t, owner };
}

function onDisk() {
  const path = join(mkdtempSync(join(tmpdir(), 'weave-view-')), 'uno.json');
  const w = new Weave({ path });
  w.createSpace({ name: 'Dev' });
  const tasks = w.createTable({ space: 'Dev', name: 'Task' });
  return { w, tasks, path, reopen: () => new Weave({ path }) };
}

// ---------- minting ----------

test('a new table mints Chip and Card: system view fields, roles by id, hidden by default', () => {
  const { w, tasks } = build();
  const db = w.getTable(tasks);
  const chip = w.viewField(db, 'chip');
  const card = w.viewField(db, 'card');
  assert.equal(chip.name, 'Chip');
  assert.equal(card.name, 'Card');
  assert.equal(chip.type, 'view');
  assert.equal(card.type, 'view');
  assert.equal(chip.system, true);
  assert.equal(card.system, true);
  assert.equal(db.chipFieldId, chip.id);
  assert.equal(db.cardFieldId, card.id);
  assert.ok(db.hiddenFields.includes('Chip') && db.hiddenFields.includes('Card'), 'hidden from the grid until someone unhides them');
});

test('the defaults: a chip is name + state + two fields; a card adds the link and a small description', () => {
  const { w, tasks } = build();
  const db = w.getTable(tasks);
  assert.deepEqual(w.viewField(db, 'chip').config, { shape: 'chip', link: false, state: true, description: 'none', fields: null });
  assert.deepEqual(w.viewField(db, 'card').config, { shape: 'card', link: true, state: true, description: 'small', fields: null });
  assert.deepEqual(VIEW_SHAPES, ['chip', 'card']);
  assert.deepEqual(DESCRIPTION_SIZES, ['none', 'small', 'medium', 'large']);
});

test('a table that predates the roles gets both on open, and keeps what it already hid', () => {
  const { w, tasks } = build();
  w.updateTable(tasks, { hiddenFields: ['Chip', 'Card', 'Notes'] });
  const dump = w.exportJSON();
  for (const db of Object.values(dump.tables)) {
    for (const [id, f] of Object.entries(db.fields)) if (f.type === 'view') { delete db.fields[id]; db.fieldOrder = db.fieldOrder.filter((x) => x !== id); }
    delete db.chipFieldId;
    delete db.cardFieldId;
    db.hiddenFields = ['Notes'];
  }
  const w2 = new Weave();
  w2.importJSON(dump);
  const db = w2.getTable('Dev/Task');
  assert.equal(w2.viewField(db, 'chip')?.type, 'view');
  assert.equal(w2.viewField(db, 'card')?.type, 'view');
  assert.deepEqual([...db.hiddenFields].sort(), ['Card', 'Chip', 'Notes']);
});

test('registry tables carry no chip or card', () => {
  const { w } = build();
  for (const db of w.listTables()) {
    if (!db.system) continue;
    assert.equal(w.viewField(db, 'chip'), null, `${db.name} is structure, not rows`);
    assert.equal(w.viewField(db, 'card'), null);
  }
});

test('the roles survive a reload by id, through a rename', () => {
  const { w, tasks, reopen } = onDisk();
  const before = w.getTable(tasks).chipFieldId;
  w.updateField(tasks, 'Chip', { name: 'Badge' });
  assert.equal(w.getTable(tasks).chipFieldId, before);
  const db = reopen().getTable('Dev/Task');
  assert.equal(db.chipFieldId, before);
  assert.equal(db.fields[before].name, 'Badge');
  assert.ok(db.hiddenFields.includes('Badge') && !db.hiddenFields.includes('Chip'), 'a hidden field stays hidden under its new name');
});

// ---------- guards ----------

test('neither view field can be deleted, retyped, or created by hand', () => {
  const { w, tasks } = build();
  assert.throws(() => w.deleteField(tasks, 'Chip'), /every row has a chip/i);
  assert.throws(() => w.deleteField(tasks, 'Card'), /every row has a card/i);
  assert.throws(() => w.updateField(tasks, 'Chip', { type: 'text' }), /fixed/i);
  assert.throws(() => w.addField(tasks, { name: 'Tile', type: 'view' }), /minted/i);
  assert.throws(() => w.updateField(tasks, 'Chip', { config: { shape: 'card' } }), /shape/i);
});

test('config validation names the offence', () => {
  const { w, tasks } = build();
  assert.throws(() => w.updateField(tasks, 'Card', { config: { description: 'huge' } }), /none, small, medium, large/);
  assert.throws(() => w.updateField(tasks, 'Card', { config: { fields: ['Nope'] } }), /not a field of Task/);
  assert.throws(() => w.updateField(tasks, 'Card', { config: { fields: ['Chip'] } }), /cannot show itself/i);
  assert.throws(() => w.updateField(tasks, 'Card', { config: { fields: ['Description'] } }), /document/i);
  assert.throws(() => w.updateField(tasks, 'Card', { config: { fields: 'Due' } }), /list of field names/);
  assert.throws(() => w.updateField(tasks, 'Card', { config: { link: 'yes' } }), /true or false/);
});

test('fields are stored by id and read back by name; null returns to auto', () => {
  const { w, tasks } = build();
  const db = w.getTable(tasks);
  w.updateField(tasks, 'Card', { config: { fields: ['Notes', 'Due'], description: 'large', link: false } });
  const card = w.viewField(db, 'card');
  assert.deepEqual(card.config.fields, [w.findField(db, 'Notes').id, w.findField(db, 'Due').id]);
  const { id: _id, ...described } = w.describeSchema().find((s) => s.space === 'Dev').tables.find((t) => t.name === 'Task').fields.find((f) => f.name === 'Card');
  assert.deepEqual(described, { name: 'Card', type: 'view', role: 'card', shape: 'card', link: false, state: true, description: 'large', fields: ['Notes', 'Due'] });
  w.updateField(tasks, 'Card', { config: { fields: null } });
  assert.equal(w.viewField(db, 'card').config.fields, null);
  // A renamed field keeps its place in the list, being held by id.
  w.updateField(tasks, 'Card', { config: { fields: ['Notes'] } });
  w.updateField(tasks, 'Notes', { name: 'Remarks' });
  assert.deepEqual(w.describeSchema().find((s) => s.space === 'Dev').tables.find((t) => t.name === 'Task').fields.find((f) => f.name === 'Card').fields, ['Remarks']);
  // A deleted field falls out of the list rather than breaking the card.
  w.deleteField(tasks, 'Remarks');
  assert.deepEqual(w.viewField(db, 'card').config.fields, []);
});

// ---------- rendering ----------

test('renderView chip: name, state first, then the first non-empty fields in order, three segments in all', () => {
  const { w, t } = build();
  const v = w.renderView(t.id, 'chip');
  assert.equal(v.shape, 'chip');
  assert.equal(v.id, t.id);
  assert.equal(v.publicId, 1);
  assert.equal(v.url, `/e/${t.id}`);
  assert.equal(v.name, 'Ship the editor');
  assert.equal(v.link, false);
  assert.deepEqual(v.state, { name: 'Doing', category: 'in-progress' });
  assert.equal(v.description, null);
  assert.deepEqual(v.fields, [{ label: 'Due', value: '2026-09-12' }, { label: 'Notes', value: 'polish pass' }]);
});

test('renderView card: link on, small description, state, and three fields', () => {
  const { w, t } = build();
  const v = w.renderView(t.id, 'card');
  assert.equal(v.shape, 'card');
  assert.equal(v.link, true);
  assert.equal(v.state.name, 'Doing');
  assert.equal(v.description, 'First line of the story.');
  assert.deepEqual(v.fields.map((f) => f.label), ['Due', 'Notes', 'Points']);
  assert.equal(v.fields[2].value, '3');
});

test('explicit fields are honoured in the given order, empties included as blanks, and a relation reads as names', () => {
  const { w, tasks, t } = build();
  w.updateField(tasks, 'Chip', { config: { fields: ['Owner', 'Tags', 'Points'], state: false } });
  const v = w.renderView(t.id, 'chip');
  assert.equal(v.state, null);
  assert.deepEqual(v.fields, [{ label: 'Owner', value: 'Ada' }, { label: 'Tags', value: '' }, { label: 'Points', value: '3' }]);
});

test('the description sizes clip the plain first lines of the description document', () => {
  const { w, tasks, t } = build();
  const sizes = {};
  for (const size of ['none', 'small', 'medium', 'large']) {
    w.updateField(tasks, 'Card', { config: { description: size } });
    sizes[size] = w.renderView(t.id, 'card').description;
  }
  assert.equal(sizes.none, null);
  assert.equal(sizes.small, 'First line of the story.');
  assert.ok(sizes.medium.startsWith('First line of the story. Second paragraph'), 'medium runs across paragraphs');
  assert.ok(sizes.medium.length <= 160 && sizes.medium.endsWith('…'), `medium is clipped: ${sizes.medium.length}`);
  assert.ok(sizes.large.length > sizes.medium.length);
  // A table without a description role has nothing to preview, and says so quietly.
  w.deleteField(tasks, 'Description');
  assert.equal(w.renderView(t.id, 'card').description, null);
});

test('readEntity: the view fields ride as a display line in fields and the object in raw', () => {
  const { w, t } = build();
  const e = w.readEntity(t.id);
  assert.equal(e.fields.Chip, 'Ship the editor · Doing · Due 2026-09-12 · Notes polish pass');
  assert.equal(e.raw.Chip.shape, 'chip');
  assert.equal(e.raw.Card.shape, 'card');
  assert.match(e.fields.Card, /^#1 Ship the editor · Doing · First line of the story\. · Due 2026-09-12/);
});

test('previewFields is the chip: state and fields, capped at three, so every doc mention follows the config', () => {
  const { w, tasks, t } = build();
  assert.deepEqual(w.previewFields(t.id), [
    { label: 'State', value: 'Doing' }, { label: 'Due', value: '2026-09-12' }, { label: 'Notes', value: 'polish pass' },
  ]);
  w.updateField(tasks, 'Chip', { config: { fields: ['Points'], state: false } });
  assert.deepEqual(w.previewFields(t.id), [{ label: 'Points', value: '3' }]);
});

test('a relation summary carries the chip of the far row', () => {
  const { w, t, owner } = build();
  const e = w.readEntity(t.id);
  assert.equal(e.fields.Owner.chip.name, 'Ada');
  assert.equal(e.fields.Owner.chip.shape, 'chip');
  const inverse = w.readEntity(owner.id);
  assert.equal(inverse.fields.Tasks[0].chip.state.name, 'Doing');
});

test('a chip never nests: auto never picks a view field, and the far chip has no fields of its own to recurse into', () => {
  const { w, tasks, t } = build();
  w.updateTable(tasks, { hiddenFields: [] });
  const v = w.renderView(t.id, 'card');
  assert.ok(!v.fields.some((f) => f.label === 'Chip' || f.label === 'Card'));
});

// ---------- round trips ----------

test('export/import keeps the config and the roles; a clone maps the ids', () => {
  const { w, tasks } = build();
  w.updateField(tasks, 'Card', { config: { fields: ['Due', 'Owner'], description: 'medium', link: false } });
  w.updateField(tasks, 'Chip', { name: 'Badge' });
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  const db = w2.getTable('Dev/Task');
  assert.equal(w2.viewField(db, 'chip').name, 'Badge');
  const card = w2.viewField(db, 'card');
  assert.equal(card.config.description, 'medium');
  assert.deepEqual(card.config.fields.map((id) => db.fields[id].name), ['Due', 'Owner']);
  const copy = w.duplicateTable(tasks);
  const cdb = w.getTable(copy.id ?? copy);
  assert.equal(cdb.fields[cdb.cardFieldId].type, 'view');
  assert.deepEqual(cdb.fields[cdb.cardFieldId].config.fields.map((id) => cdb.fields[id].name), ['Due', 'Owner']);
});

test('applySchema takes a view field by role and applies its config', () => {
  const { w } = build();
  const doc = w.describeSchema();
  const task = doc.find((s) => s.space === 'Dev').tables.find((t) => t.name === 'Task');
  const card = task.fields.find((f) => f.role === 'card');
  card.name = 'Tile';
  card.description = 'large';
  card.fields = ['Points'];
  w.applySchema(doc);
  const db = w.getTable('Dev/Task');
  assert.equal(w.viewField(db, 'card').name, 'Tile');
  assert.equal(w.viewField(db, 'card').config.description, 'large');
  assert.deepEqual(w.viewField(db, 'card').config.fields.map((id) => db.fields[id].name), ['Points']);
});

test('CSV export leaves the view columns out: they are presentation, not data', () => {
  const { w, tasks } = build();
  const csv = w.exportCSV(tasks);
  const header = csv.split('\n')[0];
  assert.ok(!header.includes('Chip') && !header.includes('Card'), header);
});

// ---------- the preview route ----------

test('renderView takes a candidate config, checked as a save would be, and saves nothing', () => {
  const { w, tasks, t } = build();
  const v = w.renderView(t.id, 'chip', { config: { link: true, state: false, fields: ['Points'] } });
  assert.equal(v.link, true);
  assert.equal(v.state, null);
  assert.deepEqual(v.fields, [{ label: 'Points', value: '3' }]);
  assert.deepEqual(w.viewField(w.getTable(tasks), 'chip').config, { shape: 'chip', link: false, state: true, description: 'none', fields: null }, 'the field is untouched');
  assert.throws(() => w.renderView(t.id, 'chip', { config: { fields: ['Nope'] } }), /not a field of Task/);
});

test('GET /api/entities/:ref/view serves the chip or card, under ?config= when the dialog previews', async () => {
  const { w, t } = build();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const card = await (await fetch(`${base}/api/entities/${t.id}/view?shape=card`)).json();
    assert.equal(card.shape, 'card');
    assert.equal(card.link, true);
    const cfg = encodeURIComponent(JSON.stringify({ link: false, description: 'none', fields: ['Owner'] }));
    const res = await fetch(`${base}/api/entities/${t.id}/view?shape=card&config=${cfg}`);
    assert.equal(res.status, 200);
    const v = await res.json();
    assert.equal(v.link, false);
    assert.equal(v.description, null);
    assert.deepEqual(v.fields, [{ label: 'Owner', value: 'Ada' }]);
    const bad = await fetch(`${base}/api/entities/${t.id}/view?shape=card&config=${encodeURIComponent('{"description":"huge"}')}`);
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
