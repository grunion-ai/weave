import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSuites, syncQualityMirror } from './quality-mirror.js';
import { SYMPTOM_FIELD, SYMPTOM_OPTIONS } from './bugreport.js';
// The "weaver" workspace: Weave's canonical, self-referential documentation,
// how-to, wiki, test-suite mirror, and public issue/roadmap tracker — stored
// in Weave itself (like the.fibery.io), not an off-the-shelf docs engine.

import { DEFINABLE_TYPES } from './engine.js';
import { applyHandbook, applyFormattingShowcase } from './handbook.js';
export { DEFINABLE_TYPES };

/* ---------- Showcase ----------
   One table with every field type, and several configurations of the same
   type beside each other (number as plain / currency / percent / unit;
   date as iso / us / long+time; a colored and a plain select; a full
   lifecycle workflow and a two-state gate; rollups by count / avg / join;
   numeric, text and date formulas; a depth-1 and a nested field
   definition). A People table carries the relations the computed fields
   hang off. Idempotent: skipped when the space already exists, so it can be
   applied to a workspace seeded before it existed. */
export function seedFieldShowcase(w) {
  if (w.listSpaces().some((sp) => sp.name === 'Showcase')) return w;
  w.createSpace({ name: 'Showcase', description: 'Every field type, in several configurations — the range of what a field can be, visible in one grid' });

  const people = w.createTable({ space: 'Showcase', name: 'People', noun: 'person' });
  w.addField(people, { name: 'Email', type: 'email' });
  w.addField(people, { name: 'Age', type: 'number' });

  const ft = w.createTable({ space: 'Showcase', name: 'Field Types', noun: 'example' });
  // --- text family
  w.addField(ft, { name: 'Notes', type: 'text', config: { default: 'n/a' } });
  w.addField(ft, { name: 'Site', type: 'url' });
  w.addField(ft, { name: 'Contact', type: 'email' });
  // --- number: four configurations
  w.addField(ft, { name: 'Count', type: 'number' });
  w.addField(ft, { name: 'Price', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  w.addField(ft, { name: 'Share', type: 'number', config: { format: 'percent', decimals: 1 } });
  w.addField(ft, { name: 'Weight', type: 'number', config: { unit: 'kg', decimals: 0 } });
  // --- dates: three configurations + a range
  w.addField(ft, { name: 'Due', type: 'date' });
  w.addField(ft, { name: 'Start', type: 'date', config: { format: 'us' } });
  w.addField(ft, { name: 'Published', type: 'date', config: { format: 'long', time: true } });
  w.addField(ft, { name: 'Window', type: 'daterange' });
  // --- booleans
  w.addField(ft, { name: 'Done', type: 'checkbox', config: { default: false } });
  // --- choices: colored select, plain select, multiselect
  w.addField(ft, { name: 'Priority', type: 'select', config: { options: [
    { name: 'Low', color: '#2ea043' }, { name: 'Medium', color: '#f59f00' }, { name: 'High', color: '#e5484d' }] } });
  w.addField(ft, { name: 'Category', type: 'select', config: { options: ['Hardware', 'Software', 'Service'] } });
  w.addField(ft, { name: 'Tags', type: 'multiselect', config: { options: [
    { name: 'alpha', color: '#4769eb' }, { name: 'beta', color: '#8e4ec6' }, { name: 'stable', color: '#2ea043' }, { name: 'legacy', color: '' }] } });
  // --- workflows: a lifecycle and a gate
  w.addField(ft, { name: 'Stage', type: 'workflow', config: { states: [
    { name: 'Backlog', category: 'not-started', default: true },
    { name: 'Building', category: 'in-progress' },
    { name: 'Shipped', category: 'done' },
    { name: 'Dropped', category: 'canceled' }] } });
  w.addField(ft, { name: 'Review', type: 'workflow', config: { states: [
    { name: 'Pending', category: 'not-started', default: true },
    { name: 'Approved', category: 'done' }] } });
  // --- documents (a second one beside the built-in Description)
  w.addField(ft, { name: 'Brief', type: 'document' });
  // --- meta: a field whose value is a field definition, flat and nested
  w.addField(ft, { name: 'Definition', type: 'field' });
  w.addField(ft, { name: 'Nested definition', type: 'field', config: { depth: 2 } });
  // --- secrets and files
  w.addField(ft, { name: 'API key', type: 'key' });
  w.addField(ft, { name: 'Files', type: 'attachments' });
  // --- relations: one and many
  w.addRelation(ft, { name: 'Owner', targetDb: people, cardinality: 'many-to-one', inverseName: 'Owns' });
  w.addRelation(ft, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: 'Peer of' });
  // --- computed: lookup, three rollups, three formulas
  w.addField(ft, { name: 'Owner email', type: 'lookup', config: { relationField: 'Owner', targetField: 'Email' } });
  w.addField(ft, { name: 'Peer count', type: 'rollup', config: { relationField: 'Peers', aggregate: 'count' } });
  w.addField(ft, { name: 'Peer age', type: 'rollup', config: { relationField: 'Peers', aggregate: 'avg', targetField: 'Age' } });
  w.addField(ft, { name: 'Peer names', type: 'rollup', config: { relationField: 'Peers', aggregate: 'join', targetField: 'Name' } });
  w.addField(ft, { name: 'Total', type: 'formula', config: { expression: 'Price * Count' } });
  w.addField(ft, { name: 'Label', type: 'formula', config: { expression: 'concat(upper(Category), " · ", Priority)' } });
  w.addField(ft, { name: 'Days left', type: 'formula', config: { expression: 'if(empty(Due), "", days(today(), Due))' } });

  // --- rows
  const ada = w.createEntity(people, { name: 'Ada Chen', values: { Email: 'ada@example.com', Age: 34 } });
  const leo = w.createEntity(people, { name: 'Leo Marsh', values: { Email: 'leo@example.com', Age: 41 } });
  const mia = w.createEntity(people, { name: 'Mia Okafor', values: { Email: 'mia@example.com', Age: 29 } });
  const rows = [
    { name: 'Sensor board', values: {
      Notes: 'Rev C, lead-free', Site: 'https://example.com/sensor', Contact: 'sales@example.com',
      Count: 12, Price: 149.5, Share: 0.325, Weight: 2,
      Due: '2026-09-15', Start: '2026-08-01', Published: '2026-08-20T14:30:00Z', Window: { start: '2026-08-01', end: '2026-09-15' },
      Done: false, Priority: 'High', Category: 'Hardware', Tags: ['alpha', 'stable'],
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

export function seedWeaver(w) {
  w.state.meta.name = 'weave';

  // ---------- Handbook ----------
  w.createSpace({ name: 'Handbook', description: 'Official documentation and how-tos' });
  const guides = w.createTable({ space: 'Handbook', name: 'Guide' });
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

Field types: text, number, date, daterange, checkbox, url, email, select, multiselect, **workflow** (multistate with categories), **relation** (always a bidirectional pair), **lookup**, **rollup** (count/sum/avg/min/max/join), **formula**, and **document** (markdown, several per table).

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

  // ---------- Wiki ----------
  w.createSpace({ name: 'Wiki', description: 'Design notes and architecture' });
  const articles = w.createTable({ space: 'Wiki', name: 'Article' });
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

  // ---------- Quality: the test suite, mirrored as data ----------
  w.createSpace({ name: 'Quality', description: 'The Weave test suite, dogfooded' });
  const suites = w.createTable({ space: 'Quality', name: 'Suite' });
  const cases = w.createTable({ space: 'Quality', name: 'Case' });
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

  /* The mirror is DERIVED, never hand-kept (the old static list here had 9
     suites and invented case names). One scan + one sync, shared with the
     main watcher that keeps the live docs workspace current. In a packaged
     install without a test/ tree the scan is empty and Quality stays a
     schema, which is honest. */
  syncQualityMirror(w, scanSuites(join(dirname(fileURLToPath(import.meta.url)), '..')));

  // ---------- Development: public issues + roadmap ----------
  w.createSpace({ name: 'Development', description: 'Open issues and the roadmap, maintained as Weave is built' });
  const issues = w.createTable({ space: 'Development', name: 'Issue' });
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
  /* What the reporter saw, as a filterable field rather than a sentence
     (Feature #141). The in-app reporter writes these four; several can be
     true of one bug, and a report filed on a note alone leaves it empty. */
  w.addField(issues, { name: SYMPTOM_FIELD, type: 'multiselect', config: { options: SYMPTOM_OPTIONS } });

  const features = w.createTable({ space: 'Development', name: 'Feature' });
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

  seedFieldShowcase(w);
  // The reference half of the Handbook and the document half of the Showcase.
  // Both upsert on name, so they also bring a workspace seeded before they
  // existed up to date — see src/handbook.js.
  applyHandbook(w);
  applyFormattingShowcase(w);
  w.save();
  return w;
}

/* ---------- development sync (2026-08-31) ----------
   Every build ships docs/development.json — the canonical Issue and Feature
   lists exported at release time. On boot the server applies it to the local
   weave docs workspace, so updating weave updates the known/resolved issue
   list and the roadmap without touching anything the local user filed:
   rows are matched by NAME; matched rows get the shipped status (and
   severity / milestone / symptom), unmatched manifest rows are created, and
   local-only rows are left exactly as they are. The manifest's hash on
   meta makes the pass one write per build, not one per boot. */
export function syncDevelopment(w, manifest) {
  if (!manifest || !Array.isArray(manifest.issues)) return { applied: false };
  const stamp = `${manifest.version}:${manifest.generatedAt}:${(manifest.issues.length + (manifest.features?.length ?? 0))}`;
  if (w.state.meta.developmentSync === stamp) return { applied: false };
  const table = (qualified) => w.listTables().find((t) => `${w.getSpace(t.spaceId)?.name}/${t.name}` === qualified);
  const issuesT = table('Development/Issue');
  const featuresT = table('Development/Feature');
  if (!issuesT || !featuresT) return { applied: false };
  let created = 0, updated = 0;
  const apply = (db, entries, selects) => {
    const byName = new Map(w.listEntities(db.id).map((e) => [w.entityName(e), e]));
    for (const entry of entries ?? []) {
      const existing = byName.get(entry.name);
      const values = {};
      for (const sel of selects) {
        const v = entry[sel.toLowerCase()];
        if (v != null) values[sel] = v;
      }
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
    }
  };
  apply(issuesT, manifest.issues, ['Severity', 'Symptom']);
  apply(featuresT, manifest.features, ['Milestone']);
  w.state.meta.developmentSync = stamp;
  w.save();
  return { applied: true, created, updated };
}
