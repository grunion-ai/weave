import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scanSuites, syncQualityMirror } from './quality-mirror.js';
import { SYMPTOM_FIELD, SYMPTOM_OPTIONS } from './bugreport.js';

import { DEFINABLE_TYPES } from './engine.js';
import { applyHandbook, applyFormattingShowcase, applyIconShowcase } from './handbook.js';
export { DEFINABLE_TYPES };

export function seedFieldShowcase(w) {
  if (!w.listSpaces().some((sp) => sp.name === 'Showcase')) seedShowcaseBase(w);
  syncShowcase(w);
  return w;
}

function seedShowcaseBase(w) {
  w.createSpace({ name: 'Showcase', icon: 'lucide:compass', description: 'Every field type, in several configurations — the range of what a field can be, visible in one grid' });

  const people = w.createTable({ space: 'Showcase', name: 'People', noun: 'person', icon: 'lucide:users' });
  w.addField(people, { name: 'Email', type: 'email' });
  w.addField(people, { name: 'Age', type: 'number' });

  const ft = w.createTable({ space: 'Showcase', name: 'Field Types', noun: 'example', icon: 'lucide:settings' });
  w.addField(ft, { name: 'Notes', type: 'text', config: { default: 'n/a' } });
  w.addField(ft, { name: 'Site', type: 'url' });
  w.addField(ft, { name: 'Contact', type: 'email' });
  w.addField(ft, { name: 'Count', type: 'number' });
  w.addField(ft, { name: 'Price', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  w.addField(ft, { name: 'Share', type: 'number', config: { format: 'percent', decimals: 1 } });
  w.addField(ft, { name: 'Weight', type: 'number', config: { unit: 'kg', decimals: 0 } });
  w.addField(ft, { name: 'Due', type: 'date' });
  w.addField(ft, { name: 'Start', type: 'date', config: { format: 'us' } });
  w.addField(ft, { name: 'Published', type: 'date', config: { format: 'long', time: true } });
  w.addField(ft, { name: 'Window', type: 'daterange' });
  w.addField(ft, { name: 'Done', type: 'checkbox', config: { default: false } });
  w.addField(ft, { name: 'Feed', type: 'toggle', config: { on: 'Live', off: 'Paused', default: false } });
  w.addField(ft, { name: 'Priority', type: 'select', config: { options: [
    { name: 'Low', color: '#2ea043' }, { name: 'Medium', color: '#f59f00' }, { name: 'High', color: '#e5484d' }] } });
  w.addField(ft, { name: 'Category', type: 'select', config: { options: ['Hardware', 'Software', 'Service'] } });
  w.addField(ft, { name: 'Tags', type: 'multiselect', config: { options: [
    { name: 'alpha', color: '#4769eb' }, { name: 'beta', color: '#8e4ec6' }, { name: 'stable', color: '#2ea043' }, { name: 'legacy', color: '' }] } });
  w.addField(ft, { name: 'Stage', type: 'workflow', config: { states: [
    { name: 'Backlog', category: 'not-started', default: true },
    { name: 'Building', category: 'in-progress' },
    { name: 'Shipped', category: 'done' },
    { name: 'Dropped', category: 'canceled' }] } });
  w.addField(ft, { name: 'Review', type: 'workflow', config: { states: [
    { name: 'Pending', category: 'not-started', default: true },
    { name: 'Approved', category: 'done' }] } });
  w.addField(ft, { name: 'Brief', type: 'document' });
  w.addField(ft, { name: 'Definition', type: 'field' });
  w.addField(ft, { name: 'Nested definition', type: 'field', config: { depth: 2 } });
  w.addField(ft, { name: 'API key', type: 'key' });
  w.addField(ft, { name: 'Files', type: 'attachments' });
  w.addRelation(ft, { name: 'Owner', targetDb: people, cardinality: 'many-to-one', inverseName: 'Owns' });
  w.addRelation(ft, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: 'Peer of' });
  w.addField(ft, { name: 'Owner email', type: 'lookup', config: { relationField: 'Owner', targetField: 'Email' } });
  w.addField(ft, { name: 'Peer count', type: 'rollup', config: { relationField: 'Peers', aggregate: 'count' } });
  w.addField(ft, { name: 'Peer age', type: 'rollup', config: { relationField: 'Peers', aggregate: 'avg', targetField: 'Age' } });
  w.addField(ft, { name: 'Peer names', type: 'rollup', config: { relationField: 'Peers', aggregate: 'join', targetField: 'Name' } });
  w.addField(ft, { name: 'Total', type: 'formula', config: { expression: 'Price * Count' } });
  w.addField(ft, { name: 'Label', type: 'formula', config: { expression: 'concat(upper(Category), " · ", Priority)' } });
  w.addField(ft, { name: 'Days left', type: 'formula', config: { expression: 'if(empty(Due), "", days(today(), Due))' } });

  const ada = w.createEntity(people, { name: 'Ada Chen', values: { Email: 'ada@example.com', Age: 34 } });
  const leo = w.createEntity(people, { name: 'Leo Marsh', values: { Email: 'leo@example.com', Age: 41 } });
  const mia = w.createEntity(people, { name: 'Mia Okafor', values: { Email: 'mia@example.com', Age: 29 } });
  const rows = [
    { name: 'Sensor board', values: {
      Notes: 'Rev C, lead-free', Site: 'https://example.com/sensor', Contact: 'sales@example.com',
      Count: 12, Price: 149.5, Share: 0.325, Weight: 2,
      Due: '2026-09-15', Start: '2026-08-01', Published: '2026-08-20T14:30:00Z', Window: { start: '2026-08-01', end: '2026-09-15' },
      Done: false, Feed: true, Priority: 'High', Category: 'Hardware', Tags: ['alpha', 'stable'],
      Definition: { type: 'number', config: { format: 'currency', unit: 'EUR', decimals: 2 } },
      'Nested definition': { type: 'field', config: { depth: 1 } },
      'API key': 'vendor-portal', Owner: ada.id, Peers: [leo.id, mia.id],
    }, stage: 'Building', review: 'Approved' },
    { name: 'Sync service', values: {
      Notes: 'Runs hourly', Site: 'https://example.com/sync', Contact: 'ops@example.com',
      Count: 3, Price: 1200, Share: 0.5, Weight: 0,
      Due: '2026-08-10', Start: '2026-07-12', Published: '2026-07-30T09:00:00Z', Window: { start: '2026-07-12', end: '2026-08-10' },
      Done: true, Priority: 'Medium', Category: 'Software', Tags: ['beta'],
      Definition: { type: 'select', config: { options: ['on', 'off'] } },
      Owner: leo.id, Peers: [ada.id],
    }, stage: 'Shipped', review: 'Approved' },
    { name: 'Onboarding call', values: {
      Count: 1, Price: 0, Share: 0, Weight: 0,
      Due: '2026-10-01', Priority: 'Low', Category: 'Service', Tags: ['legacy'],
      Definition: { type: 'checkbox', config: {} },
      Owner: mia.id, Peers: [ada.id, leo.id, mia.id],
    }, stage: 'Backlog', review: 'Pending' },
    { name: 'Blank row', values: {} , stage: 'Dropped', review: 'Pending' },
  ];
  for (const r of rows) {
    const e = w.createEntity(ft, { name: r.name, values: r.values });
    w.setState(e.id, 'Stage', r.stage);
    w.setState(e.id, 'Review', r.review);
  }
  w.save();
  return w;
}

const SPARK_KEYS = '[Peer joined]';
export const SHOWCASE_ADDITIONS = [
  { table: 'People', fields: [
    { after: 'Age', name: 'Skill', type: 'rating', config: { max: 5, icon: 'lucide:star' } },
    { after: 'Skill', name: 'Joined', type: 'date' },
    { after: 'Joined', name: 'Delta', type: 'number' },
  ], rows: {
    'Ada Chen': { Skill: 5, Joined: '2024-03-04', Delta: 4 },
    'Leo Marsh': { Skill: 2, Joined: '2023-06-12', Delta: -3 },
    'Mia Okafor': { Skill: 4, Joined: '2025-01-20', Delta: 2 },
  } },
  { table: 'Field Types', fields: [
    { after: 'Weight', name: 'Progress', type: 'number', config: { display: 'bar' } },
    { after: 'Progress', name: 'Score', type: 'number', config: { decimals: 1, display: 'bar', scale: 10 } },
    { after: 'Score', name: 'Completion', type: 'number', config: { format: 'percent', decimals: 0, display: 'ring', scale: 1 } },
    { after: 'Completion', name: 'Load', type: 'number', config: { display: 'heat' } },
    { after: 'Load', name: 'Momentum', type: 'number', config: { display: 'bar', color: 'icon' } },
    { after: 'Momentum', name: 'Reach', type: 'number', config: { format: 'percent', decimals: 0, display: 'ring', scale: 1, color: 'accent' } },
    { after: 'Reach', name: 'Warmth', type: 'number', config: { display: 'heat', color: 'icon' } },
    { after: 'Load', name: 'Fit', type: 'rating', config: { max: 5, icon: 'lucide:star' } },
    { after: 'Fit', name: 'Effort', type: 'rating', config: { max: 3, icon: 'lucide:zap' } },
    { after: 'Effort', name: 'Love', type: 'rating', config: { max: 7, icon: 'lucide:heart' } },
    { after: 'Love', name: 'Brightness', type: 'rating', config: { max: 12, icon: 'lucide:sun', default: 6 } },
    { after: 'Brightness', name: 'Stars', type: 'rating', config: { max: 5, icon: 'lucide:star', color: 'icon' } },
    { after: 'Stars', name: 'Bolts', type: 'rating', config: { max: 10, icon: 'lucide:zap', color: 'icon' } },
    { after: 'Bolts', name: 'Hearts', type: 'rating', config: { max: 5, icon: 'lucide:heart', color: 'accent' } },
    { after: 'Peer names', name: 'Peer skill', type: 'rollup', config: { relationField: 'Peers', aggregate: 'avg', targetField: 'Skill' } },
    { after: 'Peer skill', name: 'Peer ages', type: 'lookup', config: { relationField: 'Peers', targetField: 'Age' } },
    { after: 'Peer ages', name: 'Peer skills', type: 'lookup', config: { relationField: 'Peers', targetField: 'Skill' } },
    { after: 'Peer skills', name: 'Peer deltas', type: 'lookup', config: { relationField: 'Peers', targetField: 'Delta' } },
    { after: 'Peer deltas', name: 'Peer joined', type: 'lookup', config: { relationField: 'Peers', targetField: 'Joined' } },
    { after: 'Days left', name: 'Age trend', type: 'formula', config: { expression: `sortby([Peer ages], ${SPARK_KEYS})`, display: 'sparkline', style: 'line' } },
    { after: 'Age trend', name: 'Delta columns', type: 'formula', config: { expression: `sortby([Peer deltas], ${SPARK_KEYS})`, display: 'sparkline', style: 'column' } },
    { after: 'Delta columns', name: 'Wins and losses', type: 'formula', config: { expression: `sortby([Peer deltas], ${SPARK_KEYS})`, display: 'sparkline', style: 'winloss' } },
    { after: 'Wins and losses', name: 'Skill trend', type: 'formula', config: { expression: `if(empty([Peer skills]), null, sortby([Peer skills], ${SPARK_KEYS}))`, display: 'sparkline', style: 'line' } },
    { after: 'Skill trend', name: 'Age line', type: 'formula', config: { expression: `sortby([Peer ages], ${SPARK_KEYS})`, display: 'sparkline', style: 'line', color: 'accent' } },
    { after: 'Age line', name: 'Delta blocks', type: 'formula', config: { expression: `sortby([Peer deltas], ${SPARK_KEYS})`, display: 'sparkline', style: 'winloss', color: 'icon' } },
  ], rows: {
    'Sensor board': { Progress: 72, Score: 7.5, Completion: 0.8, Load: 9, Momentum: 40, Reach: 0.6, Warmth: 8, Fit: 4, Effort: 2, Love: 6, Brightness: 9, Stars: 4, Bolts: 7, Hearts: 3 },
    'Sync service': { Progress: 100, Score: 9.2, Completion: 1, Load: 3, Momentum: 85, Reach: 0.9, Warmth: 2, Fit: 5, Effort: 1, Love: 7, Brightness: 12, Stars: 5, Bolts: 10, Hearts: 5 },
    'Onboarding call': { Progress: 15, Score: 2, Completion: 0.25, Load: 0, Momentum: 10, Reach: 0.3, Warmth: 5, Effort: 0, Love: 3, Brightness: 4, Stars: 2, Bolts: 3, Hearts: 1 },
  } },
];

export function showcaseHash() {
  return createHash('sha256').update(JSON.stringify(SHOWCASE_ADDITIONS)).digest('hex').slice(0, 16);
}

const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

function applyShowcaseAdditions(w) {
  let added = 0;
  for (const { table, fields, rows } of SHOWCASE_ADDITIONS) {
    const db = w.findTable(`Showcase/${table}`);
    if (!db) continue;
    for (const { after, ...def } of fields) {
      if (w.findField(db, def.name)) continue;
      const f = w.addField(db, def);
      added++;
      const anchor = w.findField(db, after);
      if (!anchor) continue;
      const order = db.fieldOrder.filter((id) => id !== f.id);
      order.splice(order.indexOf(anchor.id) + 1, 0, f.id);
      w.updateTable(db.id, { fieldOrder: order });
      for (const v of db.tableViews ?? []) {
        if (v.fields.includes(anchor.id)) w.tableView(`Showcase/${table}/${v.id}`, { move: { field: f.name, after: anchor.name } });
      }
    }
    for (const [name, values] of Object.entries(rows)) {
      const row = w.findEntity(db, name);
      if (!row) continue;
      const patch = {};
      for (const [k, v] of Object.entries(values)) {
        const f = w.findField(db, k);
        if (f && isBlank(row.values[f.id])) patch[k] = v;
      }
      if (Object.keys(patch).length) w.updateEntity(row.id, patch);
    }
  }
  return added;
}

export function syncShowcase(w, { force = false } = {}) {
  if (!w.listSpaces().some((sp) => sp.name === 'Showcase')) return { applied: false };
  const hash = showcaseHash();
  if (!force && w.state.meta.showcaseSync === hash) return { applied: false, hash };
  const actor = w.actor;
  w.actor = 'showcase-sync';
  let added;
  try {
    added = applyShowcaseAdditions(w);
  } finally {
    w.actor = actor;
  }
  w.state.meta.showcaseSync = hash;
  w.save();
  return { applied: true, added, hash };
}

export function seedWeaver(w) {
  w.state.meta.name = 'weave';

  w.createSpace({ name: 'Handbook', icon: 'lucide:file-text', description: 'Official documentation and how-tos' });
  const guides = w.createTable({ space: 'Handbook', name: 'Guide', icon: 'lucide:file-text' });
  w.addField(guides, { name: 'Audience', type: 'select', config: { options: ['Human', 'Agent', 'Both'] } });
  w.addField(guides, { name: 'Order', type: 'number' });

  w.createEntity(guides, {
    name: 'Quickstart', values: { Audience: 'Both', Order: 1 },
    doc: `# Quickstart

\`\`\`bash
node bin/weave.js serve --port 4400 --data ./uno.json
\`\`\`

Open http://127.0.0.1:4400 — the sidebar lists spaces and tables. Press **⌘K** to search everything with permalinks.

Workspaces live side by side: this docs workspace is at \`/w/weaver/\`, your data workspace at \`/\`. Use the switcher in the sidebar.`,
  });
  w.createEntity(guides, {
    name: 'Data model', values: { Audience: 'Both', Order: 2 },
    doc: `# Data model

Spaces group **tables**; tables hold **entities** with auto public ids (\`Task#3\`).

Field types: text, number, date, daterange, checkbox, toggle (a switch with two named states), url, email, select, multiselect, **workflow** (multistate with categories), **relation** (always a bidirectional pair), **lookup**, **rollup** (count/sum/avg/min/max/join), **formula**, and **document** (markdown, several per table).

Every entity's document fields render natively as MD, HTML, and PDF at \`/e/<id>/doc/<Field>.<fmt>\`.`,
  });
  w.createEntity(guides, {
    name: 'CLI reference', values: { Audience: 'Both', Order: 3 },
    doc: `# CLI reference

\`\`\`bash
weave schema
weave query Task --where '[["Project.Name","=","Apollo"]]' --select 'Estimate'
weave create Task "Fix bug" --values '{"Priority":"P1"}'
weave state Task#5 State "In Progress"
weave doc set Task#5 --field Spec --content '# Spec'
weave doc export Task#5 --format pdf --out t5.pdf
\`\`\`

Entities are addressable as \`Table#publicId\`, UUID, or name with \`--table\`.`,
  });
  w.createEntity(guides, {
    name: 'Agent access (MCP)', values: { Audience: 'Agent', Order: 4 },
    doc: `# Agent access

\`weave mcp\` starts a Model Context Protocol stdio server with 21+ tools: schema introspection, query with relation traversal, entity CRUD, workflow transitions, linking, per-field documents, comments, universal search with permalinks, CSV import/export, files, automations.

The REST API mirrors everything under \`/api\` (workspace-scoped under \`/w/<name>/api\`).`,
  });

  w.createSpace({ name: 'Wiki', icon: 'lucide:bookmark', description: 'Design notes and architecture' });
  const articles = w.createTable({ space: 'Wiki', name: 'Article', icon: 'lucide:bookmark' });
  w.addField(articles, { name: 'Topic', type: 'select', config: { options: ['Architecture', 'Philosophy', 'Internals'] } });
  w.createEntity(articles, {
    name: 'Zero-dependency philosophy', values: { Topic: 'Philosophy' },
    doc: `# Zero dependencies

Weave has no runtime dependencies. The markdown renderer, PDF writer, CSV parser, HTTP router, and MCP server are all in-tree and tested. The whole codebase is readable in an afternoon; state is one human-readable JSON file per workspace with atomic writes.`,
  });
  w.createEntity(articles, {
    name: 'The PDF writer', values: { Topic: 'Internals' },
    doc: `# The PDF writer

\`src/pdf.js\` emits PDF 1.4 directly: standard fonts (no embedding), real Helvetica AFM metrics for wrapping, WinAnsi typography (curly quotes, bullets, dashes), US Letter pages, and a byte-exact xref table (verified by tests).`,
  });
  w.createEntity(articles, {
    name: 'Workspace hierarchy', values: { Topic: 'Architecture' },
    doc: `# Hierarchy

Workspace → spaces → tables → entities. Multiple workspaces share one web app (\`/w/<name>/\`). The direction of travel: spaces and the workspace itself become tables too, so schema, settings, users, and automations are all agent-editable through the same primitives.`,
  });

  w.createSpace({ name: 'Quality', icon: 'lucide:shield-check', description: 'The Weave test suite, dogfooded' });
  const suites = w.createTable({ space: 'Quality', name: 'Suite', icon: 'lucide:shield-check' });
  const cases = w.createTable({ space: 'Quality', name: 'Case', icon: 'lucide:square-check' });
  w.addField(cases, {
    name: 'Status', type: 'workflow', config: {
      states: [
        { name: 'Failing', category: 'not-started' },
        { name: 'Flaky', category: 'in-progress' },
        { name: 'Passing', category: 'done', default: true },
      ],
    },
  });
  w.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  w.addField(suites, { name: 'Case Count', type: 'rollup', config: { relationField: 'Cases', aggregate: 'count' } });
  w.addField(suites, { name: 'File', type: 'text' });

  syncQualityMirror(w, scanSuites(join(dirname(fileURLToPath(import.meta.url)), '..')));

  w.createSpace({ name: 'Development', icon: 'lucide:activity', description: 'Open issues and the roadmap, maintained as Weave is built' });
  const issues = w.createTable({ space: 'Development', name: 'Issue', icon: 'lucide:bug' });
  w.addField(issues, {
    name: 'Status', type: 'workflow', config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'In Progress', category: 'in-progress' },
        { name: 'Fixed', category: 'done' },
      ],
    },
  });
  w.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  w.addField(issues, { name: SYMPTOM_FIELD, type: 'multiselect', config: { options: SYMPTOM_OPTIONS } });

  const features = w.createTable({ space: 'Development', name: 'Feature', icon: 'lucide:star' });
  w.addField(features, {
    name: 'Status', type: 'workflow', config: {
      states: [
        { name: 'Planned', category: 'not-started', default: true },
        { name: 'Building', category: 'in-progress' },
        { name: 'Shipped', category: 'done' },
      ],
    },
  });
  w.addField(features, { name: 'Milestone', type: 'select', config: { options: ['v0.1', 'v0.2', 'v0.3'] } });

  const shipped = [
    ['Core engine: tables, relations, workflows, lookups, rollups, formulas', 'v0.1'],
    ['Per-entity documents as native MD / HTML / PDF', 'v0.1'],
    ['Web UI: table, board, list + entity pages', 'v0.1'],
    ['CLI + MCP server + REST API', 'v0.1'],
    ['Automations incl. outgoing webhooks; CSV import/export; file attachments', 'v0.1'],
    ['Rename: databases → tables', 'v0.2'],
    ['Multiple document fields per entity', 'v0.2'],
    ['Inline editing of all fields + docs in every view', 'v0.2'],
    ['Relation map visualizing relations and automations', 'v0.2'],
    ['Universal ⌘K search with permalinks', 'v0.2'],
    ['Multi-workspace: uno + weaver with switcher', 'v0.2'],
  ];
  for (const [name, ms] of shipped) {
    const e = w.createEntity(features, { name, values: { Milestone: ms } });
    w.setState(e.id, 'Status', 'Shipped');
  }
  const planned = [
    ['Hierarchical meta-model: spaces & workspace as tables (agent-native)', 'v0.3'],
    ['Auto-composed bidirectional schema docs (edit schema as JSON/YAML)', 'v0.3'],
    ['Workspace-level audit log + agent user accounts & permissions', 'v0.3'],
    ['Permalink-based [[...]] entity links in markdown', 'v0.3'],
    ['Attachments field type', 'v0.3'],
    ['Saved multi-table views with public share links', 'v0.3'],
    ['UI design system adoption (decision pending)', 'v0.3'],
  ];
  for (const [name, ms] of planned) w.createEntity(features, { name, values: { Milestone: ms } });

  const knownIssues = [
    ['Single-writer: CLI and server must not write one workspace file concurrently', 'Medium', 'Open'],
    ['No filter-builder UI (filters are API/CLI/MCP only)', 'Medium', 'Open'],
    ['Board drag-and-drop does not scroll columns horizontally while dragging', 'Low', 'Open'],
    ['PDF renders non-WinAnsi glyphs (e.g. emoji) as "?"', 'Low', 'Open'],
  ];
  for (const [name, sev, st] of knownIssues) {
    const e = w.createEntity(issues, { name, values: { Severity: sev } });
    if (st !== 'Open') w.setState(e.id, 'Status', st);
  }

  ensureReleaseTable(w);

  seedFieldShowcase(w);
  applyHandbook(w);
  applyFormattingShowcase(w);
  applyIconShowcase(w);
  w.save();
  return w;
}

export function ensureReleaseTable(w) {
  const table = (qualified) => w.listTables().find((t) => `${w.getSpace(t.spaceId)?.name}/${t.name}` === qualified);
  const existing = table('Development/Release');
  if (existing) return existing;
  const issues = table('Development/Issue');
  const features = table('Development/Feature');
  if (!issues || !features) return null;
  const rel = w.createTable({ space: 'Development', name: 'Release', icon: 'lucide:rocket' });
  w.addField(rel, { name: 'Date', type: 'date' });
  w.addField(rel, { name: 'Commit', type: 'text' });
  w.addRelation(rel, { name: 'Fixes', targetDb: issues.id, cardinality: 'many-to-many', inverseName: 'Fixed in' });
  w.addRelation(rel, { name: 'Ships', targetDb: features.id, cardinality: 'many-to-many', inverseName: 'Shipped in' });
  return w.getTable(rel.id ?? rel);
}

function widenSelects(w, db, entries, selects) {
  const table = w.getTable(db.id);
  for (const sel of selects) {
    const field = Object.values(table.fields).find((f) => f.name === sel);
    if (!field || (field.type !== 'select' && field.type !== 'multiselect')) continue;
    const options = field.config.options ?? [];
    const known = new Set(options.map((o) => o.name));
    const add = [];
    for (const entry of entries ?? []) {
      for (const v of [entry[sel.toLowerCase()] ?? []].flat()) {
        if (typeof v !== 'string' || known.has(v) || add.includes(v)) continue;
        add.push(v);
      }
    }
    if (add.length) w.updateField(table.id, field.id, { config: { options: [...options, ...add] } });
  }
}

export function syncDevelopment(w, manifest) {
  if (!manifest || !Array.isArray(manifest.issues)) return { applied: false };
  const releases = Array.isArray(manifest.releases) ? manifest.releases : [];
  for (const r of releases) {
    if (!(r.description ?? '').trim()) throw new Error(`release ${r.name} has no notes — every Development/Release row carries its notes`);
  }
  const stamp = `${manifest.version}:${manifest.generatedAt}:${(manifest.issues.length + (manifest.features?.length ?? 0) + releases.length)}`;
  if (w.state.meta.developmentSync === stamp) return { applied: false };
  const table = (qualified) => w.listTables().find((t) => `${w.getSpace(t.spaceId)?.name}/${t.name}` === qualified);
  const issuesT = table('Development/Issue');
  const featuresT = table('Development/Feature');
  if (!issuesT || !featuresT) return { applied: false };
  let created = 0, updated = 0;
  const skipped = [];
  const apply = (db, entries, selects) => {
    widenSelects(w, db, entries, selects);
    const byName = new Map(w.listEntities(db.id).map((e) => [w.entityName(e), e]));
    for (const entry of entries ?? []) {
      const existing = byName.get(entry.name);
      const values = {};
      for (const sel of selects) {
        const v = entry[sel.toLowerCase()];
        if (v != null) values[sel] = v;
      }
      try {
        if (!existing) {
          const e = w.createEntity(db.id, { name: entry.name, values, ...(entry.description ? { doc: entry.description } : {}) });
          if (entry.status) w.setState(e.id, 'Status', entry.status);
          created++;
          continue;
        }
        const read = w.readEntity(existing.id);
        let touched = false;
        if (entry.status && read.fields.Status !== entry.status) { w.setState(existing.id, 'Status', entry.status); touched = true; }
        const patch = {};
        for (const [k, v] of Object.entries(values)) {
          const cur = read.fields[k];
          if (JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null)) patch[k] = v;
        }
        if (Object.keys(patch).length) { w.updateEntity(existing.id, patch); touched = true; }
        if (touched) updated++;
      } catch (err) {
        skipped.push(`${db.name} '${entry.name}': ${err.message}`);
      }
    }
  };
  apply(issuesT, manifest.issues, ['Severity', 'Symptom']);
  apply(featuresT, manifest.features, ['Milestone']);
  if (releases.length) {
    const relT = ensureReleaseTable(w);
    apply(relT, releases, ['Date', 'Commit']);
    const byName = (db) => new Map(w.listEntities(db.id).map((e) => [w.entityName(e), e.id]));
    const issueIds = byName(issuesT), featureIds = byName(featuresT), relIds = byName(relT);
    const reconcile = (id, field, wantIds) => {
      const cur = w.readEntity(id).raw[field] ?? [];
      const stale = cur.filter((x) => !wantIds.includes(x));
      const add = wantIds.filter((x) => !cur.includes(x));
      if (add.length) w.link(id, field, add);
      if (stale.length) w.unlink(id, field, stale);
    };
    for (const r of releases) {
      const id = relIds.get(r.name);
      if (!id) continue;
      reconcile(id, 'Fixes', (r.fixes ?? []).map((n) => issueIds.get(n)).filter(Boolean));
      reconcile(id, 'Ships', (r.ships ?? []).map((n) => featureIds.get(n)).filter(Boolean));
    }
  }
  if (!skipped.length) w.state.meta.developmentSync = stamp;
  w.save();
  return { applied: true, created, updated, skipped };
}
