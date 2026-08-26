/* The Handbook is documentation that has to stay true, so it is gated like
   code. Every field type the engine can make has a page; every page names
   every config key the vocabulary lists for that type; the guides name the
   constructs the editor actually offers; and the formatting samples are
   written in the construct they claim.
   The pages themselves live in src/handbook.js and are applied by upsert, so
   this suite also holds the line on running the apply twice. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { VOCABULARY } from '../src/vocabulary.js';
import {
  FIELD_DOCS, FIELD_KINDS, GUIDES, FORMATTING_SAMPLES,
  applyHandbook, applyFormattingShowcase,
} from '../src/handbook.js';

const VOCAB = VOCABULARY;
const page = (name) => FIELD_DOCS.find((f) => f.name === name);

test('every field type the engine can make has a page, and no page invents one', () => {
  const engineTypes = VOCAB.fieldTypes.map((f) => f.type).sort();
  const documented = FIELD_DOCS.map((f) => f.name).sort();
  assert.deepEqual(documented, engineTypes);
});

test('each page names every config key the vocabulary lists for its type', () => {
  for (const { type, config } of VOCAB.fieldTypes) {
    const doc = page(type).doc;
    for (const key of config) {
      assert.ok(doc.includes(`\`${key}\``), `the ${type} page never names its \`${key}\` config key`);
    }
  }
});

test('each page carries the sections a reader looks for, and a known kind', () => {
  for (const f of FIELD_DOCS) {
    assert.ok(f.doc.startsWith(`# ${f.name}\n`), `${f.name} does not open with its own name`);
    assert.match(f.doc, /\n## Config\n/, `${f.name} has no Config section`);
    assert.match(f.doc, /\n## Gotchas\n/, `${f.name} has no Gotchas section`);
    assert.ok(FIELD_KINDS.includes(f.kind), `${f.name} claims an unknown kind '${f.kind}'`);
  }
});

test('the closed vocabularies a page quotes match the engine', () => {
  // A page that lists a set has to list the whole set — a stale option colour
  // or a fifth workflow category is exactly the kind of drift this catches.
  for (const c of VOCAB.optionColors) {
    if (!c.value) continue;
    assert.ok(page('select').doc.includes(c.value), `select omits the ${c.name} option colour`);
  }
  for (const cat of VOCAB.stateCategories) {
    assert.ok(page('workflow').doc.includes(`\`${cat}\``), `workflow omits the ${cat} category`);
  }
  for (const agg of VOCAB.aggregates) {
    assert.ok(page('rollup').doc.includes(`\`${agg}\``), `rollup omits the ${agg} aggregate`);
  }
  for (const card of VOCAB.cardinalities) {
    assert.ok(page('relation').doc.includes(`\`${card}\``), `relation omits the ${card} cardinality`);
  }
  for (const kind of VOCAB.documentKinds) {
    assert.ok(page('document').doc.includes(`\`${kind}\``), `document omits the ${kind} kind`);
  }
  for (const fmt of VOCAB.dateFormats) {
    assert.ok(page('date').doc.includes(`\`${fmt}\``), `date omits the ${fmt} format`);
  }
  for (const fmt of VOCAB.numberFormats) {
    assert.ok(page('number').doc.includes(`\`${fmt}\``), `number omits the ${fmt} format`);
  }
});

test('the document-formatting guide covers the surface the editor offers', () => {
  const guide = GUIDES.find((g) => g.name === 'Document formatting');
  assert.ok(guide, 'there is no document-formatting guide');
  for (const topic of [
    'slash menu', 'Task list', 'mermaid', 'KaTeX', 'mhchem', 'highlight.js',
    '[[Task#12]]', '[[table:Task]]', '[[space:Handbook]]', 'fold', 'dash rail',
    'Raw HTML', 'full screen', 'markdown',
  ]) {
    assert.ok(guide.doc.toLowerCase().includes(topic.toLowerCase()), `the formatting guide never mentions ${topic}`);
  }
});

test('the customization guide covers what a reader can change', () => {
  const guide = GUIDES.find((g) => g.name === 'Making a workspace your own');
  assert.ok(guide, 'there is no customization guide');
  for (const topic of [
    'iconly:', 'noun', 'side peek', 'board', 'saved view', 'audit',
    '260px', 'Created At', 'costume', 'relation map', 'automation',
  ]) {
    assert.ok(guide.doc.toLowerCase().includes(topic.toLowerCase()), `the customization guide never mentions ${topic}`);
  }
  // The icon vocabulary is closed; the guide's examples have to come from it.
  for (const m of guide.doc.matchAll(/iconly:([a-z0-9-]+)/g)) {
    assert.ok(VOCAB.icons.names.includes(m[1]), `iconly:${m[1]} is not an icon the engine knows`);
  }
});

test('every formatting sample is written in the construct it claims', () => {
  const has = (name, needle) => {
    const s = FORMATTING_SAMPLES.find((x) => x.name === name);
    assert.ok(s, `there is no '${name}' sample`);
    assert.ok(s.doc.includes(needle), `the '${name}' sample does not contain ${needle}`);
  };
  has('Headings and folds', '\n### ');
  has('Lists and task lists', '- [x] ');
  has('Quote, divider, line break', '\n***\n');
  has('Emphasis and inline code', '~~');
  has('Tables', '| --- |');
  has('Code, labelled', '```js');
  has('Mermaid diagrams', '```mermaid');
  has('Math and chemistry', '\\ce{');
  has('Links to entities, tables and spaces', '[[table:');
  has('Raw HTML', '<div');
  // An unlabelled fence has to actually be unlabelled, or it proves nothing.
  const bare = FORMATTING_SAMPLES.find((s) => s.name === 'Code, unlabelled');
  assert.ok(/```\n/.test(bare.doc), 'the unlabelled-fence sample labels its fences');
});

test('applying the handbook is idempotent and does not lose a page', () => {
  const w = new Weave();
  applyHandbook(w);
  applyFormattingShowcase(w);

  const count = (t) => w.query(t, { limit: 200 }).total;
  assert.equal(count('Handbook/Fields'), FIELD_DOCS.length);
  assert.equal(count('Showcase/Formatting'), FORMATTING_SAMPLES.length);

  const before = w.findEntity(w.getTable('Handbook/Fields'), 'number').id;

  applyHandbook(w);
  applyFormattingShowcase(w);

  assert.equal(count('Handbook/Fields'), FIELD_DOCS.length, 'a second apply duplicated the field pages');
  assert.equal(count('Showcase/Formatting'), FORMATTING_SAMPLES.length, 'a second apply duplicated the samples');
  assert.equal(count('Handbook/Guide'), GUIDES.length);
  assert.equal(
    w.findEntity(w.getTable('Handbook/Fields'), 'number').id, before,
    'a second apply replaced a page instead of updating it — inbound [[…]] links would break',
  );
});

test('an apply onto an existing page keeps its id and refreshes its document', () => {
  const w = new Weave();
  applyHandbook(w);
  const fields = w.getTable('Handbook/Fields');
  const row = w.findEntity(fields, 'key');
  w.setDoc(row.id, '# key\n\nstale');

  applyHandbook(w);
  const after = w.readEntity(row.id);
  assert.equal(after.id, row.id);
  assert.match(after.doc, /keystore/);
  assert.equal(after.fields.Kind, 'Secret');
});

test('the seeded weave workspace ships the pages, the guides and the samples', async () => {
  const { seedWeaver } = await import('../src/weaver-seed.js');
  const w = seedWeaver(new Weave());

  assert.equal(w.query('Handbook/Fields', { limit: 200 }).total, FIELD_DOCS.length);
  assert.equal(w.query('Showcase/Formatting', { limit: 200 }).total, FORMATTING_SAMPLES.length);
  const guides = w.query('Handbook/Guide', { limit: 200 }).items.map((e) => e.name);
  for (const g of GUIDES) assert.ok(guides.includes(g.name), `the seed ships no '${g.name}' guide`);

  // The Showcase's two halves answer the same question about different things.
  const spaces = w.listSpaces().map((s) => s.name);
  assert.ok(spaces.includes('Showcase'));
  assert.ok(w.findTable('Showcase/Field Types'));
  assert.ok(w.findTable('Showcase/Formatting'));
});
