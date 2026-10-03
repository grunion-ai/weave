/* The first-run empty state, the pure half (Issue #386). A workspace with no
   tables of its own opens on one primary action and a few starting
   templates instead of the registry grid.

   "Its own" is the engine's `system` flag, never a name: the Workspace space
   and every table in it are the registry, which each root workspace carries
   from birth, so counting them made the welcome unreachable.

   A template is data: a weave_build spec (Feature #253) for one space, its
   tables, fields, relations, rollups, formulas and a few sample rows.
   spec() hands it to the engine's one build call, so the empty state (POST
   /api/build), the onboarding welcome (Feature #248, server side) and the
   tests all build the same thing, and a template needs no builder of its own
   (Feature #244).

   Loaded by the browser as a classic script, and by the server and the
   tests as a side-effect import, so it speaks only globalThis. */
(function (root) {
  /* The tables a person made, from a describeSchema()-shaped list: a system
     table, or any table in a system space, is weave's own. */
  function userTables(schema) {
    return (schema ?? []).filter((sp) => !sp.system)
      .flatMap((sp) => (sp.tables ?? []).filter((t) => !t.system));
  }

  /* The month a template is built in: its name for the Months row, a day of
     it for a sample date, and a date some days on for a due date. Local
     time, so a row dated "today" is the person's today. */
  function month(now = new Date()) {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      name: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      on: (day) => iso(new Date(now.getFullYear(), now.getMonth(), day)),
      after: (days) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)),
    };
  }

  const money = { format: 'currency', currency: 'USD' };

  /* Three templates, from the use cases Kyle's sessions raised most (Feature
     #244, 2026-10-03): personal finance, tasks, a CRM. A card's title is its
     space's name, so the card and the sidebar call it one thing.

     Each template's tables are weave_build tables (Feature #253): fields
     written flat, a relation as `to` plus cardinality and inverse, rollups
     and formulas reading relations from the same build, and rows by field
     name, a relation value being the target row's Name. The first table is
     the one a build opens on. */
  const TEMPLATES = [
    {
      id: 'finance',
      title: 'Money',
      blurb: 'Transactions and income, totaled by month',
      space: 'Money',
      icon: 'lucide:wallet',
      tables: (m) => [
        {
          name: 'Transactions',
          icon: 'lucide:receipt',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Amount', type: 'number', ...money },
            { name: 'Category', type: 'select', options: ['Groceries', 'Dining', 'Bills', 'Transport', 'Shopping', 'Other'] },
            { name: 'Account', type: 'relation', to: 'Accounts', cardinality: 'many-to-one', inverseName: 'Transactions' },
            { name: 'Month', type: 'relation', to: 'Months', cardinality: 'many-to-one', inverseName: 'Transactions' },
          ],
          rows: [
            { Name: 'Groceries', Date: m.on(3), Amount: 84.12, Category: 'Groceries', Account: 'Credit card', Month: m.name },
            { Name: 'Electric bill', Date: m.on(5), Amount: 62.4, Category: 'Bills', Account: 'Checking', Month: m.name },
            { Name: 'Dinner out', Date: m.on(9), Amount: 46.5, Category: 'Dining', Account: 'Credit card', Month: m.name },
          ],
        },
        {
          name: 'Accounts',
          icon: 'lucide:landmark',
          fields: [{ name: 'Kind', type: 'select', options: ['Checking', 'Savings', 'Credit card'] }],
          rows: [{ Name: 'Checking', Kind: 'Checking' }, { Name: 'Credit card', Kind: 'Credit card' }],
        },
        {
          name: 'Recurring',
          icon: 'lucide:refresh-cw',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Transactions', type: 'relation', to: 'Transactions', cardinality: 'one-to-many', inverseName: 'Recurring' },
          ],
          rows: [{ Name: 'Electric bill', Amount: 62.4, Transactions: ['Electric bill'] }, { Name: 'Phone bill', Amount: 45 }],
        },
        {
          name: 'Income',
          icon: 'lucide:coins',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Month', type: 'relation', to: 'Months', cardinality: 'many-to-one', inverseName: 'Income' },
          ],
          rows: [{ Name: 'Paycheck', Amount: 3200, Date: m.on(1), Month: m.name }],
        },
        {
          // One row per month, linked by hand for now (Feature #245 links
          // them automatically). No date-grain formula: Issues #576, #590.
          name: 'Months',
          icon: 'lucide:calendar',
          fields: [
            { name: 'Spent', type: 'rollup', relationField: 'Transactions', targetField: 'Amount', aggregate: 'sum' },
            { name: 'Earned', type: 'rollup', relationField: 'Income', targetField: 'Amount', aggregate: 'sum' },
            { name: 'Net', type: 'formula', expression: 'Earned - Spent', ...money },
          ],
          rows: [{ Name: m.name }],
        },
      ],
    },
    {
      id: 'tasks',
      title: 'Work',
      blurb: 'Tasks with status, due date and priority',
      space: 'Work',
      icon: 'lucide:list-checks',
      tables: (m) => [{
        name: 'Tasks',
        icon: 'lucide:square-check',
        fields: [
          { name: 'Status', type: 'workflow', states: [
            { name: 'To do', category: 'not-started', default: true },
            { name: 'Doing', category: 'in-progress' },
            { name: 'Done', category: 'done' },
          ] },
          { name: 'Due', type: 'date' },
          { name: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] },
        ],
        rows: [
          { Name: 'Try weave', Status: 'Doing', Due: m.after(0), Priority: 'High' },
          { Name: 'Invite a teammate', Due: m.after(7), Priority: 'Medium' },
        ],
      }],
    },
    {
      id: 'crm',
      title: 'People',
      blurb: 'Companies by stage, linked to their contacts',
      space: 'People',
      icon: 'lucide:users',
      tables: () => [
        {
          name: 'Companies',
          icon: 'lucide:briefcase',
          fields: [
            { name: 'Website', type: 'url' },
            { name: 'Stage', type: 'select', options: ['Lead', 'Customer', 'Partner'] },
          ],
          rows: [{ Name: 'Acme', Website: 'https://example.com', Stage: 'Lead' }],
        },
        {
          name: 'Contacts',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Phone', type: 'text' },
            { name: 'Company', type: 'relation', to: 'Companies', cardinality: 'many-to-one', inverseName: 'Contacts' },
          ],
          rows: [{ Name: 'Ada Park', Email: 'ada@example.com', Company: 'Acme' }],
        },
      ],
    },
  ];

  /* A template as one weave_build spec: POST /api/build in the browser, the
     engine's build() on the server, the same spec both ways. */
  function spec(template, { now } = {}) {
    return { spaces: [{ name: template.space, icon: template.icon, tables: template.tables(month(now)) }] };
  }
  const firstTable = (template) => template.tables(month())[0].name;

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

  root.WeaveStarters = { userTables, TEMPLATES, spec, firstTable, workspaceName };
})(globalThis);
