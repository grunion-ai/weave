/* The first-run empty state, the pure half (Issue #386). A workspace with no
   tables of its own opens on one primary action and a few starting
   templates instead of the registry grid.

   "Its own" is the engine's `system` flag, never a name: the Workspace space
   and every table in it are the registry, which each root workspace carries
   from birth, so counting them made the welcome unreachable.

   A template is data: a space, its tables and their fields, and the
   relations between them. steps() flattens one into the engine's existing
   create calls in order, so the browser walks them over REST and the test
   walks them on an engine, and both build the same thing.

   The onboarding welcome (Feature #248) builds a template on the server
   from the same steps(), so one template is one list of calls everywhere.

   Loaded by the browser as a classic script, and by the server and the
   tests as a side-effect import, so it speaks only globalThis. */
(function (root) {
  /* The tables a person made, from a describeSchema()-shaped list: a system
     table, or any table in a system space, is weave's own. */
  function userTables(schema) {
    return (schema ?? []).filter((sp) => !sp.system)
      .flatMap((sp) => (sp.tables ?? []).filter((t) => !t.system));
  }

  const TEMPLATES = [
    {
      id: 'tasks',
      title: 'Tasks',
      blurb: 'Status, due date and priority for each task',
      space: 'Work',
      tables: [{
        name: 'Tasks',
        fields: [
          { name: 'Status', type: 'workflow', config: { states: [
            { name: 'To do', category: 'not-started', default: true },
            { name: 'Doing', category: 'in-progress' },
            { name: 'Done', category: 'done' },
          ] } },
          { name: 'Due', type: 'date' },
          { name: 'Priority', type: 'select', config: { options: ['High', 'Medium', 'Low'] } },
        ],
      }],
    },
    {
      id: 'crm',
      title: 'CRM',
      blurb: 'Companies and their contacts, in two linked tables',
      space: 'CRM',
      tables: [
        {
          name: 'Companies',
          fields: [
            { name: 'Website', type: 'url' },
            { name: 'Stage', type: 'select', config: { options: ['Lead', 'Customer', 'Partner'] } },
          ],
        },
        {
          name: 'Contacts',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Phone', type: 'text' },
          ],
        },
      ],
      relations: [
        { table: 'Contacts', name: 'Company', target: 'Companies', cardinality: 'many-to-one', inverseName: 'Contacts' },
      ],
    },
    {
      id: 'docs',
      title: 'Docs',
      blurb: 'Written docs with tags and a draft or published status',
      space: 'Docs',
      tables: [{
        name: 'Docs',
        fields: [
          { name: 'Tags', type: 'multiselect', config: { options: ['Guide', 'Reference', 'Notes'] } },
          { name: 'Status', type: 'select', config: { options: ['Draft', 'Published'] } },
        ],
      }],
    },
  ];

  /* A template as the create calls that build it, in order. `table` is the
     qualified Space/Name the engine resolves; a relation's target is too.
     `hasSpace` skips the space a person already made under that name. */
  function steps(template, { hasSpace = false } = {}) {
    const sp = template.space;
    const out = hasSpace ? [] : [{ op: 'space', body: { name: sp } }];
    for (const t of template.tables) out.push({ op: 'table', body: { space: sp, name: t.name } });
    for (const t of template.tables) {
      for (const f of t.fields ?? []) out.push({ op: 'field', table: `${sp}/${t.name}`, body: { name: f.name, type: f.type, config: f.config ?? {} } });
    }
    for (const r of template.relations ?? []) {
      out.push({ op: 'relation', table: `${sp}/${r.table}`, body: { name: r.name, targetDb: `${sp}/${r.target}`, cardinality: r.cardinality, inverseName: r.inverseName } });
    }
    return out;
  }

  /* What a person types as a workspace name, as one the engine accepts (a
     letter or digit, then letters, digits, - and _). A name it already
     accepts is kept as typed; anything else is folded: "Acme Team" becomes
     acme-team. Empty when nothing usable is left (Feature #248). */
  const VALID_NAME = /^[a-z0-9][a-z0-9-_]*$/i;
  function workspaceName(text) {
    const t = String(text ?? '').trim();
    if (VALID_NAME.test(t) && t.length <= 48) return t;
    return t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/['\u2019]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-')
      .replace(/^[-_]+/, '').slice(0, 48).replace(/[-_]+$/, '');
  }

  root.WeaveStarters = { userTables, TEMPLATES, steps, workspaceName };
})(globalThis);
