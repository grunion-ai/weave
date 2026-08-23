import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave, ONTOLOGY, FIELD_TYPES } from '../src/engine.js';

/* The ontology (docs/ONTOLOGY.md) names weave's ENTITY TYPES — the kinds of
   object the engine itself models — which are a different axis from the FIELD
   TYPES a column can have. An entity HAS fields; a field is not an entity.
   `ONTOLOGY` in the engine is the single source of truth; this suite is the
   drift gate holding the prose, the glossary and the engine to it. */

const DOC = readFileSync(new URL('../docs/ONTOLOGY.md', import.meta.url), 'utf8');

// Names as they appear bolded in the ontology table's first column.
function docRows() {
  return [...DOC.matchAll(/^\| \*\*([A-Za-z ]+)\*\* \|/gm)].map((m) => m[1]);
}
// Glossary terms: `### Term` under the Glossary heading.
function glossaryTerms() {
  const start = DOC.indexOf('## Glossary');
  assert.ok(start > 0, 'ONTOLOGY.md must have a Glossary section');
  return [...DOC.slice(start).matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
}

test('ONTOLOGY entries are well-formed and uniquely keyed', () => {
  assert.ok(ONTOLOGY.length >= 10, 'an ontology of fewer than ten kinds is not one');
  const keys = new Set();
  for (const t of ONTOLOGY) {
    for (const prop of ['key', 'name', 'layer', 'definition', 'identity', 'storedIn', 'api']) {
      assert.ok(t[prop], `${t.key ?? '?'} is missing '${prop}'`);
    }
    assert.ok(!keys.has(t.key), `duplicate ontology key '${t.key}'`);
    keys.add(t.key);
    assert.ok(Array.isArray(t.api) && t.api.length, `${t.key} names no engine verbs`);
  }
});

test('every ontology entry names engine verbs that exist', () => {
  for (const t of ONTOLOGY) {
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
  for (const t of ONTOLOGY) {
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

test('parent links resolve to other entity types', () => {
  const keys = new Set(ONTOLOGY.map((t) => t.key));
  for (const t of ONTOLOGY) {
    if (t.parent) assert.ok(keys.has(t.parent), `${t.key}: parent '${t.parent}' is not an entity type`);
  }
});

test('the ontology table in the doc matches the engine exactly', () => {
  const inDoc = docRows();
  const inCode = ONTOLOGY.map((t) => t.name);
  for (const name of inCode) assert.ok(inDoc.includes(name), `ONTOLOGY.md is missing the '${name}' row`);
  for (const name of inDoc) assert.ok(inCode.includes(name), `ONTOLOGY.md documents '${name}', which the engine does not model`);
});

test('the glossary defines every entity type and every field type', () => {
  const terms = glossaryTerms().map((t) => t.toLowerCase());
  for (const t of ONTOLOGY) {
    assert.ok(terms.includes(t.name.toLowerCase()), `glossary is missing entity type '${t.name}'`);
  }
  for (const ft of FIELD_TYPES) {
    assert.ok(terms.some((t) => t === ft || t.startsWith(`${ft} `) || t.includes(`\`${ft}\``)),
      `glossary is missing field type '${ft}'`);
  }
});

test('the glossary draws the entity-type / field-type distinction itself', () => {
  const terms = glossaryTerms().map((t) => t.toLowerCase());
  assert.ok(terms.includes('entity type'), 'glossary must define "entity type"');
  assert.ok(terms.includes('field type'), 'glossary must define "field type"');
});

test('the doc lists exactly the engine field types', () => {
  const start = DOC.indexOf('## The other axis: field types');
  assert.ok(start > 0, 'ONTOLOGY.md must contrast entity types with field types');
  const section = DOC.slice(start, DOC.indexOf('\n## ', start + 5));
  for (const ft of FIELD_TYPES) {
    assert.ok(section.includes(`\`${ft}\``), `field-type axis is missing \`${ft}\``);
  }
  const named = [...section.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
  for (const n of new Set(named)) {
    assert.ok(FIELD_TYPES.includes(n), `field-type axis names \`${n}\`, which is not a field type`);
  }
});
