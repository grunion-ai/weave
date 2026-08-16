// The "weaver" workspace: Weave's canonical, self-referential documentation,
// how-to, wiki, test-suite mirror, and public issue/roadmap tracker — stored
// in Weave itself (like the.fibery.io), not an off-the-shelf docs engine.

export function seedWeaver(w) {
  w.state.meta.name = 'weaver';

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

  const suiteData = [
    ['Engine', 'test/engine.test.mjs', ['spaces and tables', 'entity CRUD + public ids', 'value validation', 'workflow transitions', 'many-to-one bidirectional', 'many-to-many', 'lookup + rollup', 'formula fields', 'query filters/sort/paths', 'documents', 'comments + activity', 'automations', 'search', 'field deletion cascades', 'CSV + schema', 'persistence', 'import/export']],
    ['Formula', 'test/formula.test.mjs', ['precedence', 'field refs', 'concat', 'logic', 'functions', 'errors']],
    ['Markdown', 'test/markdown.test.mjs', ['headings', 'links/images', 'code blocks', 'nested lists', 'ordered lists', 'quotes + hr', 'tables', 'mentions', 'escaping', 'blocks', 'document page']],
    ['PDF', 'test/pdf.test.mjs', ['strip inline', 'valid structure + xref', 'pagination', 'empty doc']],
    ['Server', 'test/server.test.mjs', ['health + schema', 'entity lifecycle', 'query', 'doc MD/HTML/PDF', 'comments/search/csv/automations', 'errors', 'export/import']],
    ['CLI', 'test/cli.test.mjs', ['end-to-end flow']],
    ['MCP', 'test/mcp.test.mjs', ['handshake + tools', 'full workflow', 'unknown method', 'relations + rollups']],
    ['Docs & search', 'test/docs-and-search.test.mjs', ['default Description', 'multiple documents', 'v1 migration', 'universal permalinks', 'automation describe', 'named-field automations', 'HTTP per-field docs']],
    ['Extras', 'test/extras.test.mjs', ['CSV parse', 'CSV import', 'CSV roundtrip', 'file attach', 'HTTP files/import', 'webhooks']],
  ];
  for (const [name, file, caseNames] of suiteData) {
    w.createEntity(suites, { name, values: { File: file } });
    for (const c of caseNames) w.createEntity(cases, { name: c, values: { Suite: name } });
  }

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

  w.save();
  return w;
}
