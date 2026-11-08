import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TOOLS, CORE_TOOLS } from './mcp.js';
import { FIELD_TYPES } from './engine.js';

const PAGE_VALUES = { 'CORE_TOOLS.size': CORE_TOOLS.size, 'TOOLS.length': TOOLS.length, 'FIELD_TYPES.length': FIELD_TYPES.length };
const page = (file) => readFileSync(new URL(`./handbook/${file}`, import.meta.url), 'utf8')
  .replace(/\{\{(CORE_TOOLS\.size|TOOLS\.length|FIELD_TYPES\.length)\}\}/g, (_, key) => String(PAGE_VALUES[key]));

export const FIELD_KINDS = ['Value', 'Choice', 'Relation', 'Computed', 'Document', 'Meta', 'Secret', 'Files'];

export const FIELD_DOCS = [
  { name: 'text', kind: 'Value', doc: page('fields/text.md') },

  { name: 'number', kind: 'Value', doc: page('fields/number.md') },

  { name: 'date', kind: 'Value', doc: page('fields/date.md') },
  { name: 'daterange', kind: 'Value', doc: page('fields/daterange.md') },

  { name: 'checkbox', kind: 'Value', doc: page('fields/checkbox.md') },

  { name: 'toggle', kind: 'Value', doc: page('fields/toggle.md') },

  { name: 'rating', kind: 'Value', doc: page('fields/rating.md') },

  { name: 'url', kind: 'Value', doc: page('fields/url.md') },

  { name: 'email', kind: 'Value', doc: page('fields/email.md') },

  { name: 'select', kind: 'Choice', doc: page('fields/select.md') },

  { name: 'multiselect', kind: 'Choice', doc: page('fields/multiselect.md') },

  { name: 'workflow', kind: 'Choice', doc: page('fields/workflow.md') },

  { name: 'relation', kind: 'Relation', doc: page('fields/relation.md') },

  { name: 'lookup', kind: 'Computed', doc: page('fields/lookup.md') },

  { name: 'rollup', kind: 'Computed', doc: page('fields/rollup.md') },

  { name: 'formula', kind: 'Computed', doc: page('fields/formula.md') },

  { name: 'document', kind: 'Document', doc: page('fields/document.md') },

  { name: 'field', kind: 'Meta', doc: page('fields/field.md') },

  { name: 'key', kind: 'Secret', doc: page('fields/key.md') },

  { name: 'view', kind: 'Meta', doc: page('fields/view.md') },

  { name: 'attachments', kind: 'Files', doc: page('fields/attachments.md') },
  { name: 'avatar', kind: 'Files', doc: page('fields/avatar.md') },
];

export const GUIDES = [
  {
    name: 'Agent access (MCP)',
    audience: 'Agent',
    order: 4,
    doc: page('guides/agent-access-mcp.md'),
  },
  {
    name: 'Document formatting',
    audience: 'Both',
    order: 8,
    doc: page('guides/document-formatting.md'),
  },
  {
    name: 'Making a workspace your own',
    audience: 'Both',
    order: 9,
    doc: page('guides/making-a-workspace-your-own.md'),
  },
  {
    name: 'Automations',
    audience: 'Both',
    order: 9.5,
    doc: page('guides/automations.md'),
  },
  {
    name: 'Polymorphic relations',
    audience: 'Both',
    order: 10,
    doc: page('guides/polymorphic-relations.md'),
  },
  {
    name: 'Workspace registry',
    audience: 'Both',
    order: 11,
    doc: page('guides/workspace-registry.md'),
  },
  {
    name: "Self-host weave: choose your door",
    audience: 'Human',
    order: 13,
    doc: page('guides/self-host-weave-choose-your-door.md'),
  },
  {
    name: "Door A: an edge gate",
    audience: 'Human',
    order: 14,
    doc: page('guides/door-a-an-edge-gate.md'),
  },
  {
    name: "Door C: sign in with a provider",
    audience: 'Human',
    order: 15.5,
    doc: page('guides/door-c-sign-in-with-a-provider.md'),
  },
  {
    name: "Deploy: Railway",
    audience: 'Human',
    order: 16,
    doc: page('guides/deploy-railway.md'),
  },
  {
    name: "Deploy: Fly.io, Render, a VPS, Docker",
    audience: 'Human',
    order: 17,
    doc: page('guides/deploy-fly-io-render-a-vps-docker.md'),
  },
  {
    name: "Backup and restore",
    audience: 'Human',
    order: 18,
    doc: page('guides/backup-and-restore.md'),
  },
  {
    name: "Backup to weave cloud",
    audience: 'Human',
    order: 18.5,
    doc: page('guides/backup-to-weave-cloud.md'),
  },
  {
    name: "Environment reference",
    audience: 'Human',
    order: 19,
    doc: page('guides/environment-reference.md'),
  },
  {
    name: 'Reporting a bug',
    audience: 'Both',
    order: 12,
    doc: page('guides/reporting-a-bug.md'),
  },
  {
    name: 'Forms',
    audience: 'Both',
    order: 12.5,
    doc: page('guides/forms.md'),
  },
  {
    name: 'Table views',
    audience: 'Both',
    order: 20,
    doc: page('guides/table-views.md'),
  },
  {
    name: 'How text behaves',
    audience: 'Both',
    order: 20.75,
    doc: page('guides/how-text-behaves.md'),
  },
  {
    name: 'Chip and card anatomy',
    audience: 'Both',
    order: 21,
    doc: page('guides/chip-and-card-anatomy.md'),
  },
  {
    name: 'Templates',
    audience: 'Both',
    order: 20.5,
    doc: page('guides/templates.md'),
  },
];

export const FORMATTING_SAMPLES = [
  { name: 'Headings and folds', construct: 'Structure', syntax: '`#` … `######`', doc: page('samples/headings-and-folds.md') },

  { name: 'Lists and task lists', construct: 'Block', syntax: '`-` · `1.` · `- [ ]`', doc: page('samples/lists-and-task-lists.md') },

  { name: 'Quote, divider, line break', construct: 'Block', syntax: '`>` · `***` · trailing `\\`', doc: page('samples/quote-divider-line-break.md') },

  { name: 'Emphasis and inline code', construct: 'Format', syntax: '`**…**` · `*…*` · `~~…~~`', doc: page('samples/emphasis-and-inline-code.md') },

  { name: 'Tables', construct: 'Table', syntax: '`| a | b |`', doc: page('samples/tables.md') },

  { name: 'Code, unlabelled', construct: 'Code', syntax: 'a bare fence', doc: page('samples/code-unlabelled.md') },

  { name: 'Code, labelled', construct: 'Code', syntax: 'fence + language', doc: page('samples/code-labelled.md') },

  { name: 'Mermaid diagrams', construct: 'Diagram', syntax: 'fence + `mermaid`', doc: page('samples/mermaid-diagrams.md') },

  { name: 'Math and chemistry', construct: 'Math', syntax: '`$…$` · `$$…$$`', doc: page('samples/math-and-chemistry.md') },

  { name: 'Inline icons', construct: 'Format', syntax: '`:name:`', doc: page('samples/inline-icons.md') },
  { name: 'Links to entities, tables and spaces', construct: 'Reference', syntax: '`[[…]]`', doc: page('samples/links-to-entities-tables-and-spaces.md') },

  { name: 'Raw HTML', construct: 'Block', syntax: '`<div>`', doc: page('samples/raw-html.md') },

  { name: 'One page using all of it', construct: 'Structure', syntax: '—', doc: page('samples/one-page-using-all-of-it.md') },
];

const ensureSpace = (w, name, description) =>
  w.listSpaces().find((s) => s.name === name) ?? w.createSpace({ name, description });

function ensureTable(w, space, name, { description = '', icon = '', noun = '' } = {}) {
  const existing = w.findTable(`${space}/${name}`);
  if (existing) {
    const patch = {};
    if (description && !existing.description) patch.description = description;
    if (icon && !existing.icon) patch.icon = icon;
    if (noun && !w.termOf(existing).set) patch.noun = noun;
    if (Object.keys(patch).length) w.updateTable(existing.id, patch);
    return existing;
  }
  const db = w.createTable({ space, name, description, icon });
  if (noun) w.updateTable(db.id, { noun });
  return db;
}

const ensureField = (w, db, spec) => w.findField(db, spec.name) ?? w.addField(db, spec);

function ensureOptions(w, db, fieldName, names) {
  const field = w.findField(db, fieldName);
  if (!field) return;
  const have = field.config.options ?? [];
  const missing = names.filter((n) => !have.some((o) => o.name === n));
  if (!missing.length) return;
  w.updateField(db.id, field.id, {
    config: { ...field.config, options: [...have.map((o) => ({ ...o })), ...missing.map((name) => ({ name, color: '' }))] },
  });
}

function upsertRow(w, db, { name, values, doc }) {
  const existing = w.findEntity(db, name);
  if (!existing) return w.createEntity(db, { name, values, doc });
  if (values && Object.keys(values).length) w.updateEntity(existing.id, values);
  if (doc != null) w.setDoc(existing.id, doc);
  return existing;
}
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const guidePages = () => GUIDES.map((g) => ({ name: g.name, values: { Audience: g.audience, Order: g.order }, doc: g.doc }));
const fieldPages = () => FIELD_DOCS.map((f) => ({ name: f.name, values: { Kind: f.kind }, doc: f.doc }));
const HANDBOOK_PAGES = () => [['Handbook/Guide', guidePages()], ['Handbook/Fields', fieldPages()]];

export function applyHandbook(w) {
  ensureSpace(w, 'Handbook', 'Official documentation and how-tos');

  const guides = ensureTable(w, 'Handbook', 'Guide', {
    description: 'The prose no field page can carry — how to install it, how the model works, how a document is written, and what a workspace can be made to look like.',
    icon: 'lucide:file-text',
    noun: 'guide',
  });
  ensureField(w, guides, { name: 'Audience', type: 'select', config: { options: ['Human', 'Agent', 'Both'] } });
  ensureField(w, guides, { name: 'Order', type: 'number' });
  const previousRegistryGuide = w.findEntity(guides, 'Registry at the root');
  if (previousRegistryGuide && !w.findEntity(guides, 'Workspace registry')) w.updateEntity(previousRegistryGuide.id, { Name: 'Workspace registry' });
  for (const page of guidePages()) upsertRow(w, guides, page);

  const fields = ensureTable(w, 'Handbook', 'Fields', {
    description: 'One page per field type: what it stores, what it can be configured into, and what bites.',
    icon: 'lucide:layout-grid',
    noun: 'field type',
  });
  ensureField(w, fields, { name: 'Kind', type: 'select', config: { options: FIELD_KINDS.map((name) => ({ name, color: '' })) } });
  ensureOptions(w, fields, 'Kind', FIELD_KINDS);
  for (const page of fieldPages()) upsertRow(w, fields, page);

  w.save();
  return w;
}

export function handbookHash() {
  return createHash('sha256').update(JSON.stringify(HANDBOOK_PAGES())).digest('hex').slice(0, 16);
}

export function handbookDrift(w) {
  const missing = [], stale = [];
  for (const [qualified, pages] of HANDBOOK_PAGES()) {
    const db = w.findTable(qualified);
    for (const page of pages) {
      const row = db && w.findEntity(db, page.name);
      if (!row) { missing.push(`${qualified}: ${page.name}`); continue; }
      const read = w.readEntity(row.id);
      const differs = read.doc !== page.doc || Object.entries(page.values).some(([k, v]) => !sameValue(read.fields[k], v));
      if (differs) stale.push(`${qualified}: ${page.name}`);
    }
  }
  return { missing, stale };
}

export function syncHandbook(w, { force = false } = {}) {
  const hash = handbookHash();
  if (!force && w.state.meta.handbookSync === hash) return { applied: false, hash };
  const { missing, stale } = handbookDrift(w);
  const actor = w.actor;
  w.actor = 'handbook-sync';
  try {
    applyHandbook(w);
  } finally {
    w.actor = actor;
  }
  w.state.meta.handbookSync = hash;
  w.save();
  return { applied: true, created: missing.length, updated: stale.length, hash };
}

export const FORMATTING_PAGE = 'Every construct on one page';

function formattingPage() {
  const reference = [
    '| Section | Construct | Syntax |',
    '| --- | --- | --- |',
    ...FORMATTING_SAMPLES.map((s) => `| ${s.name} | ${s.construct} | ${s.syntax} |`),
  ].join('\n');
  return [
    '# Every construct a document can hold',
    '',
    'Each section below is written in the construct it names, so the page is its own proof. Read it in one scroll; fold a heading to skip what you already know.',
    '',
    reference,
    ...FORMATTING_SAMPLES.map((s) => `\n---\n\n${s.doc}`),
  ].join('\n');
}

await import('../public/icon-registry.js');
await import('../public/field-dialog-core.js');
const ICON_REGISTRY = globalThis.weaveIconRegistry;
export const ICON_LIBRARY_PAGE = 'Icon library';
export function iconLibraryPage() {
  const R = ICON_REGISTRY;
  const moving = R.NAMES.filter((n) => R.MOTION[n] > 0);
  const runs = moving.map((n) => R.MOTION[n]);
  const core = globalThis.fieldDialogCore;
  const groups = core.ICON_CATEGORIES.filter((g) => g.flat.length || g.marks.length);
  const twins = Object.entries(R.MARK_TWINS).map(([ch, n]) => `| \`${ch}\` | \`lucide:${n}\` | :${n}: | ${R.MOTION[n] ? `${R.MOTION[n]} ms` : 'still'} |`);
  const gallery = groups.flatMap((g) => [
    '', `### ${g.name} · ${g.marks.length + g.flat.length}`, '', '| Icon | Value | Run |', '| --- | --- | --- |',
    ...g.marks.map((m) => `| :${R.MARK_TWINS[m] ?? R.MARK_ALIASES[m] ?? m}: | \`${m}\` | ${R.MARK_TWINS[m] && R.MOTION[R.MARK_TWINS[m]] ? `${R.MOTION[R.MARK_TWINS[m]]} ms` : 'still'} |`),
    ...g.flat.map((n) => `| :${n}: | \`lucide:${n}\` | ${R.MOTION[n] ? `${R.MOTION[n]} ms` : 'still'} |`),
  ]);
  const sample = ['activity', 'bell', 'bookmark', 'bug', 'calendar', 'chart-bar', 'compass', 'file-text', 'folder', 'funnel', 'heart', 'house', 'layout-grid', 'lock', 'mail', 'map-pin', 'pencil', 'search', 'settings', 'shield-check', 'star', 'trash-2', 'users', 'wallet'];
  const INV = core.ICON_INVENTORY.length;
  return [
    '# Icon library',
    '',
    `Weave's inventory is ${INV} names: **Lucide** shapes on one 24-grid at stroke 2, chosen for what a space, a table, an option or a state tends to be called, carrying the motion **movingicons.dev** (github.com/jis3r/icons, MIT) draws for ${moving.length} of them. The libraries are larger (Lucide draws 1,800 shapes, movingicons.dev moves 555); the inventory is what the picker offers, and this page shows all of it. Weave switched from Iconly flat on 2026-09-02; nothing stored had to move.`,
    '',
    '## Writing a value',
    '',
    `- \`lucide:<name>\` on a space, a table, a select option or a workflow state — \`${sample.join(' ')}\` among the names; \`weave vocabulary icons\` lists them all.`,
    '- An emoji is not an icon: the engine refuses any value outside the inventory. A legacy `iconly:` name still resolves; a mark keeps its character.',
    '- In a document, `:name:` draws the icon inline — :bell: `:bell:`, :bug: `:bug:`, :shield-check: `:shield-check:` — in a sentence or a table cell, where an emoji shortcode would go. A mark goes by its twin or its ring alias: :check: `:check:`, :ring-quarter: `:ring-quarter:`.',
    `- A value stored before 2026-09-02 as \`iconly:<name>\` keeps drawing: ${Object.keys(R.ALIASES).length} legacy names resolve to a Lucide twin (\`iconly:notification\` → \`lucide:bell\`, \`iconly:bug\` → \`lucide:bug\`) and the picker rings the twin. A reference that resolves to nothing draws a ghost ring with the name in its tooltip — the prefix never reaches the screen.`,
    `- A retired Lucide name keeps drawing as its replacement: ${Object.entries(R.RETIRED).map(([k, v]) => `\`${k}\` draws as \`lucide:${v}\``).join(', ')} (Issue #948). The picker no longer offers it.`,
    '',
    '## Motion',
    '',
    `An icon plays **once per hover** and once per press — its own trigger, nothing else's. Nothing plays when a page loads or a picker opens (the first cut's load wave fired every icon on screen at once on refresh or login; Kyle ruled it out 2026-09-05, Issue #192). Nothing loops: a run lasts ${Math.min(...runs)}–${Math.max(...runs)} ms, \`infinite\` is rewritten to a single run when the set is built, and \`prefers-reduced-motion\` stills every icon. ${R.NAMES.length - moving.length} names draw still: the ones movingicons.dev animates by script rather than CSS, and the Lucide shapes the legacy aliases needed.`,
    '![Hover: one run per icon, then rest](/showcase/icons/hover.gif)',
    '',
    '',
    '## Marks',
    '',
    `A workflow state or select option keeps its **character** (\`✓\`, \`◔\`) as its value; the chrome's own marks (\`⟳\`, \`⧉\`, \`‹\`) are the same kind of thing. ${Object.keys(R.MARK_TWINS).length} of them draw as Lucide twins:`,
    '',
    '| Mark | Draws as | Drawn | Run |',
    '| --- | --- | --- | --- |',
    ...twins,
    '',
    'The six progress rings `○ ◔ ◐ ◑ ◕ ●` — :ring-empty: :ring-quarter: :ring-half-left: :ring-half: :ring-three-quarters: :ring-full: in a document — have no Lucide shape and stay hand-drawn in `public/mark-icons.js`, re-inked from a 2.5 ring to 2.0 so they sit level with the strokes beside them.',
    '',
    '## The picker',
    '',
    `Eleven groups — ${groups.map((g) => g.name).join(', ')} — hold the whole inventory: the vocabulary weave already had, the review's recommendations (key, terminal, kanban, list-checks, timer, sparkles, lightbulb, rocket, paperclip, archive, copy, clipboard, refresh-cw, undo, redo, history, chart-column, blocks, bell-ring, message-square, user-cog, route, battery, wifi, radio, cloud-upload, cloud-download, cpu, gauge, award), and the twins a legacy value resolves to. Marks lead their group; a name typed by hand that no group claims files under other.`,
    '',
    'Search matches a name or a category, so typing `money` keeps the whole group. A name is never printed beside its icon in the grid: the search bar names the one cell the pointer or the keyboard is on, and rests on the icon already set, so reopening the picker says what the current one is called. The name is the tooltip too.',
    '',
    '## Pictures',
    '',
    '![The picker after the switch: the Issue table, the status group leading, the current icon ringed](/showcase/icons/picker-after.png)',
    '',
    '![The picker before the switch, same table: Iconly flat, filled glyphs at uneven optical sizes](/showcase/icons/picker-before.png)',
    '',
    '![Fourteen icons at 24px inside their grid — Iconly (top) fills the box unevenly and needed a hand scale table; Lucide (bottom) sits on one grid at one stroke](/showcase/icons/optical-box.png)',
    '',
    '## The inventory',
    '',
    `All ${INV}, drawn beside their values with the \`:name:\` form, in the picker's own groups:`,
    ...gallery,
    '',
    '## Rebuilding the set',
    '',
    '```bash',
    'node scripts/build-lucide-moving.mjs --moving <jis3r/icons checkout> --lucide <lucide-icons/lucide checkout>',
    '```',
    '',
    'writes `public/vendor/lucide-moving.js` (one inline svg per name), `public/vendor/lucide-moving.css` (the keyframes, scoped per icon under `.mi-<name>`) and `public/icon-registry.js` (names, categories, motion lengths, legacy aliases, mark twins). `test/icon-registry.test.mjs` gates the three: every name draws, every legacy name resolves, every twin exists, nothing loops.',
  ].join('\n');
}
export function applyIconShowcase(w) {
  ensureSpace(w, 'Showcase', 'Every field type, in several configurations — the range of what a field can be, visible in one grid');
  const t = ensureTable(w, 'Showcase', 'Icons', {
    description: 'The icon vocabulary: where the shapes come from, how a value is written, what moves and what stays still.',
    icon: 'lucide:sparkles',
    noun: 'page',
  });
  upsertRow(w, t, { name: ICON_LIBRARY_PAGE, doc: iconLibraryPage() });
  w.save();
  return t;
}

export function applyFormattingShowcase(w) {
  ensureSpace(w, 'Showcase', 'Every field type, in several configurations — the range of what a field can be, visible in one grid');

  const t = ensureTable(w, 'Showcase', 'Formatting', {
    description: 'Every construct a document can hold, each row written in the construct it names.',
    icon: 'lucide:file',
    noun: 'construct',
  });
  ensureField(w, t, {
    name: 'Construct',
    type: 'select',
    config: { options: ['Structure', 'Block', 'Format', 'Table', 'Code', 'Diagram', 'Math', 'Reference'].map((name) => ({ name, color: '' })) },
  });
  ensureField(w, t, { name: 'Syntax', type: 'text' });

  upsertRow(w, t, { name: FORMATTING_PAGE, values: {}, doc: formattingPage() });
  for (const row of w.query('Showcase/Formatting', { limit: 200 }).items) {
    if (row.name !== FORMATTING_PAGE) w.deleteEntity(row.id);
  }

  w.save();
  return w;
}
