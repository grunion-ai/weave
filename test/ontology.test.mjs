import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave, ONTOLOGY, FIELD_TYPES } from '../src/engine.js';

/* The ontology (docs/ONTOLOGY.md). Its spine, per Kyle 2026-08-23: an ENTITY
   is the one core kind, and workspaces, spaces, tables and the rows inside
   tables are all entities — differing by LEVEL, not by kind. What a row gets
   called downstream (record, item, entry, customer, company, account) is a
   naming convention and changes nothing. Each entity has a dedicated entity
   view containing its fields. FIELD TYPES are the other axis entirely: the
   datatype of one slot. An entity HAS fields; a field is described by an
   entity of its own, and `text` is not a kind of thing weave stores.

   This suite is the drift gate over all of that — including the invariant
   that structure really is data, checked by creating a space, a table and a
   field and reading each back as an entity with fields. */

const DOC = readFileSync(new URL('../docs/ONTOLOGY.md', import.meta.url), 'utf8');

function docRows() {
  return [...DOC.matchAll(/^\| \*\*([A-Za-z ]+)\*\* \|/gm)].map((m) => m[1]);
}
function glossaryTerms() {
  const start = DOC.indexOf('## Glossary');
  assert.ok(start > 0, 'ONTOLOGY.md must have a Glossary section');
  return [...DOC.slice(start).matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
}
const groups = () => [...ONTOLOGY.levels, ...ONTOLOGY.constituents, ...ONTOLOGY.apparatus];

test('the ontology has one core kind, and the entity levels are its levels', () => {
  assert.equal(ONTOLOGY.core.key, 'entity', 'the core kind is the entity');
  assert.deepEqual(ONTOLOGY.levels.map((l) => l.key), ['workspace', 'space', 'table', 'field', 'row'],
    'the levels are workspace > space > table > field > row');
  for (const l of ONTOLOGY.levels) assert.equal(l.isEntity, true, `${l.key} must be an entity`);
});

test('every ontology entry is well-formed and uniquely keyed', () => {
  const keys = new Set();
  for (const t of [ONTOLOGY.core, ...groups()]) {
    for (const prop of ['key', 'name', 'definition', 'storedIn', 'api']) {
      assert.ok(t[prop], `${t.key ?? '?'} is missing '${prop}'`);
    }
    assert.ok(!keys.has(t.key), `duplicate ontology key '${t.key}'`);
    keys.add(t.key);
    assert.ok(Array.isArray(t.api) && t.api.length, `${t.key} names no engine verbs`);
  }
});

test('every ontology entry names engine verbs that exist', () => {
  for (const t of [ONTOLOGY.core, ...groups()]) {
    for (const m of t.api) {
      assert.equal(typeof Weave.prototype[m], 'function', `${t.key}: Weave has no verb '${m}()'`);
    }
  }
});

test('every ontology entry is stored where it says it is', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const db = w.createTable({ space: 'Dev', name: 'Task' });
  const e = w.createEntity(db.id, { Name: 'row' });
  const schema = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  for (const t of [ONTOLOGY.core, ...groups()]) {
    const where = t.storedIn;
    if (where.startsWith('state.')) {
      const [, root, nested] = where.split('.');
      assert.ok(root in w.state, `${t.key}: '${root}' is not a workspace state key`);
      if (nested) assert.ok(['views', 'accounts'].includes(nested), `${t.key}: unknown '${where}'`);
    } else if (where.startsWith('entity.')) {
      assert.ok(where.split('.')[1] in e, `${t.key}: an entity has no '${where}'`);
    } else if (where === 'table.fields') {
      assert.ok('fields' in db, 'a table has no fields map');
    } else if (where.startsWith('store.')) {
      const table = where.split('.')[1];
      assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${t.key}: no '${table}' table in the store`);
    } else {
      assert.equal(where, 'keystore', `${t.key}: '${where}' is not a place weave stores anything`);
      assert.ok(w.keystorePath, 'the keystore lives outside the workspace and must have a path');
    }
  }
});

/* The claim the whole ontology rests on: structure is not a different kind of
   thing from data. Create a space, a table and a field, then read each back as
   an entity carrying fields — the same verb a customer row answers to. */
test('spaces, tables and fields really are entities with fields', () => {
  const w = new Weave();
  const space = w.createSpace({ name: 'Dev' });
  const db = w.createTable({ space: 'Dev', name: 'Task' });
  const field = w.addField(db.id, { name: 'Points', type: 'number' });
  const row = w.createEntity(db.id, { Name: 'ship it', Points: 3 });

  const registryRow = (table, name) => {
    const hit = w.query(table, { where: [['Name', '=', name]] }).items[0];
    assert.ok(hit, `${name} has no row in ${table}`);
    return w.readEntity(hit.id);
  };
  for (const [level, read] of [
    ['space', () => registryRow('Spaces', space.name)],
    ['table', () => registryRow('Tables', db.name)],
    ['field', () => registryRow('Fields', field.name)],
    ['row', () => w.readEntity(row.id)],
  ]) {
    const ent = read();
    assert.ok(ent.id, `${level}: no entity id`);
    assert.ok(ent.fields && Object.keys(ent.fields).length, `${level}: entity view carries no fields`);
    assert.ok(ent.publicId > 0, `${level}: no public id to address it by`);
  }
});

test('each entity level declares its registry table, or says why it has none', () => {
  const w = new Weave();
  for (const l of ONTOLOGY.levels) {
    if (l.registry) {
      const t = w.getTable(l.registry.split('/')[1]);
      assert.ok(t.system, `${l.key}: '${l.registry}' must be a system table`);
    } else {
      assert.ok(l.note, `${l.key} has no registry table and does not say why`);
    }
  }
});

test('row names are documented as aliases, not as kinds', () => {
  assert.ok(ONTOLOGY.aliases.length >= 5, 'the alias list is the point: names are endless');
  const kinds = new Set(groups().map((t) => t.key));
  const flat = DOC.replace(/\s+/g, ' ');
  for (const a of ONTOLOGY.aliases) {
    assert.ok(DOC.toLowerCase().includes(a), `ONTOLOGY.md never mentions the alias '${a}'`);
    if (!kinds.has(a)) continue;
    // A word that is both an alias and a kind has to be disambiguated, not tidied away.
    const c = ONTOLOGY.collisions.find((x) => x.alias === a);
    assert.ok(c, `'${a}' is both a row name and a kind, and nothing says so`);
    assert.ok(flat.includes(c.note.replace(/\s+/g, ' ')), `ONTOLOGY.md does not disambiguate '${a}'`);
  }
});

test('the ontology tables in the doc match the engine exactly', () => {
  const inDoc = docRows();
  const inCode = [ONTOLOGY.core, ...groups()].map((t) => t.name);
  for (const name of inCode) assert.ok(inDoc.includes(name), `ONTOLOGY.md is missing the '${name}' row`);
  for (const name of inDoc) assert.ok(inCode.includes(name), `ONTOLOGY.md documents '${name}', which the engine does not model`);
});

test('the glossary defines every kind and every field type', () => {
  const terms = glossaryTerms().map((t) => t.toLowerCase());
  for (const t of [ONTOLOGY.core, ...groups()]) {
    assert.ok(terms.includes(t.name.toLowerCase()), `glossary is missing '${t.name}'`);
  }
  for (const ft of FIELD_TYPES) {
    assert.ok(terms.some((t) => t === ft || t.startsWith(`${ft} `) || t.includes(`\`${ft}\``)),
      `glossary is missing field type '${ft}'`);
  }
});

test('the glossary draws the distinctions the ontology exists to draw', () => {
  const terms = glossaryTerms().map((t) => t.toLowerCase());
  for (const term of ['entity', 'entity type', 'field type', 'entity view']) {
    assert.ok(terms.includes(term), `glossary must define "${term}"`);
  }
});

test('the doc lists exactly the engine field types', () => {
  const start = DOC.indexOf('## The other axis: field types');
  assert.ok(start > 0, 'ONTOLOGY.md must contrast entities with field types');
  const section = DOC.slice(start, DOC.indexOf('\n## ', start + 5));
  for (const ft of FIELD_TYPES) {
    assert.ok(section.includes(`\`${ft}\``), `field-type axis is missing \`${ft}\``);
  }
  const named = [...section.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
  for (const n of new Set(named)) {
    assert.ok(FIELD_TYPES.includes(n), `field-type axis names \`${n}\`, which is not a field type`);
  }
});

/* Kyle, 2026-08-24: a workspace and a space are themselves structured as
   tables with fields — and a table's configuration (the description at its
   top, which fields are visible, in what order) is fields ON its registry
   row. The doc must say so, and the fields it names must actually exist on
   the Tables registry. */
test('the doc documents structure-as-tables, and the config fields are real', () => {
  const start = DOC.indexOf('## Every level is a table');
  assert.ok(start > 0, 'ONTOLOGY.md must carry the "Every level is a table" section');
  const section = DOC.slice(start, DOC.indexOf('\n## ', start + 5));
  const w = new Weave();
  const tablesT = w.getTable('Tables');
  for (const name of ['Field Order', 'Hidden Fields', 'Description']) {
    assert.ok(section.includes(`\`${name}\``), `section never names \`${name}\``);
    assert.ok(Object.values(tablesT.fields).some((f) => f.name === name),
      `'${name}' is documented but not a field of the Tables registry`);
  }
});
