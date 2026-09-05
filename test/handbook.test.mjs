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
  FIELD_DOCS, FIELD_KINDS, GUIDES, FORMATTING_SAMPLES, applyIconShowcase, iconLibraryPage, ICON_LIBRARY_PAGE,
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

/* Where a page tells the reader HOW a value is drawn, the vocabulary is the
   source and the page must not contradict it. Added 2026-08-27, after the
   document page went on claiming "Documents never take a column of their own"
   for as long as it took someone to read it: nothing in this suite pinned the
   sentence, so the description could take a column with every test green. */
test('a page never contradicts the vocabulary about how its type is drawn', () => {
  const doc = page('document').doc;
  const renders = VOCAB.fieldTypes.find((f) => f.type === 'document').renders;
  assert.match(renders, /column of its own/, 'the vocabulary says where a description is drawn');
  assert.doesNotMatch(doc, /never take a column of their own/,
    'the document page still says documents never take a column — the description does');
  assert.match(doc, /column of its own/, 'and the page has to say so too');
  assert.match(doc, /role/, 'the page names the description as a role, so a rename is not a surprise');
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

test('the polymorphic-relations guide covers the target set and the ruling behind it', () => {
  const guide = GUIDES.find((g) => g.name === 'Polymorphic relations');
  assert.ok(guide, 'there is no polymorphic-relations guide');
  for (const topic of [
    'targetDbs', '--target-dbs', 'Workspace/Spaces', 'Workspace/Tables', 'one core kind',
    'one-way', 'inverse', 'lookup', 'rollup', 'picker', 'relation map', 'home table',
    'Scope.Name', 'prune', 'Airtable', 'Fibery', 'bit-for-bit', 'weave_add_relation', '```mermaid',
  ]) {
    assert.ok(guide.doc.toLowerCase().includes(topic.toLowerCase()), `the polymorphic guide never mentions ${topic}`);
  }
  // Every cardinality the guide quotes is one the engine accepts.
  for (const m of guide.doc.matchAll(/\`(many-to-one|one-to-many|many-to-many|one-to-one)\`/g)) {
    assert.ok(VOCAB.cardinalities.includes(m[1]), `${m[1]} is not a cardinality the engine knows`);
  }
});

test('the customization guide covers what a reader can change', () => {
  const guide = GUIDES.find((g) => g.name === 'Making a workspace your own');
  assert.ok(guide, 'there is no customization guide');
  for (const topic of [
    'lucide:', 'noun', 'side peek', 'board', 'saved view', 'audit',
    '260px', 'Created At', 'costume', 'relation map', 'automation',
  ]) {
    assert.ok(guide.doc.toLowerCase().includes(topic.toLowerCase()), `the customization guide never mentions ${topic}`);
  }
  // The icon vocabulary is closed; the guide's examples have to come from it.
  for (const m of guide.doc.matchAll(/lucide:([a-z0-9-]+)/g)) {
    assert.ok(VOCAB.icons.names.includes(m[1]), `lucide:${m[1]} is not an icon the engine knows`);
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
  assert.equal(count('Showcase/Formatting'), 1, 'the showcase is one page (Issue #88)');

  const before = w.findEntity(w.getTable('Handbook/Fields'), 'number').id;

  applyHandbook(w);
  applyFormattingShowcase(w);

  assert.equal(count('Handbook/Fields'), FIELD_DOCS.length, 'a second apply duplicated the field pages');
  assert.equal(count('Showcase/Formatting'), 1, 'a second apply duplicated the showcase');
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
  assert.equal(w.query('Showcase/Icons', { limit: 10 }).total, 1, 'a seeded workspace carries the icon library page');

  assert.equal(w.query('Handbook/Fields', { limit: 200 }).total, FIELD_DOCS.length);
  assert.equal(w.query('Showcase/Formatting', { limit: 200 }).total, 1);
  const guides = w.query('Handbook/Guide', { limit: 200 }).items.map((e) => e.name);
  for (const g of GUIDES) assert.ok(guides.includes(g.name), `the seed ships no '${g.name}' guide`);

  // The Showcase's two halves answer the same question about different things.
  const spaces = w.listSpaces().map((s) => s.name);
  assert.ok(spaces.includes('Showcase'));
  assert.ok(w.findTable('Showcase/Field Types'));
  assert.ok(w.findTable('Showcase/Formatting'));
});

/* ---------- one page, not twelve (Issue #88) ----------
   Kyle: "formatting showcase could all be done in one entity's description."
   Twelve rows meant opening twelve records to see a renderer that one scroll
   proves — and row twelve, 'One page using all of it', already carried the
   whole demonstration on its own. */

/* Kyle, 2026-09-02: the icon library is documented in the Showcase, as one
   entity with pictures. The page is generated from the registry, so the test
   holds it to the set rather than to a number. */
test('the icon library is one Showcase page, true to the registry, with its pictures on disk', async () => {
  await import('../public/icon-registry.js');
  const reg = globalThis.weaveIconRegistry;
  const w = new Weave();
  applyIconShowcase(w);
  applyIconShowcase(w);
  const t = w.getTable('Showcase/Icons');
  assert.equal(w.query('Showcase/Icons', { limit: 10 }).total, 1, 'one page, applied twice');
  const row = w.findEntity(t, ICON_LIBRARY_PAGE);
  const doc = w.getDoc(row.id);
  assert.equal(doc, iconLibraryPage(), 'the row carries the generated page');
  await import('../public/field-dialog-core.js');
  assert.match(doc, new RegExp(`\\b${globalThis.fieldDialogCore.ICON_INVENTORY.length} names\\b`), 'names the size of the inventory');
  for (const m of doc.matchAll(/lucide:([a-z0-9-]+)/g)) assert.ok(reg.NAMES.includes(m[1]), `lucide:${m[1]} is not in the set`);
  for (const [ch, n] of Object.entries(reg.MARK_TWINS)) assert.ok(doc.includes(`| \`${ch}\` | \`lucide:${n}\` |`), `${ch} → ${n} is in the twins table`);
  for (const rule of ['once per hover', 'Nothing loops', 'prefers-reduced-motion', 'iconly:<name>', 'build-lucide-moving.mjs']) assert.ok(doc.includes(rule), `the page states: ${rule}`);
  const { existsSync } = await import('node:fs');
  for (const m of doc.matchAll(/!\[[^\]]*\]\(\/showcase\/icons\/([^)]+)\)/g)) {
    assert.ok(existsSync(new URL(`../public/showcase/icons/${m[1]}`, import.meta.url)), `picture ${m[1]} is served from public/`);
  }
  assert.ok([...doc.matchAll(/!\[/g)].length >= 3, 'the page carries pictures');
  assert.equal(t.icon, 'lucide:sparkles');
});

test('the showcase is one page carrying every construct', async () => {
  const { Weave: W } = await import('../src/engine.js');
  const w = new W();
  applyFormattingShowcase(w);

  const rows = w.query('Showcase/Formatting', { limit: 200 }).items;
  assert.equal(rows.length, 1);
  const page = w.readEntity(rows[0].id).docs.Description;

  // Every sample's body survives the move, verbatim.
  for (const s of FORMATTING_SAMPLES) {
    assert.ok(page.includes(s.doc), `the page dropped '${s.name}'`);
  }
  // And the syntax column survives as a table inside the page it describes.
  for (const s of FORMATTING_SAMPLES) {
    assert.ok(page.includes(s.name), `the page never names '${s.name}'`);
  }
  assert.match(page, /\| Construct \| Syntax \|/, 'the syntax reference rides in the page');
});

test('re-applying keeps the one page rather than seeding twelve beside it', () => {
  const w = new Weave();
  applyFormattingShowcase(w);
  const first = w.query('Showcase/Formatting', { limit: 200 }).items[0].id;
  applyFormattingShowcase(w);
  const rows = w.query('Showcase/Formatting', { limit: 200 }).items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, first, 'the page was replaced instead of updated — inbound links would break');
});

/* ---------- Chip and card anatomy (Feature #180, 2026-09-05) ----------
   Kyle: "Drop a visual HTML breakdown of chip and card anatomy — what each
   element does and how to use (copy link, click to open) — with hitboxes."
   The page is a Guide whose figures are the REAL chip and card markup (the
   same classes app.js emits, so the app's own CSS draws them and the caret
   in the figure toggles for real), each element outlined in a colour that
   the legend beneath repeats. The same page is exported as ONE
   self-contained HTML file for sharing outside the app; the export and the
   source must not drift. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/source.mjs';
const ANATOMY = GUIDES.find((g) => g.name === 'Chip and card anatomy');

test('the anatomy guide exists, is for both audiences, and follows the view page', () => {
  assert.ok(ANATOMY, 'a Handbook/Guide named "Chip and card anatomy"');
  assert.equal(ANATOMY.audience, 'Both');
  assert.ok(ANATOMY.order > Math.max(...GUIDES.filter((g) => g !== ANATOMY).map((g) => g.order)), 'last in the guide order');
  assert.match(ANATOMY.doc, /\[\[Handbook\/Fields#view\]\]|\bview\b/, 'points at the view field page it explains the face of');
});

test('the anatomy names every element of the chip and the card, what it does, and how you use it', () => {
  const doc = ANATOMY.doc;
  for (const term of ['avatar', 'public id', 'name', 'home badge', 'caret', 'segment', '↗', '×', 'state', 'description', 'fields']) {
    assert.ok(doc.toLowerCase().includes(term.toLowerCase()), `names the ${term}`);
  }
  for (const use of ['click', 'copy link', '⌘', 'middle', 'hover', 'expand', 'collapse', 'unlink']) {
    assert.ok(doc.toLowerCase().includes(use.toLowerCase()), `says how to ${use}`);
  }
  assert.match(doc, /hitbox/i, 'says what a hitbox is on this page');
});

test('the figures are the real chip and the real card, with each hitbox drawn as an outline', () => {
  const doc = ANATOMY.doc;
  // The chip specimen: the classes app.js emits, open so the segments show.
  for (const cls of ['mention-wrap open', 'k k-rel', 'mention-caret', 'mention-fields', 'k-state', 'k-home', 'mention-f-label']) {
    assert.ok(doc.includes(cls), `the chip figure carries .${cls.split(' ').pop()}`);
  }
  // The card specimen.
  for (const cls of ['wv-card', 'wv-card-head', 'wv-card-title', 'wv-card-id', 'wv-card-desc', 'wv-card-fields']) {
    assert.ok(doc.includes(`class="${cls}`), `the card figure carries .${cls}`);
  }
  const outlines = doc.match(/outline:\s*[^;"]+dashed[^;"]*/g) ?? [];
  assert.ok(outlines.length >= 12, `every element carries a dashed outline as its drawn hitbox, got ${outlines.length}`);
  const badges = doc.match(/class="wv-anat-n"/g) ?? [];
  assert.ok(badges.length >= 12, `every outlined element is numbered, got ${badges.length}`);
  // Raw HTML blocks end at a blank line — a figure with one inside would render half as prose.
  for (const block of doc.split(/\n\s*\n/).filter((b) => b.startsWith('<'))) {
    assert.ok(/^<\w/.test(block) && /<\/(div|figure)>\s*$/.test(block), 'each figure is one unbroken raw-HTML block');
  }
  assert.doesNotMatch(doc, /<style|<script|src="http|href="http/, 'no stylesheet, script or external asset — the app draws it');
});

test('docs/chip-card-anatomy.html is the exported page, self-contained, and current', () => {
  const file = join(ROOT, 'docs/chip-card-anatomy.html');
  assert.ok(existsSync(file), 'the standalone export is checked in');
  const html = readFileSync(file, 'utf8');
  const fresh = execFileSync(process.execPath, [join(ROOT, 'scripts/export-chip-card-anatomy.mjs'), '--stdout'], { encoding: 'utf8' });
  assert.equal(html, fresh, 'the checked-in export drifted from the guide — run scripts/export-chip-card-anatomy.mjs');
  assert.doesNotMatch(html, /(src|href)=["'](https?:)?\/\//, 'no network requests: no external src or href');
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/, 'no linked stylesheet — the chip CSS is inlined');
  assert.match(html, /--wv-chip-font:\s*13px/, 'the chip tokens ride along, so the specimen is the real size');
  assert.match(html, /data-bs-theme="dark"\]|prefers-color-scheme:\s*dark/, 'both themes');
  assert.match(html, /class="k k-rel has-segs"/, 'the chip figure is in the export');
  assert.match(html, /class="wv-card"/, 'and the card figure');
});
