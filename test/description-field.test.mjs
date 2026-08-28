/* The description is a role, not a name (Kyle, 2026-08-27).

   "description should be a default field in all entities. it can be renamed
   or deleted." Every table got one already — createTable minted it — but the
   role lived in the literal string 'Description' and in the accident of being
   the first document field. So a rename quietly moved the default document to
   whichever document happened to sort first, and a DELETE did not stick: the
   migration pass on the next constructor found zero document fields and put
   'Description' back.

   A table now points at its description by id. The pointer survives a rename
   for free, and deleting the field sets it to null — the tombstone that lets
   the migration tell "the owner removed it" from "this table predates the
   role" (undefined). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  return { w, tasks };
}

// A workspace on disk, so a change can be proved to survive a fresh open.
function onDisk() {
  const path = join(mkdtempSync(join(tmpdir(), 'weave-desc-')), 'uno.json');
  const w = new Weave({ path });
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  return { w, tasks, path, reopen: () => new Weave({ path }) };
}

test('a new table names its description field', () => {
  const { w, tasks } = build();
  const db = w.getTable(tasks);
  const docs = w.documentFields(db);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].name, 'Description');
  assert.equal(db.descriptionFieldId, docs[0].id, 'the role is minted, not inferred');
  assert.equal(w.descriptionField(db).id, docs[0].id);
});

test('renaming the description keeps the role through a reload', () => {
  const { w, tasks, reopen } = onDisk();
  const before = w.getTable(tasks).descriptionFieldId;
  w.updateField(tasks, 'Description', { name: 'Notes' });
  assert.equal(w.getTable(tasks).descriptionFieldId, before, 'an id does not care what it is called');

  const w2 = reopen();
  const db = w2.getTable('Product/Task');
  assert.deepEqual(w2.documentFields(db).map((f) => f.name), ['Notes'], 'no second Description appears');
  assert.equal(db.descriptionFieldId, before);
  assert.equal(w2.descriptionField(db).name, 'Notes');
});

test('a deleted description stays deleted across a reload', () => {
  const { w, tasks, reopen } = onDisk();
  w.deleteField(tasks, 'Description');
  assert.equal(w.getTable(tasks).descriptionFieldId, null, 'null is the tombstone');
  assert.equal(w.descriptionField(w.getTable(tasks)), null);

  const w2 = reopen();
  const db = w2.getTable('Product/Task');
  assert.deepEqual(w2.documentFields(db), [], 'the migration does not put it back');
  assert.equal(db.descriptionFieldId, null);
});

test('a table that predates the role adopts its first document field', () => {
  const { w, tasks } = build();
  w.updateField(tasks, 'Description', { name: 'Notes' });
  const dump = w.exportJSON();
  for (const db of Object.values(dump.tables)) delete db.descriptionFieldId;

  const w2 = new Weave();
  w2.importJSON(dump);
  const db = w2.getTable('Product/Task');
  assert.deepEqual(w2.documentFields(db).map((f) => f.name), ['Notes'], 'adopted, not duplicated');
  assert.equal(db.descriptionFieldId, w2.documentFields(db)[0].id);
});

test('a table that predates the role and has no document still gets one', () => {
  const { w, tasks } = build();
  const dump = w.exportJSON();
  for (const db of Object.values(dump.tables)) {
    delete db.descriptionFieldId;
    for (const [fid, f] of Object.entries(db.fields)) {
      if (f.type !== 'document') continue;
      delete db.fields[fid];
      db.fieldOrder = db.fieldOrder.filter((id) => id !== fid);
    }
  }

  const w2 = new Weave();
  w2.importJSON(dump);
  const db = w2.getTable('Product/Task');
  assert.deepEqual(w2.documentFields(db).map((f) => f.name), ['Description'], 'the v1 backfill survives');
  assert.equal(db.descriptionFieldId, w2.documentFields(db)[0].id);
});

test('the system registry tables never take a description role', () => {
  const { w } = build();
  const system = w.listTables().filter((db) => db.system);
  assert.ok(system.length >= 3, 'the meta tables exist');
  for (const db of system) {
    assert.equal(db.descriptionFieldId, undefined, `${db.name} claims a description role`);
    assert.equal(w.descriptionField(db), null, `${db.name} answers to descriptionField()`);
    // Some registry tables DO carry documents — Workflows holds Script and
    // Diagram — but the registry's own 'Description' is a TEXT column
    // mirroring the real space/table description. Same word, different thing,
    // and the migration must never confuse the two.
    const own = w.findField(db, 'Description');
    if (own) assert.equal(own.type, 'text', `${db.name}.Description is not the registry's text column`);
  }
});

test('the default document follows the role, not field order', () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Spec', type: 'document' });
  const db = w.getTable(tasks);
  const spec = w.findField(db, 'Spec');
  // Put Spec ahead of the description; the positional guess would switch.
  db.fieldOrder = [db.nameFieldId, spec.id, db.descriptionFieldId];

  const e = w.createEntity(tasks, { name: 'T', doc: 'the description body' });
  assert.equal(w.getDoc(e.id), 'the description body');
  assert.equal(w.readEntity(e.id).doc, 'the description body');
});

test('the role cannot be orphaned by a type change, because a document has none', () => {
  // The engine refuses to migrate a document to any other type, so the role
  // can only ever end in one of two states: pointing at a document, or null.
  // Deleting is the way out, and that is the path the tombstone covers.
  const { w, tasks } = onDisk();
  const before = w.getTable(tasks).descriptionFieldId;
  assert.throws(() => w.updateField(tasks, 'Description', { type: 'text' }), /document field can become nothing else/);
  assert.equal(w.getTable(tasks).descriptionFieldId, before, 'a refused migration leaves the role alone');
});

test('the tombstone survives export and import', () => {
  const { w, tasks } = build();
  w.deleteField(tasks, 'Description');
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  const db = w2.getTable('Product/Task');
  assert.deepEqual(w2.documentFields(db), []);
  assert.equal(db.descriptionFieldId, null, 'null round-trips through JSON; undefined stays absent');
});
