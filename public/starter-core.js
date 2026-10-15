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
  const opt = (name, hue = 'slate') => ({ name, hue });
  const state = (name, category, hue, isDefault = false) => ({ name, category, hue, ...(isDefault ? { default: true } : {}) });

  const TEMPLATES = [
    {
      id: 'finance',
      title: 'Money',
      blurb: 'Transactions and income, totaled by month',
      space: 'Money',
      icon: 'lucide:wallet',
      work: 'Personal money',
      featured: true,
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
      work: 'Personal tasks',
      featured: true,
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
      work: 'Sales and clients',
      featured: true,
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
    {
      id: 'recruiting',
      title: 'Hiring',
      blurb: 'Candidates by stage, linked to roles and interviews',
      space: 'Hiring',
      icon: 'lucide:user-plus',
      work: 'Recruiting and hiring',
      featured: false,
      tables: (m) => [
        {
          name: 'Candidates',
          icon: 'lucide:user',
          fields: [
            { name: 'Stage', type: 'workflow', states: [
              state('Applied', 'not-started', 'slate', true),
              state('Screen', 'in-progress', 'blue'),
              state('Interview', 'in-progress', 'purple'),
              state('Offer', 'in-progress', 'amber'),
              state('Hired', 'done', 'green'),
              state('Declined', 'canceled', 'red'),
            ] },
            { name: 'Email', type: 'email' },
            { name: 'Source', type: 'select', options: ['Referral', 'Job board', 'Outreach', 'Website'] },
            { name: 'Role', type: 'relation', to: 'Roles', cardinality: 'many-to-one', inverseName: 'Candidates' },
          ],
          rows: [
            { Name: 'Rosa Field', Stage: 'Interview', Email: 'rosa@example.com', Source: 'Referral', Role: 'Product designer' },
            { Name: 'Tom Okafor', Stage: 'Screen', Email: 'tom@example.com', Source: 'Job board', Role: 'Support lead' },
            { Name: 'Lena Varga', Email: 'lena@example.com', Source: 'Website', Role: 'Product designer' },
          ],
        },
        {
          name: 'Roles',
          icon: 'lucide:briefcase',
          fields: [
            { name: 'Team', type: 'select', options: ['Design', 'Engineering', 'Support', 'Sales'] },
            { name: 'Salary', type: 'number', ...money },
            { name: 'Open', type: 'checkbox' },
            { name: 'Applicants', type: 'rollup', relationField: 'Candidates', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Product designer', Team: 'Design', Salary: 120000, Open: true },
            { Name: 'Support lead', Team: 'Support', Salary: 85000, Open: true },
          ],
        },
        {
          name: 'Interviews',
          icon: 'lucide:message-square',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Interviewer', type: 'text' },
            { name: 'Score', type: 'rating', max: 5 },
            { name: 'Candidate', type: 'relation', to: 'Candidates', cardinality: 'many-to-one', inverseName: 'Interviews' },
          ],
          rows: [
            { Name: 'Rosa: portfolio review', Date: m.after(2), Interviewer: 'Sam Lee', Candidate: 'Rosa Field' },
            { Name: 'Rosa: phone screen', Date: m.after(-5), Interviewer: 'Kim Diaz', Score: 4, Candidate: 'Rosa Field' },
          ],
        },
      ],
    },
    {
      id: 'projects',
      title: 'Projects',
      blurb: 'Team projects and their tasks, with owners and due dates',
      space: 'Projects',
      icon: 'lucide:kanban',
      work: 'Team projects',
      featured: false,
      tables: (m) => [
        {
          name: 'Projects',
          icon: 'lucide:layers',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Planned', 'not-started', 'slate', true),
              state('Active', 'in-progress', 'blue'),
              state('On hold', 'in-progress', 'amber'),
              state('Done', 'done', 'green'),
            ] },
            { name: 'Due', type: 'date' },
            { name: 'Lead', type: 'relation', to: 'Members', cardinality: 'many-to-one', inverseName: 'Leads' },
            { name: 'Task count', type: 'rollup', relationField: 'Tasks', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Website refresh', Status: 'Active', Due: m.after(21), Lead: 'Noor Haddad' },
            { Name: 'Quarterly planning', Due: m.after(35), Lead: 'Ben Ito' },
          ],
        },
        {
          name: 'Tasks',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('To do', 'not-started', 'slate', true),
              state('Doing', 'in-progress', 'blue'),
              state('Review', 'in-progress', 'purple'),
              state('Done', 'done', 'green'),
            ] },
            { name: 'Due', type: 'date' },
            { name: 'Project', type: 'relation', to: 'Projects', cardinality: 'many-to-one', inverseName: 'Tasks' },
            { name: 'Owner', type: 'relation', to: 'Members', cardinality: 'many-to-one', inverseName: 'Tasks' },
          ],
          rows: [
            { Name: 'Draft the new home page', Status: 'Doing', Due: m.after(5), Project: 'Website refresh', Owner: 'Noor Haddad' },
            { Name: 'Collect photos', Status: 'Review', Due: m.after(3), Project: 'Website refresh', Owner: 'Ben Ito' },
            { Name: 'List last quarter\'s goals', Due: m.after(14), Project: 'Quarterly planning', Owner: 'Ben Ito' },
          ],
        },
        {
          name: 'Members',
          icon: 'lucide:users-round',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Role', type: 'text' },
          ],
          rows: [
            { Name: 'Noor Haddad', Email: 'noor@example.com', Role: 'Designer' },
            { Name: 'Ben Ito', Email: 'ben@example.com', Role: 'Project manager' },
          ],
        },
      ],
    },
    {
      id: 'roadmap',
      title: 'Roadmap',
      blurb: 'Features by status, linked to feedback and releases',
      space: 'Roadmap',
      icon: 'lucide:route',
      work: 'Product roadmap',
      featured: false,
      tables: (m) => [
        {
          name: 'Features',
          icon: 'lucide:sparkles',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Idea', 'not-started', 'slate', true),
              state('Planned', 'not-started', 'blue'),
              state('Building', 'in-progress', 'amber'),
              state('Shipped', 'done', 'green'),
            ] },
            { name: 'Effort', type: 'select', options: ['Small', 'Medium', 'Large'] },
            { name: 'Release', type: 'relation', to: 'Releases', cardinality: 'many-to-one', inverseName: 'Features' },
            { name: 'Requests', type: 'rollup', relationField: 'Feedback', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Dark mode', Status: 'Building', Effort: 'Medium', Release: 'Spring release' },
            { Name: 'CSV export', Status: 'Planned', Effort: 'Small', Release: 'Spring release' },
            { Name: 'Offline mode', Effort: 'Large' },
          ],
        },
        {
          name: 'Feedback',
          icon: 'lucide:message-circle',
          fields: [
            { name: 'Customer', type: 'text' },
            { name: 'Source', type: 'select', options: ['Email', 'Call', 'Support', 'Survey'] },
            { name: 'Date', type: 'date' },
            { name: 'Feature', type: 'relation', to: 'Features', cardinality: 'many-to-one', inverseName: 'Feedback' },
          ],
          rows: [
            { Name: 'Hard to read at night', Customer: 'Northwind', Source: 'Support', Date: m.after(-3), Feature: 'Dark mode' },
            { Name: 'Need data in a spreadsheet', Customer: 'Blue Fern', Source: 'Call', Date: m.after(-8), Feature: 'CSV export' },
            { Name: 'Please add a dark theme', Customer: 'Acme', Source: 'Email', Date: m.after(-1), Feature: 'Dark mode' },
          ],
        },
        {
          name: 'Releases',
          icon: 'lucide:rocket',
          fields: [{ name: 'Date', type: 'date' }],
          rows: [{ Name: 'Spring release', Date: m.after(30) }, { Name: 'Summer release', Date: m.after(90) }],
        },
      ],
    },
    {
      id: 'content',
      title: 'Content',
      blurb: 'Posts by publish date, channel and writer',
      space: 'Content',
      icon: 'lucide:calendar',
      work: 'Content calendar',
      featured: false,
      tables: (m) => [
        {
          name: 'Posts',
          icon: 'lucide:file-text',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Idea', 'not-started', 'slate', true),
              state('Drafting', 'in-progress', 'blue'),
              state('Editing', 'in-progress', 'purple'),
              state('Scheduled', 'in-progress', 'amber'),
              state('Published', 'done', 'green'),
            ] },
            { name: 'Publish date', type: 'date' },
            { name: 'Channel', type: 'relation', to: 'Channels', cardinality: 'many-to-one', inverseName: 'Posts' },
            { name: 'Writer', type: 'relation', to: 'Writers', cardinality: 'many-to-one', inverseName: 'Posts' },
          ],
          rows: [
            { Name: 'Five ways to plan a launch', Status: 'Drafting', 'Publish date': m.after(7), Channel: 'Blog', Writer: 'Maya Chen' },
            { Name: 'Monthly roundup', Status: 'Scheduled', 'Publish date': m.after(2), Channel: 'Newsletter', Writer: 'Leo Grant' },
            { Name: 'Behind the scenes video', 'Publish date': m.after(14), Channel: 'Video', Writer: 'Maya Chen' },
          ],
        },
        {
          name: 'Channels',
          icon: 'lucide:radio',
          fields: [
            { name: 'Kind', type: 'select', options: ['Blog', 'Newsletter', 'Social', 'Video'] },
            { name: 'Link', type: 'url' },
          ],
          rows: [
            { Name: 'Blog', Kind: 'Blog', Link: 'https://example.com/blog' },
            { Name: 'Newsletter', Kind: 'Newsletter' },
            { Name: 'Video', Kind: 'Video' },
          ],
        },
        {
          name: 'Writers',
          icon: 'lucide:pencil',
          fields: [{ name: 'Email', type: 'email' }],
          rows: [{ Name: 'Maya Chen', Email: 'maya@example.com' }, { Name: 'Leo Grant', Email: 'leo@example.com' }],
        },
      ],
    },
    {
      id: 'support',
      title: 'Support',
      blurb: 'Tickets by priority and status, linked to customers',
      space: 'Support',
      icon: 'lucide:ticket',
      work: 'Customer support',
      featured: false,
      tables: (m) => [
        {
          name: 'Tickets',
          icon: 'lucide:ticket',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('New', 'not-started', 'blue', true),
              state('Open', 'in-progress', 'amber'),
              state('Waiting', 'in-progress', 'slate'),
              state('Solved', 'done', 'green'),
            ] },
            { name: 'Priority', type: 'select', options: [opt('Urgent', 'red'), opt('High', 'orange'), opt('Normal'), opt('Low')] },
            { name: 'Opened', type: 'date' },
            { name: 'Agent', type: 'text' },
            { name: 'Customer', type: 'relation', to: 'Customers', cardinality: 'many-to-one', inverseName: 'Tickets' },
          ],
          rows: [
            { Name: 'Cannot sign in', Status: 'Open', Priority: 'Urgent', Opened: m.after(0), Agent: 'Priya', Customer: 'Jordan Blake' },
            { Name: 'Refund for a double charge', Status: 'Waiting', Priority: 'High', Opened: m.after(-2), Agent: 'Marco', Customer: 'Ana Ruiz' },
            { Name: 'How do I change my plan?', Status: 'Solved', Priority: 'Low', Opened: m.after(-6), Agent: 'Priya', Customer: 'Jordan Blake' },
          ],
        },
        {
          name: 'Customers',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Plan', type: 'select', options: ['Free', 'Pro', 'Business'] },
            { name: 'Ticket count', type: 'rollup', relationField: 'Tickets', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Jordan Blake', Email: 'jordan@example.com', Plan: 'Pro' },
            { Name: 'Ana Ruiz', Email: 'ana@example.com', Plan: 'Business' },
          ],
        },
      ],
    },
    {
      id: 'freelance',
      title: 'Freelance',
      blurb: 'Clients, jobs and invoices, with amounts billed',
      space: 'Freelance',
      icon: 'lucide:briefcase',
      work: 'Freelance clients',
      featured: false,
      tables: (m) => [
        {
          name: 'Clients',
          icon: 'lucide:users',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Hourly rate', type: 'number', ...money },
            { name: 'Billed', type: 'rollup', relationField: 'Invoices', targetField: 'Amount', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Harbor Bakery', Email: 'owner@example.com', 'Hourly rate': 90 },
            { Name: 'Pine Street Dental', Email: 'office@example.com', 'Hourly rate': 110 },
          ],
        },
        {
          name: 'Jobs',
          icon: 'lucide:clipboard',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Quoted'), opt('In progress', 'blue'), opt('Delivered', 'green')] },
            { name: 'Hours', type: 'number' },
            { name: 'Client', type: 'relation', to: 'Clients', cardinality: 'many-to-one', inverseName: 'Jobs' },
          ],
          rows: [
            { Name: 'New menu design', Status: 'Delivered', Hours: 12, Client: 'Harbor Bakery' },
            { Name: 'Booking page', Status: 'In progress', Hours: 20, Client: 'Pine Street Dental' },
          ],
        },
        {
          name: 'Invoices',
          icon: 'lucide:receipt',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Issued', type: 'date' },
            { name: 'Due', type: 'date' },
            { name: 'Status', type: 'select', options: [opt('Draft'), opt('Sent', 'blue'), opt('Paid', 'green'), opt('Overdue', 'red')] },
            { name: 'Client', type: 'relation', to: 'Clients', cardinality: 'many-to-one', inverseName: 'Invoices' },
          ],
          rows: [
            { Name: 'INV-001', Amount: 1080, Issued: m.after(-20), Due: m.after(-6), Status: 'Paid', Client: 'Harbor Bakery' },
            { Name: 'INV-002', Amount: 1100, Issued: m.after(-2), Due: m.after(12), Status: 'Sent', Client: 'Pine Street Dental' },
          ],
        },
      ],
    },
    {
      id: 'research',
      title: 'Research',
      blurb: 'Sources and notes, sorted by topic',
      space: 'Research',
      icon: 'lucide:bookmark',
      work: 'Research and reading',
      featured: false,
      tables: (m) => [
        {
          name: 'Sources',
          icon: 'lucide:file-text',
          fields: [
            { name: 'Kind', type: 'select', options: ['Book', 'Article', 'Paper', 'Video'] },
            { name: 'Author', type: 'text' },
            { name: 'Link', type: 'url' },
            { name: 'Reading', type: 'select', options: [opt('To read'), opt('Reading', 'blue'), opt('Done', 'green')] },
            { name: 'Rating', type: 'rating', max: 5 },
          ],
          rows: [
            { Name: 'Notes on sleep and memory', Kind: 'Paper', Author: 'R. Alvarez', Link: 'https://example.com/sleep', Reading: 'Done', Rating: 4 },
            { Name: 'The quiet garden', Kind: 'Book', Author: 'J. Moreau', Reading: 'Reading' },
          ],
        },
        {
          name: 'Notes',
          icon: 'lucide:pencil',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Source', type: 'relation', to: 'Sources', cardinality: 'many-to-one', inverseName: 'Notes' },
            { name: 'Topic', type: 'relation', to: 'Topics', cardinality: 'many-to-one', inverseName: 'Notes' },
          ],
          rows: [
            { Name: 'Naps help recall', Date: m.after(-4), Source: 'Notes on sleep and memory', Topic: 'Memory' },
            { Name: 'Shade plants for small yards', Date: m.after(-1), Source: 'The quiet garden', Topic: 'Gardening' },
          ],
        },
        {
          name: 'Topics',
          icon: 'lucide:hash',
          fields: [{ name: 'Note count', type: 'rollup', relationField: 'Notes', aggregate: 'count' }],
          rows: [{ Name: 'Memory' }, { Name: 'Gardening' }],
        },
      ],
    },
    {
      id: 'fundraising',
      title: 'Fundraising',
      blurb: 'Investors by stage, with check sizes and meetings',
      space: 'Fundraising',
      icon: 'lucide:trending-up',
      work: 'Fundraising and investors',
      featured: false,
      tables: (m) => [
        {
          name: 'Investors',
          icon: 'lucide:user',
          fields: [
            { name: 'Stage', type: 'workflow', states: [
              state('Researching', 'not-started', 'slate', true),
              state('Contacted', 'in-progress', 'blue'),
              state('Meeting', 'in-progress', 'purple'),
              state('Diligence', 'in-progress', 'amber'),
              state('Committed', 'done', 'green'),
              state('Passed', 'canceled', 'red'),
            ] },
            { name: 'Email', type: 'email' },
            { name: 'Check size', type: 'number', ...money },
            { name: 'Firm', type: 'relation', to: 'Firms', cardinality: 'many-to-one', inverseName: 'Investors' },
          ],
          rows: [
            { Name: 'Dana Whitfield', Stage: 'Meeting', Email: 'dana@example.com', 'Check size': 250000, Firm: 'Lantern Ventures' },
            { Name: 'Omar Said', Stage: 'Committed', Email: 'omar@example.com', 'Check size': 50000, Firm: 'Hollow Oak Capital' },
            { Name: 'Iris Novak', Email: 'iris@example.com', 'Check size': 500000, Firm: 'Lantern Ventures' },
          ],
        },
        {
          name: 'Firms',
          icon: 'lucide:landmark',
          fields: [
            { name: 'Kind', type: 'select', options: ['Venture fund', 'Angel', 'Family office'] },
            { name: 'Website', type: 'url' },
            { name: 'Asks', type: 'rollup', relationField: 'Investors', targetField: 'Check size', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Lantern Ventures', Kind: 'Venture fund', Website: 'https://example.com' },
            { Name: 'Hollow Oak Capital', Kind: 'Family office' },
          ],
        },
        {
          name: 'Meetings',
          icon: 'lucide:calendar',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Next step', type: 'text' },
            { name: 'Investor', type: 'relation', to: 'Investors', cardinality: 'many-to-one', inverseName: 'Meetings' },
          ],
          rows: [
            { Name: 'Intro call', Date: m.after(-7), 'Next step': 'Send the deck', Investor: 'Dana Whitfield' },
            { Name: 'Partner meeting', Date: m.after(4), 'Next step': 'Share the data room', Investor: 'Dana Whitfield' },
          ],
        },
      ],
    },
    {
      id: 'events',
      title: 'Events',
      blurb: 'Events with dates, venues and guest lists',
      space: 'Events',
      icon: 'lucide:calendar-range',
      work: 'Events and guests',
      featured: false,
      tables: (m) => [
        {
          name: 'Events',
          icon: 'lucide:calendar',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Status', type: 'select', options: [opt('Planning'), opt('Confirmed', 'blue'), opt('Done', 'green')] },
            { name: 'Budget', type: 'number', ...money },
            { name: 'Venue', type: 'relation', to: 'Venues', cardinality: 'many-to-one', inverseName: 'Events' },
            { name: 'Guest count', type: 'rollup', relationField: 'Guests', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Spring meetup', Date: m.after(18), Status: 'Confirmed', Budget: 1500, Venue: 'Riverside Hall' },
            { Name: 'Team dinner', Date: m.after(9), Status: 'Planning', Budget: 600, Venue: 'Olive Room' },
          ],
        },
        {
          name: 'Guests',
          icon: 'lucide:users',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'RSVP', type: 'select', options: [opt('Invited'), opt('Yes', 'green'), opt('Maybe', 'amber'), opt('No', 'red')] },
            { name: 'Plus one', type: 'checkbox' },
            { name: 'Event', type: 'relation', to: 'Events', cardinality: 'many-to-one', inverseName: 'Guests' },
          ],
          rows: [
            { Name: 'Kai Morgan', Email: 'kai@example.com', RSVP: 'Yes', 'Plus one': true, Event: 'Spring meetup' },
            { Name: 'Elena Brooks', Email: 'elena@example.com', RSVP: 'Maybe', Event: 'Spring meetup' },
            { Name: 'Sam Patel', Email: 'sam@example.com', RSVP: 'Invited', Event: 'Team dinner' },
          ],
        },
        {
          name: 'Venues',
          icon: 'lucide:map-pin',
          fields: [
            { name: 'Address', type: 'text' },
            { name: 'Capacity', type: 'number' },
          ],
          rows: [
            { Name: 'Riverside Hall', Address: '12 River Road', Capacity: 120 },
            { Name: 'Olive Room', Address: '48 Main Street', Capacity: 30 },
          ],
        },
      ],
    },
    {
      id: 'inventory',
      title: 'Inventory',
      blurb: 'Products, stock counts, suppliers and orders',
      space: 'Inventory',
      icon: 'lucide:shopping-bag',
      work: 'Inventory and orders',
      featured: false,
      tables: (m) => [
        {
          name: 'Products',
          icon: 'lucide:shopping-bag',
          fields: [
            { name: 'SKU', type: 'text' },
            { name: 'Price', type: 'number', ...money },
            { name: 'In stock', type: 'number' },
            { name: 'Stock value', type: 'formula', expression: 'Price * [In stock]', ...money },
            { name: 'Supplier', type: 'relation', to: 'Suppliers', cardinality: 'many-to-one', inverseName: 'Products' },
          ],
          rows: [
            { Name: 'Ceramic mug', SKU: 'MUG-01', Price: 18, 'In stock': 40, Supplier: 'Clayworks' },
            { Name: 'Linen tea towel', SKU: 'TWL-02', Price: 12, 'In stock': 65, Supplier: 'Loom and Co' },
            { Name: 'Teapot', SKU: 'POT-03', Price: 45, 'In stock': 8, Supplier: 'Clayworks' },
          ],
        },
        {
          name: 'Orders',
          icon: 'lucide:shopping-cart',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('New', 'not-started', 'blue', true),
              state('Packed', 'in-progress', 'amber'),
              state('Shipped', 'in-progress', 'purple'),
              state('Delivered', 'done', 'green'),
            ] },
            { name: 'Date', type: 'date' },
            { name: 'Quantity', type: 'number' },
            { name: 'Total', type: 'number', ...money },
            { name: 'Product', type: 'relation', to: 'Products', cardinality: 'many-to-one', inverseName: 'Orders' },
          ],
          rows: [
            { Name: 'Order 1001', Status: 'Shipped', Date: m.after(-2), Quantity: 2, Total: 36, Product: 'Ceramic mug' },
            { Name: 'Order 1002', Date: m.after(0), Quantity: 1, Total: 45, Product: 'Teapot' },
          ],
        },
        {
          name: 'Suppliers',
          icon: 'lucide:briefcase',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Website', type: 'url' },
          ],
          rows: [
            { Name: 'Clayworks', Email: 'orders@example.com', Website: 'https://example.com' },
            { Name: 'Loom and Co', Email: 'hello@example.com' },
          ],
        },
      ],
    },
    {
      id: 'nonprofit',
      title: 'Donors',
      blurb: 'Donors, gifts and grants, with totals given',
      space: 'Donors',
      icon: 'lucide:heart',
      work: 'Nonprofit donors and grants',
      featured: false,
      tables: (m) => [
        {
          name: 'Donors',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Kind', type: 'select', options: ['Individual', 'Foundation', 'Company'] },
            { name: 'Given', type: 'rollup', relationField: 'Gifts', targetField: 'Amount', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Grace Holt', Email: 'grace@example.com', Kind: 'Individual' },
            { Name: 'Maple Foundation', Email: 'grants@example.com', Kind: 'Foundation' },
          ],
        },
        {
          name: 'Gifts',
          icon: 'lucide:coins',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Campaign', type: 'select', options: ['Spring appeal', 'Year end', 'Gala'] },
            { name: 'Donor', type: 'relation', to: 'Donors', cardinality: 'many-to-one', inverseName: 'Gifts' },
          ],
          rows: [
            { Name: 'Spring gift', Amount: 250, Date: m.after(-10), Campaign: 'Spring appeal', Donor: 'Grace Holt' },
            { Name: 'Gala table', Amount: 1200, Date: m.after(-3), Campaign: 'Gala', Donor: 'Grace Holt' },
          ],
        },
        {
          name: 'Grants',
          icon: 'lucide:award',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Researching', 'not-started', 'slate', true),
              state('Writing', 'in-progress', 'blue'),
              state('Submitted', 'in-progress', 'amber'),
              state('Awarded', 'done', 'green'),
              state('Declined', 'canceled', 'red'),
            ] },
            { name: 'Amount', type: 'number', ...money },
            { name: 'Deadline', type: 'date' },
            { name: 'Funder', type: 'relation', to: 'Donors', cardinality: 'many-to-one', inverseName: 'Grants' },
          ],
          rows: [
            { Name: 'Youth programs grant', Status: 'Writing', Amount: 25000, Deadline: m.after(24), Funder: 'Maple Foundation' },
            { Name: 'Operating support', Status: 'Submitted', Amount: 10000, Deadline: m.after(-4), Funder: 'Maple Foundation' },
          ],
        },
      ],
    },
    {
      id: 'home',
      title: 'Home',
      blurb: 'Chores and repairs, organized by room',
      space: 'Home',
      icon: 'lucide:house',
      work: 'Home and personal life',
      featured: false,
      tables: (m) => [
        {
          name: 'Chores',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Every', type: 'select', options: ['Day', 'Week', 'Month'] },
            { name: 'Next due', type: 'date' },
            { name: 'Done', type: 'checkbox' },
            { name: 'Room', type: 'relation', to: 'Rooms', cardinality: 'many-to-one', inverseName: 'Chores' },
          ],
          rows: [
            { Name: 'Water the plants', Every: 'Week', 'Next due': m.after(2), Room: 'Living room' },
            { Name: 'Clean the fridge', Every: 'Month', 'Next due': m.after(10), Room: 'Kitchen' },
            { Name: 'Run the dishwasher', Every: 'Day', 'Next due': m.after(0), Done: true, Room: 'Kitchen' },
          ],
        },
        {
          name: 'Repairs',
          icon: 'lucide:settings',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('To do', 'not-started', 'slate', true),
              state('Booked', 'in-progress', 'blue'),
              state('Fixed', 'done', 'green'),
            ] },
            { name: 'Cost', type: 'number', ...money },
            { name: 'Room', type: 'relation', to: 'Rooms', cardinality: 'many-to-one', inverseName: 'Repairs' },
          ],
          rows: [
            { Name: 'Leaky faucet', Status: 'Booked', Cost: 140, Room: 'Kitchen' },
            { Name: 'Squeaky door', Room: 'Living room' },
          ],
        },
        {
          name: 'Rooms',
          icon: 'lucide:house',
          fields: [{ name: 'Repair costs', type: 'rollup', relationField: 'Repairs', targetField: 'Cost', aggregate: 'sum' }],
          rows: [{ Name: 'Kitchen' }, { Name: 'Living room' }],
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
