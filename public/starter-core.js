(function (root) {
  function userTables(schema) {
    return (schema ?? []).filter((sp) => !sp.system)
      .flatMap((sp) => (sp.tables ?? []).filter((t) => !t.system));
  }

  function month(now = new Date()) {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      name: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      on: (day) => iso(new Date(now.getFullYear(), now.getMonth(), day)),
      after: (days) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)),
    };
  }

  const money = { format: 'currency', currency: 'USD' };

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

  function spec(template, { now } = {}) {
    return { spaces: [{ name: template.space, icon: template.icon, tables: template.tables(month(now)) }] };
  }
  const firstTable = (template) => template.tables(month())[0].name;

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
