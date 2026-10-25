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

  const CATEGORIES = [
    { id: 'start', label: 'Start simple', icon: 'lucide:file-plus', blurb: 'One plain table to shape as you go' },
    { id: 'projects', label: 'Projects and tasks', icon: 'lucide:folder-kanban', blurb: 'Tasks, projects, meetings and goals' },
    { id: 'money', label: 'Personal money', icon: 'lucide:wallet', blurb: 'Spending, subscriptions and savings goals' },
    { id: 'sales', label: 'Sales and customers', icon: 'lucide:funnel', blurb: 'Contacts, deals and support tickets' },
    { id: 'marketing', label: 'Marketing and events', icon: 'lucide:send', blurb: 'Content, campaigns, social posts and events' },
    { id: 'product', label: 'Product and engineering', icon: 'lucide:rocket', blurb: 'Roadmaps, bugs, sprints and user research' },
    { id: 'people', label: 'Hiring and people', icon: 'lucide:users-round', blurb: 'Candidates, new hires and time off' },
    { id: 'finance', label: 'Business finance', icon: 'lucide:landmark', blurb: 'Fundraising, expenses and budgets' },
    { id: 'operations', label: 'Operations and inventory', icon: 'lucide:blocks', blurb: 'Stock, equipment and vendors' },
    { id: 'services', label: 'Clients and bookings', icon: 'lucide:briefcase', blurb: 'Client work, appointments and rentals' },
    { id: 'community', label: 'Nonprofits and community', icon: 'lucide:heart', blurb: 'Donors, volunteers and members' },
    { id: 'home', label: 'Home and health', icon: 'lucide:house', blurb: 'Chores, habits, workouts and recipes' },
    { id: 'learning', label: 'Learning and research', icon: 'lucide:lightbulb', blurb: 'Sources, courses and books' },
  ];

  const TEMPLATES = [
    {
      id: 'finance',
      title: 'Money',
      blurb: 'Transactions and income, totaled by month',
      space: 'Money',
      icon: 'lucide:wallet',
      work: 'Personal money',
      category: 'money',
      details: 'For anyone keeping a personal budget, month by month.',
      like: 'Like YNAB',
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
      category: 'projects',
      details: 'For one person who wants a single to-do list.',
      like: 'Like Todoist',
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
      category: 'sales',
      details: 'For a founder or small sales team who wants a simple CRM.',
      like: 'Like HubSpot CRM',
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
      id: 'basic',
      title: 'Basic',
      blurb: 'One table of items with a status, owner and due date',
      space: 'Basic',
      icon: 'lucide:table',
      work: 'General list',
      category: 'start',
      details: 'A starting point for any to-do list, notes or tracker.',
      like: 'Like a spreadsheet',
      featured: false,
      tables: (m) => [{
        name: 'Items',
        icon: 'lucide:list',
        fields: [
          { name: 'Status', type: 'workflow', states: [
            state('To do', 'not-started', 'slate', true),
            state('Doing', 'in-progress', 'blue'),
            state('Done', 'done', 'green'),
          ] },
          { name: 'Owner', type: 'text' },
          { name: 'Due', type: 'date' },
          { name: 'Notes', type: 'text' },
        ],
        rows: [
          { Name: 'Rename this table', Owner: 'Ana Ruiz', Due: m.after(1), Notes: 'Call it what you track' },
          { Name: 'Add a field you need', Status: 'Doing', Owner: 'Ana Ruiz', Due: m.after(3), Notes: 'Dates, numbers, links and more' },
          { Name: 'Invite a teammate', Owner: 'Sam Lee', Due: m.after(7) },
        ],
      }],
    },
    {
      id: 'recruiting',
      title: 'Hiring',
      blurb: 'Candidates by stage, linked to roles and interviews',
      space: 'Hiring',
      icon: 'lucide:user-plus',
      work: 'Recruiting and hiring',
      category: 'people',
      details: 'For a hiring manager running a search.',
      like: 'Like Greenhouse',
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
      category: 'projects',
      details: 'For a team running several projects at once.',
      like: 'Like Asana',
      featured: false,
      tables: (m) => [
        {
          name: 'Projects',
          icon: 'lucide:folder-kanban',
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
      category: 'product',
      details: 'For a product manager deciding what to build next.',
      like: 'Like Productboard',
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
      category: 'marketing',
      details: 'For a team or creator planning posts, newsletters and videos.',
      like: 'Like CoSchedule',
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
      category: 'sales',
      details: 'For a small team answering customer questions.',
      like: 'Like Zendesk',
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
      category: 'services',
      details: 'For a freelancer or one-person studio billing clients.',
      like: 'Like FreshBooks',
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
      category: 'learning',
      details: 'For a student or writer gathering sources on a subject.',
      like: 'Like Zotero',
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
      category: 'finance',
      details: 'For a founder raising a round.',
      like: 'Like Affinity',
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
      category: 'marketing',
      details: 'For anyone planning meetups, dinners or launches.',
      like: 'Like Luma',
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
      category: 'operations',
      details: 'For a small shop selling physical goods.',
      like: 'Like Sortly',
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
      category: 'community',
      details: 'For a nonprofit team tracking gifts and grant deadlines.',
      like: 'Like Bloomerang',
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
      category: 'home',
      details: 'For a household sharing chores and repairs.',
      like: 'Like OurHome',
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
    {
      id: 'meetings',
      title: 'Meetings',
      blurb: 'Meetings with notes and the action items they raise',
      space: 'Meetings',
      icon: 'lucide:message-square',
      work: 'Team meetings',
      category: 'projects',
      details: 'For a team that wants decisions to turn into follow-ups.',
      like: 'Like Fellow',
      featured: false,
      tables: (m) => [
        {
          name: 'Meetings',
          icon: 'lucide:calendar',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Kind', type: 'select', options: ['Standup', 'Planning', 'One on one', 'Review'] },
            { name: 'Notes', type: 'text' },
            { name: 'Item count', type: 'rollup', relationField: 'Action items', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Monday standup', Date: m.after(-2), Kind: 'Standup', Notes: 'Launch checklist is close' },
            { Name: 'Quarter planning', Date: m.after(3), Kind: 'Planning' },
            { Name: 'Ana and Sam one on one', Date: m.after(1), Kind: 'One on one' },
          ],
        },
        {
          name: 'Action items',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Open', 'not-started', 'slate', true),
              state('Doing', 'in-progress', 'blue'),
              state('Done', 'done', 'green'),
            ] },
            { name: 'Owner', type: 'text' },
            { name: 'Due', type: 'date' },
            { name: 'Meeting', type: 'relation', to: 'Meetings', cardinality: 'many-to-one', inverseName: 'Action items' },
          ],
          rows: [
            { Name: 'Share the launch checklist', Owner: 'Ana Ruiz', Due: m.after(4), Meeting: 'Monday standup' },
            { Name: 'Book the planning room', Status: 'Done', Owner: 'Sam Lee', Due: m.after(1), Meeting: 'Quarter planning' },
            { Name: 'Draft next quarter goals', Status: 'Doing', Owner: 'Ana Ruiz', Due: m.after(3), Meeting: 'Quarter planning' },
          ],
        },
      ],
    },
    {
      id: 'goals',
      title: 'Goals',
      blurb: 'Goals with key results, owners and status',
      space: 'Goals',
      icon: 'lucide:gauge',
      work: 'Goals and key results',
      category: 'projects',
      details: 'For a team or a person setting quarterly goals and OKRs.',
      like: 'Like Lattice',
      featured: false,
      tables: () => [
        {
          name: 'Goals',
          icon: 'lucide:gauge',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Not started', 'not-started', 'slate', true),
              state('On track', 'in-progress', 'blue'),
              state('At risk', 'in-progress', 'amber'),
              state('Behind', 'in-progress', 'red'),
              state('Achieved', 'done', 'green'),
            ] },
            { name: 'Quarter', type: 'select', options: ['Q1', 'Q2', 'Q3', 'Q4'] },
            { name: 'Owner', type: 'text' },
            { name: 'Result count', type: 'rollup', relationField: 'Key results', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Grow the newsletter', Status: 'On track', Quarter: 'Q4', Owner: 'Maya Chen' },
            { Name: 'Cut support wait times', Status: 'At risk', Quarter: 'Q4', Owner: 'Priya Shah' },
          ],
        },
        {
          name: 'Key results',
          icon: 'lucide:chart-column',
          fields: [
            { name: 'Target', type: 'number' },
            { name: 'Current', type: 'number' },
            { name: 'Goal', type: 'relation', to: 'Goals', cardinality: 'many-to-one', inverseName: 'Key results' },
          ],
          rows: [
            { Name: 'Reach 5,000 subscribers', Target: 5000, Current: 3800, Goal: 'Grow the newsletter' },
            { Name: 'Open rate of 40 percent', Target: 40, Current: 37, Goal: 'Grow the newsletter' },
            { Name: 'First reply within 4 hours', Target: 4, Current: 6, Goal: 'Cut support wait times' },
          ],
        },
      ],
    },
    {
      id: 'bugs',
      title: 'Bugs',
      blurb: 'Bugs by severity and status, grouped by component',
      space: 'Bugs',
      icon: 'lucide:bug',
      work: 'Bug tracking',
      category: 'product',
      details: 'For an engineering team deciding what to fix first.',
      like: 'Like Jira',
      featured: false,
      tables: (m) => [
        {
          name: 'Bugs',
          icon: 'lucide:bug',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Reported', 'not-started', 'slate', true),
              state('Triaged', 'not-started', 'blue'),
              state('Fixing', 'in-progress', 'amber'),
              state('Fixed', 'done', 'green'),
              state('Won\'t fix', 'canceled', 'red'),
            ] },
            { name: 'Severity', type: 'select', options: [opt('Critical', 'red'), opt('Major', 'orange'), opt('Minor'), opt('Trivial')] },
            { name: 'Reported', type: 'date' },
            { name: 'Reporter', type: 'email' },
            { name: 'Component', type: 'relation', to: 'Components', cardinality: 'many-to-one', inverseName: 'Bugs' },
          ],
          rows: [
            { Name: 'Save button does nothing in Safari', Status: 'Fixing', Severity: 'Major', Reported: m.after(-3), Reporter: 'qa@example.com', Component: 'Checkout' },
            { Name: 'Totals round the wrong way', Status: 'Triaged', Severity: 'Critical', Reported: m.after(-1), Reporter: 'ops@example.com', Component: 'Billing' },
            { Name: 'Typo on the welcome screen', Severity: 'Trivial', Reported: m.after(0), Reporter: 'qa@example.com', Component: 'Onboarding' },
          ],
        },
        {
          name: 'Components',
          icon: 'lucide:blocks',
          fields: [
            { name: 'Owner', type: 'text' },
            { name: 'Bug count', type: 'rollup', relationField: 'Bugs', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Checkout', Owner: 'Lin Wu' },
            { Name: 'Billing', Owner: 'Omar Said' },
            { Name: 'Onboarding', Owner: 'Lin Wu' },
          ],
        },
      ],
    },
    {
      id: 'sprints',
      title: 'Sprints',
      blurb: 'Sprints and stories, with points and status',
      space: 'Sprints',
      icon: 'lucide:timer',
      work: 'Agile sprints',
      category: 'product',
      details: 'For a software team working in short sprints.',
      like: 'Like Linear',
      featured: false,
      tables: (m) => [
        {
          name: 'Stories',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Backlog', 'not-started', 'slate', true),
              state('To do', 'not-started', 'blue'),
              state('In progress', 'in-progress', 'amber'),
              state('In review', 'in-progress', 'purple'),
              state('Done', 'done', 'green'),
            ] },
            { name: 'Points', type: 'number' },
            { name: 'Assignee', type: 'text' },
            { name: 'Sprint', type: 'relation', to: 'Sprints', cardinality: 'many-to-one', inverseName: 'Stories' },
          ],
          rows: [
            { Name: 'Sign in with a magic link', Status: 'In progress', Points: 5, Assignee: 'Dev Patel', Sprint: 'Sprint 14' },
            { Name: 'Export a table to CSV', Status: 'To do', Points: 3, Assignee: 'Lin Wu', Sprint: 'Sprint 14' },
            { Name: 'Fix the flaky upload test', Status: 'Done', Points: 1, Assignee: 'Dev Patel', Sprint: 'Sprint 14' },
            { Name: 'Show unread counts', Points: 2 },
          ],
        },
        {
          name: 'Sprints',
          icon: 'lucide:timer',
          fields: [
            { name: 'Start', type: 'date' },
            { name: 'End', type: 'date' },
            { name: 'Planned points', type: 'rollup', relationField: 'Stories', targetField: 'Points', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Sprint 14', Start: m.after(-7), End: m.after(7) },
            { Name: 'Sprint 15', Start: m.after(7), End: m.after(21) },
          ],
        },
      ],
    },
    {
      id: 'user-research',
      title: 'User research',
      blurb: 'Interviews and insights, linked to the people you spoke with',
      space: 'User research',
      icon: 'lucide:search',
      work: 'User research',
      category: 'product',
      details: 'For a product team tying findings to real conversations.',
      like: 'Like Dovetail',
      featured: false,
      tables: (m) => [
        {
          name: 'Interviews',
          icon: 'lucide:mic',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Status', type: 'select', options: [opt('Scheduled', 'blue'), opt('Done', 'green'), opt('No show', 'red')] },
            { name: 'Participant', type: 'relation', to: 'Participants', cardinality: 'many-to-one', inverseName: 'Interviews' },
            { name: 'Insight count', type: 'rollup', relationField: 'Insights', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Jo: first week setup', Date: m.after(-6), Status: 'Done', Participant: 'Jo Rivera' },
            { Name: 'Nia: pricing page walkthrough', Date: m.after(2), Status: 'Scheduled', Participant: 'Nia Clarke' },
          ],
        },
        {
          name: 'Insights',
          icon: 'lucide:lightbulb',
          fields: [
            { name: 'Theme', type: 'select', options: ['Onboarding', 'Pricing', 'Speed', 'Search'] },
            { name: 'Confidence', type: 'select', options: [opt('Strong', 'green'), opt('Medium', 'amber'), opt('Weak')] },
            { name: 'Interview', type: 'relation', to: 'Interviews', cardinality: 'many-to-one', inverseName: 'Insights' },
          ],
          rows: [
            { Name: 'Setup takes more than a day', Theme: 'Onboarding', Confidence: 'Strong', Interview: 'Jo: first week setup' },
            { Name: 'Search misses older notes', Theme: 'Search', Confidence: 'Medium', Interview: 'Jo: first week setup' },
          ],
        },
        {
          name: 'Participants',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Role', type: 'text' },
            { name: 'Company', type: 'text' },
          ],
          rows: [
            { Name: 'Jo Rivera', Email: 'jo@example.com', Role: 'Office manager', Company: 'Brightside Clinic' },
            { Name: 'Nia Clarke', Email: 'nia@example.com', Role: 'Operations lead', Company: 'Fernway' },
          ],
        },
      ],
    },
    {
      id: 'deals',
      title: 'Deals',
      blurb: 'Deals by stage, with values, owners and close dates',
      space: 'Deals',
      icon: 'lucide:dollar-sign',
      work: 'Sales pipeline',
      category: 'sales',
      details: 'For a sales team forecasting the month.',
      like: 'Like Pipedrive',
      featured: false,
      tables: (m) => [
        {
          name: 'Deals',
          icon: 'lucide:dollar-sign',
          fields: [
            { name: 'Stage', type: 'workflow', states: [
              state('Qualified', 'not-started', 'slate', true),
              state('Demo', 'in-progress', 'blue'),
              state('Proposal', 'in-progress', 'purple'),
              state('Negotiation', 'in-progress', 'amber'),
              state('Won', 'done', 'green'),
              state('Lost', 'canceled', 'red'),
            ] },
            { name: 'Value', type: 'number', ...money },
            { name: 'Close date', type: 'date' },
            { name: 'Company', type: 'text' },
            { name: 'Owner', type: 'relation', to: 'Reps', cardinality: 'many-to-one', inverseName: 'Deals' },
          ],
          rows: [
            { Name: 'Northwind team plan', Stage: 'Proposal', Value: 12000, 'Close date': m.after(14), Company: 'Northwind', Owner: 'Carmen Lopez' },
            { Name: 'Blue Fern renewal', Stage: 'Negotiation', Value: 8400, 'Close date': m.after(6), Company: 'Blue Fern', Owner: 'Theo Nash' },
            { Name: 'Harbor Labs pilot', Value: 3000, 'Close date': m.after(30), Company: 'Harbor Labs', Owner: 'Carmen Lopez' },
          ],
        },
        {
          name: 'Activities',
          icon: 'lucide:phone-call',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Kind', type: 'select', options: ['Call', 'Email', 'Meeting'] },
            { name: 'Deal', type: 'relation', to: 'Deals', cardinality: 'many-to-one', inverseName: 'Activities' },
          ],
          rows: [
            { Name: 'Discovery call', Date: m.after(-9), Kind: 'Call', Deal: 'Northwind team plan' },
            { Name: 'Sent the proposal', Date: m.after(-2), Kind: 'Email', Deal: 'Northwind team plan' },
            { Name: 'Pricing review', Date: m.after(1), Kind: 'Meeting', Deal: 'Blue Fern renewal' },
          ],
        },
        {
          name: 'Reps',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Pipeline', type: 'rollup', relationField: 'Deals', targetField: 'Value', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Carmen Lopez', Email: 'carmen@example.com' },
            { Name: 'Theo Nash', Email: 'theo@example.com' },
          ],
        },
      ],
    },
    {
      id: 'campaigns',
      title: 'Campaigns',
      blurb: 'Campaigns with budgets, placements and clicks',
      space: 'Campaigns',
      icon: 'lucide:send',
      work: 'Marketing campaigns',
      category: 'marketing',
      details: 'For a marketer comparing where the money went.',
      like: 'Like monday.com',
      featured: false,
      tables: (m) => [
        {
          name: 'Campaigns',
          icon: 'lucide:send',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Planning', 'not-started', 'slate', true),
              state('Live', 'in-progress', 'green'),
              state('Paused', 'in-progress', 'amber'),
              state('Ended', 'done', 'blue'),
            ] },
            { name: 'Start', type: 'date' },
            { name: 'End', type: 'date' },
            { name: 'Budget', type: 'number', ...money },
            { name: 'Spent', type: 'rollup', relationField: 'Placements', targetField: 'Cost', aggregate: 'sum' },
            { name: 'Clicks', type: 'rollup', relationField: 'Placements', targetField: 'Clicks', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Spring sale', Status: 'Live', Start: m.after(-5), End: m.after(10), Budget: 4000 },
            { Name: 'Webinar sign-ups', Start: m.after(12), End: m.after(26), Budget: 1500 },
          ],
        },
        {
          name: 'Placements',
          icon: 'lucide:chart-bar',
          fields: [
            { name: 'Channel', type: 'select', options: ['Search', 'Social', 'Email', 'Podcast'] },
            { name: 'Cost', type: 'number', ...money },
            { name: 'Clicks', type: 'number' },
            { name: 'Campaign', type: 'relation', to: 'Campaigns', cardinality: 'many-to-one', inverseName: 'Placements' },
          ],
          rows: [
            { Name: 'Search ads', Channel: 'Search', Cost: 900, Clicks: 1240, Campaign: 'Spring sale' },
            { Name: 'Newsletter feature', Channel: 'Email', Cost: 250, Clicks: 310, Campaign: 'Spring sale' },
            { Name: 'Podcast spot', Channel: 'Podcast', Cost: 600, Campaign: 'Webinar sign-ups' },
          ],
        },
      ],
    },
    {
      id: 'social',
      title: 'Social',
      blurb: 'Posts by account, with reach and likes',
      space: 'Social',
      icon: 'lucide:camera',
      work: 'Social media',
      category: 'marketing',
      details: 'For a small brand running a few social accounts.',
      like: 'Like Buffer',
      featured: false,
      tables: (m) => [
        {
          name: 'Posts',
          icon: 'lucide:image',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Draft', 'not-started', 'slate', true),
              state('Scheduled', 'in-progress', 'blue'),
              state('Posted', 'done', 'green'),
            ] },
            { name: 'Post date', type: 'date' },
            { name: 'Reach', type: 'number' },
            { name: 'Likes', type: 'number' },
            { name: 'Account', type: 'relation', to: 'Accounts', cardinality: 'many-to-one', inverseName: 'Posts' },
          ],
          rows: [
            { Name: 'New menu reveal', Status: 'Posted', 'Post date': m.after(-4), Reach: 2300, Likes: 180, Account: 'Bakery photos' },
            { Name: 'Hiring a pastry chef', Status: 'Scheduled', 'Post date': m.after(2), Account: 'Bakery page' },
            { Name: 'Behind the counter clip', 'Post date': m.after(6), Account: 'Bakery photos' },
          ],
        },
        {
          name: 'Accounts',
          icon: 'lucide:users',
          fields: [
            { name: 'Platform', type: 'select', options: ['Photos', 'Video', 'Professional', 'Forum'] },
            { name: 'Followers', type: 'number' },
            { name: 'Total reach', type: 'rollup', relationField: 'Posts', targetField: 'Reach', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Bakery photos', Platform: 'Photos', Followers: 4100 },
            { Name: 'Bakery page', Platform: 'Professional', Followers: 650 },
          ],
        },
      ],
    },
    {
      id: 'onboarding',
      title: 'Onboarding',
      blurb: 'New hires and the steps to get them started',
      space: 'Onboarding',
      icon: 'lucide:user-cog',
      work: 'Employee onboarding',
      category: 'people',
      details: 'For a manager getting a new hire ready for day one.',
      like: 'Like BambooHR',
      featured: false,
      tables: (m) => [
        {
          name: 'New hires',
          icon: 'lucide:user-plus',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Start date', type: 'date' },
            { name: 'Team', type: 'select', options: ['Design', 'Engineering', 'Sales', 'Support'] },
            { name: 'Manager', type: 'text' },
            { name: 'Step count', type: 'rollup', relationField: 'Steps', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Ines Moreau', Email: 'ines@example.com', 'Start date': m.after(7), Team: 'Design', Manager: 'Sam Lee' },
            { Name: 'Kofi Mensah', Email: 'kofi@example.com', 'Start date': m.after(14), Team: 'Engineering', Manager: 'Lin Wu' },
          ],
        },
        {
          name: 'Steps',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('To do', 'not-started', 'slate', true),
              state('In progress', 'in-progress', 'blue'),
              state('Done', 'done', 'green'),
            ] },
            { name: 'Owner', type: 'select', options: ['Manager', 'IT', 'People team'] },
            { name: 'Due', type: 'date' },
            { name: 'New hire', type: 'relation', to: 'New hires', cardinality: 'many-to-one', inverseName: 'Steps' },
          ],
          rows: [
            { Name: 'Order a laptop', Status: 'Done', Owner: 'IT', Due: m.after(2), 'New hire': 'Ines Moreau' },
            { Name: 'Set up accounts', Status: 'In progress', Owner: 'IT', Due: m.after(6), 'New hire': 'Ines Moreau' },
            { Name: 'Plan the first week', Owner: 'Manager', Due: m.after(10), 'New hire': 'Kofi Mensah' },
          ],
        },
      ],
    },
    {
      id: 'time-off',
      title: 'Time off',
      blurb: 'Leave requests by person, with days taken',
      space: 'Time off',
      icon: 'lucide:sun',
      work: 'Time off and leave',
      category: 'people',
      details: 'For a small team keeping vacation and leave in one place.',
      like: 'Like Timetastic',
      featured: false,
      tables: (m) => [
        {
          name: 'Requests',
          icon: 'lucide:calendar-range',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Requested', 'not-started', 'blue', true),
              state('Approved', 'done', 'green'),
              state('Declined', 'canceled', 'red'),
            ] },
            { name: 'Kind', type: 'select', options: ['Vacation', 'Sick', 'Personal', 'Parental'] },
            { name: 'Start', type: 'date' },
            { name: 'End', type: 'date' },
            { name: 'Days', type: 'number' },
            { name: 'Person', type: 'relation', to: 'Team', cardinality: 'many-to-one', inverseName: 'Requests' },
          ],
          rows: [
            { Name: 'Ana: summer trip', Status: 'Approved', Kind: 'Vacation', Start: m.after(20), End: m.after(24), Days: 5, Person: 'Ana Ruiz' },
            { Name: 'Ben: flu', Status: 'Approved', Kind: 'Sick', Start: m.after(-8), End: m.after(-7), Days: 2, Person: 'Ben Ito' },
            { Name: 'Ben: moving day', Kind: 'Personal', Start: m.after(12), End: m.after(12), Days: 1, Person: 'Ben Ito' },
          ],
        },
        {
          name: 'Team',
          icon: 'lucide:users',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Allowance', type: 'number' },
            { name: 'Days taken', type: 'rollup', relationField: 'Requests', targetField: 'Days', aggregate: 'sum' },
            { name: 'Days left', type: 'formula', expression: 'Allowance - [Days taken]' },
          ],
          rows: [
            { Name: 'Ana Ruiz', Email: 'ana@example.com', Allowance: 20 },
            { Name: 'Ben Ito', Email: 'ben@example.com', Allowance: 20 },
          ],
        },
      ],
    },
    {
      id: 'expenses',
      title: 'Expenses',
      blurb: 'Expense claims by person and category, with approvals',
      space: 'Expenses',
      icon: 'lucide:receipt',
      work: 'Business expenses',
      category: 'finance',
      details: 'For a small company paying people back for work costs.',
      like: 'Like Expensify',
      featured: false,
      tables: (m) => [
        {
          name: 'Expenses',
          icon: 'lucide:receipt',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Submitted', 'not-started', 'blue', true),
              state('Approved', 'in-progress', 'amber'),
              state('Paid back', 'done', 'green'),
              state('Rejected', 'canceled', 'red'),
            ] },
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Category', type: 'select', options: ['Travel', 'Meals', 'Software', 'Office'] },
            { name: 'Spender', type: 'relation', to: 'Staff', cardinality: 'many-to-one', inverseName: 'Expenses' },
          ],
          rows: [
            { Name: 'Train to the client site', Status: 'Approved', Amount: 84, Date: m.after(-6), Category: 'Travel', Spender: 'Priya Shah' },
            { Name: 'Team lunch', Amount: 126.4, Date: m.after(-1), Category: 'Meals', Spender: 'Marco Bell' },
            { Name: 'Design tool for one month', Status: 'Paid back', Amount: 15, Date: m.after(-12), Category: 'Software', Spender: 'Priya Shah' },
          ],
        },
        {
          name: 'Staff',
          icon: 'lucide:users',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Claimed', type: 'rollup', relationField: 'Expenses', targetField: 'Amount', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Priya Shah', Email: 'priya@example.com' },
            { Name: 'Marco Bell', Email: 'marco@example.com' },
          ],
        },
      ],
    },
    {
      id: 'budgets',
      title: 'Budgets',
      blurb: 'Budgets by team, with spending and what remains',
      space: 'Budgets',
      icon: 'lucide:chart-pie',
      work: 'Team budgets',
      category: 'finance',
      details: 'For a finance lead watching team spend through the quarter.',
      like: 'Like a budget spreadsheet',
      featured: false,
      tables: (m) => [
        {
          name: 'Budgets',
          icon: 'lucide:chart-pie',
          fields: [
            { name: 'Status', type: 'select', options: [opt('On budget', 'green'), opt('Watch', 'amber'), opt('Over', 'red')] },
            { name: 'Quarter', type: 'select', options: ['Q1', 'Q2', 'Q3', 'Q4'] },
            { name: 'Amount', type: 'number', ...money },
            { name: 'Spent', type: 'rollup', relationField: 'Spending', targetField: 'Amount', aggregate: 'sum' },
            { name: 'Remaining', type: 'formula', expression: 'Amount - Spent', ...money },
          ],
          rows: [
            { Name: 'Marketing Q4', Status: 'Watch', Quarter: 'Q4', Amount: 15000 },
            { Name: 'Engineering tools Q4', Status: 'On budget', Quarter: 'Q4', Amount: 6000 },
          ],
        },
        {
          name: 'Spending',
          icon: 'lucide:coins',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Vendor', type: 'text' },
            { name: 'Budget', type: 'relation', to: 'Budgets', cardinality: 'many-to-one', inverseName: 'Spending' },
          ],
          rows: [
            { Name: 'Conference booth', Amount: 4200, Date: m.after(-10), Vendor: 'Expo Hall Co', Budget: 'Marketing Q4' },
            { Name: 'Ad credits', Amount: 1800, Date: m.after(-4), Vendor: 'Search ads', Budget: 'Marketing Q4' },
            { Name: 'Cloud hosting', Amount: 950, Date: m.after(-2), Vendor: 'Cloud host', Budget: 'Engineering tools Q4' },
          ],
        },
      ],
    },
    {
      id: 'assets',
      title: 'Assets',
      blurb: 'Assets by holder, cost and warranty',
      space: 'Assets',
      icon: 'lucide:cpu',
      work: 'Equipment and assets',
      category: 'operations',
      details: 'For an office or IT lead tracking who has what.',
      like: 'Like Snipe-IT',
      featured: false,
      tables: (m) => [
        {
          name: 'Assets',
          icon: 'lucide:cpu',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('In stock', 'not-started', 'slate', true),
              state('In use', 'in-progress', 'blue'),
              state('In repair', 'in-progress', 'amber'),
              state('Retired', 'done', 'red'),
            ] },
            { name: 'Serial', type: 'text' },
            { name: 'Cost', type: 'number', ...money },
            { name: 'Purchased', type: 'date' },
            { name: 'Warranty ends', type: 'date' },
            { name: 'Holder', type: 'relation', to: 'Staff', cardinality: 'many-to-one', inverseName: 'Assets' },
          ],
          rows: [
            { Name: 'Laptop 14 inch', Status: 'In use', Serial: 'LT-2041', Cost: 1899, Purchased: m.after(-200), 'Warranty ends': m.after(530), Holder: 'Lin Wu' },
            { Name: 'Monitor 27 inch', Status: 'In use', Serial: 'MN-0710', Cost: 329, Purchased: m.after(-90), 'Warranty ends': m.after(275), Holder: 'Sam Lee' },
            { Name: 'Spare laptop', Serial: 'LT-1988', Cost: 1599, Purchased: m.after(-400), 'Warranty ends': m.after(330) },
          ],
        },
        {
          name: 'Staff',
          icon: 'lucide:users',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Team', type: 'select', options: ['Design', 'Engineering', 'Operations'] },
            { name: 'Asset count', type: 'rollup', relationField: 'Assets', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Lin Wu', Email: 'lin@example.com', Team: 'Engineering' },
            { Name: 'Sam Lee', Email: 'sam@example.com', Team: 'Design' },
          ],
        },
      ],
    },
    {
      id: 'vendors',
      title: 'Vendors',
      blurb: 'Vendors and purchase orders, with spend per vendor',
      space: 'Vendors',
      icon: 'lucide:shopping-cart',
      work: 'Vendors and purchasing',
      category: 'operations',
      details: 'For an operations lead buying supplies.',
      like: 'Like Procurify',
      featured: false,
      tables: (m) => [
        {
          name: 'Vendors',
          icon: 'lucide:briefcase',
          fields: [
            { name: 'Category', type: 'select', options: ['Packaging', 'Shipping', 'Office', 'Software'] },
            { name: 'Email', type: 'email' },
            { name: 'Website', type: 'url' },
            { name: 'Spend', type: 'rollup', relationField: 'Purchase orders', targetField: 'Amount', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Boxwell Packaging', Category: 'Packaging', Email: 'orders@example.com', Website: 'https://example.com' },
            { Name: 'Swift Freight', Category: 'Shipping', Email: 'ops@example.com' },
          ],
        },
        {
          name: 'Purchase orders',
          icon: 'lucide:receipt',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Draft', 'not-started', 'slate', true),
              state('Sent', 'in-progress', 'blue'),
              state('Received', 'done', 'green'),
              state('Canceled', 'canceled', 'red'),
            ] },
            { name: 'Amount', type: 'number', ...money },
            { name: 'Ordered', type: 'date' },
            { name: 'Expected', type: 'date' },
            { name: 'Vendor', type: 'relation', to: 'Vendors', cardinality: 'many-to-one', inverseName: 'Purchase orders' },
          ],
          rows: [
            { Name: 'PO-1041', Status: 'Received', Amount: 640, Ordered: m.after(-14), Expected: m.after(-4), Vendor: 'Boxwell Packaging' },
            { Name: 'PO-1042', Status: 'Sent', Amount: 1250, Ordered: m.after(-2), Expected: m.after(9), Vendor: 'Swift Freight' },
            { Name: 'PO-1043', Amount: 380, Vendor: 'Boxwell Packaging' },
          ],
        },
      ],
    },
    {
      id: 'bookings',
      title: 'Bookings',
      blurb: 'Appointments by client and service, with prices',
      space: 'Bookings',
      icon: 'lucide:clock',
      work: 'Appointments and bookings',
      category: 'services',
      details: 'For a salon, studio or practice that books by the hour.',
      like: 'Like Acuity Scheduling',
      featured: false,
      tables: (m) => [
        {
          name: 'Appointments',
          icon: 'lucide:clock',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Booked', 'not-started', 'blue', true),
              state('Confirmed', 'in-progress', 'purple'),
              state('Completed', 'done', 'green'),
              state('No show', 'canceled', 'red'),
            ] },
            { name: 'Date', type: 'date' },
            { name: 'Paid', type: 'checkbox' },
            { name: 'Client', type: 'relation', to: 'Clients', cardinality: 'many-to-one', inverseName: 'Appointments' },
            { name: 'Service', type: 'relation', to: 'Services', cardinality: 'many-to-one', inverseName: 'Appointments' },
          ],
          rows: [
            { Name: 'Jun: haircut', Status: 'Confirmed', Date: m.after(1), Client: 'Jun Tanaka', Service: 'Haircut' },
            { Name: 'Ruth: color', Date: m.after(4), Client: 'Ruth Adeyemi', Service: 'Color' },
            { Name: 'Jun: trim', Status: 'Completed', Date: m.after(-20), Paid: true, Client: 'Jun Tanaka', Service: 'Haircut' },
          ],
        },
        {
          name: 'Services',
          icon: 'lucide:list',
          fields: [
            { name: 'Price', type: 'number', ...money },
            { name: 'Minutes', type: 'number' },
          ],
          rows: [
            { Name: 'Haircut', Price: 45, Minutes: 45 },
            { Name: 'Color', Price: 120, Minutes: 90 },
          ],
        },
        {
          name: 'Clients',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Phone', type: 'text' },
            { name: 'Visits', type: 'rollup', relationField: 'Appointments', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Jun Tanaka', Email: 'jun@example.com', Phone: '555-0142' },
            { Name: 'Ruth Adeyemi', Email: 'ruth@example.com', Phone: '555-0177' },
          ],
        },
      ],
    },
    {
      id: 'rentals',
      title: 'Rentals',
      blurb: 'Properties, tenants and rent payments',
      space: 'Rentals',
      icon: 'lucide:key-round',
      work: 'Rental properties',
      category: 'services',
      details: 'For a landlord with a few units.',
      like: 'Like Buildium',
      featured: false,
      tables: (m) => [
        {
          name: 'Properties',
          icon: 'lucide:house',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Occupied', 'green'), opt('Vacant', 'amber'), opt('Under repair', 'red')] },
            { name: 'Address', type: 'text' },
            { name: 'Monthly rent', type: 'number', ...money },
            { name: 'Collected', type: 'rollup', relationField: 'Payments', targetField: 'Amount', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Elm Street unit 2', Status: 'Occupied', Address: '14 Elm Street', 'Monthly rent': 1650 },
            { Name: 'Birch Lane cottage', Status: 'Vacant', Address: '7 Birch Lane', 'Monthly rent': 2100 },
          ],
        },
        {
          name: 'Tenants',
          icon: 'lucide:users',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Lease ends', type: 'date' },
            { name: 'Property', type: 'relation', to: 'Properties', cardinality: 'many-to-one', inverseName: 'Tenants' },
          ],
          rows: [
            { Name: 'Lucy Grant', Email: 'lucy@example.com', 'Lease ends': m.after(180), Property: 'Elm Street unit 2' },
            { Name: 'Owen Price', Email: 'owen@example.com', 'Lease ends': m.after(180), Property: 'Elm Street unit 2' },
          ],
        },
        {
          name: 'Payments',
          icon: 'lucide:coins',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Due'), opt('Paid', 'green'), opt('Late', 'red')] },
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Property', type: 'relation', to: 'Properties', cardinality: 'many-to-one', inverseName: 'Payments' },
          ],
          rows: [
            { Name: 'Rent this month', Status: 'Paid', Amount: 1650, Date: m.on(1), Property: 'Elm Street unit 2' },
            { Name: 'Rent last month', Status: 'Paid', Amount: 1650, Date: m.after(-30), Property: 'Elm Street unit 2' },
          ],
        },
      ],
    },
    {
      id: 'volunteers',
      title: 'Volunteers',
      blurb: 'Volunteers, shifts and the hours they give',
      space: 'Volunteers',
      icon: 'lucide:users-round',
      work: 'Volunteer programs',
      category: 'community',
      details: 'For a group that runs on volunteers.',
      like: 'Like SignUpGenius',
      featured: false,
      tables: (m) => [
        {
          name: 'Shifts',
          icon: 'lucide:calendar',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Role', type: 'select', options: ['Front desk', 'Kitchen', 'Driver', 'Setup'] },
            { name: 'Spots', type: 'number' },
            { name: 'Signed up', type: 'rollup', relationField: 'Sign-ups', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Saturday kitchen', Date: m.after(3), Role: 'Kitchen', Spots: 4 },
            { Name: 'Food bank deliveries', Date: m.after(5), Role: 'Driver', Spots: 2 },
          ],
        },
        {
          name: 'Sign-ups',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Signed up', 'not-started', 'blue', true),
              state('Attended', 'done', 'green'),
              state('No show', 'canceled', 'red'),
            ] },
            { name: 'Hours', type: 'number' },
            { name: 'Volunteer', type: 'relation', to: 'Volunteers', cardinality: 'many-to-one', inverseName: 'Sign-ups' },
            { name: 'Shift', type: 'relation', to: 'Shifts', cardinality: 'many-to-one', inverseName: 'Sign-ups' },
          ],
          rows: [
            { Name: 'Grace in the kitchen', Volunteer: 'Grace Holt', Shift: 'Saturday kitchen' },
            { Name: 'Diego on deliveries', Volunteer: 'Diego Ramos', Shift: 'Food bank deliveries' },
            { Name: 'Grace last Saturday', Status: 'Attended', Hours: 3, Volunteer: 'Grace Holt', Shift: 'Saturday kitchen' },
          ],
        },
        {
          name: 'Volunteers',
          icon: 'lucide:user',
          fields: [
            { name: 'Email', type: 'email' },
            { name: 'Skill', type: 'select', options: ['Cooking', 'Driving', 'Teaching'] },
            { name: 'Hours given', type: 'rollup', relationField: 'Sign-ups', targetField: 'Hours', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Grace Holt', Email: 'grace@example.com', Skill: 'Cooking' },
            { Name: 'Diego Ramos', Email: 'diego@example.com', Skill: 'Driving' },
          ],
        },
      ],
    },
    {
      id: 'members',
      title: 'Members',
      blurb: 'Members, tiers and dues for a club or group',
      space: 'Members',
      icon: 'lucide:id-card',
      work: 'Clubs and memberships',
      category: 'community',
      details: 'For a club or association collecting dues.',
      like: 'Like Wild Apricot',
      featured: false,
      tables: (m) => [
        {
          name: 'Members',
          icon: 'lucide:id-card',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Active', 'green'), opt('Lapsed', 'amber'), opt('Left')] },
            { name: 'Email', type: 'email' },
            { name: 'Joined', type: 'date' },
            { name: 'Tier', type: 'select', options: ['Standard', 'Family', 'Student'] },
            { name: 'Dues paid', type: 'rollup', relationField: 'Dues', targetField: 'Amount', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Hana Sato', Status: 'Active', Email: 'hana@example.com', Joined: m.after(-400), Tier: 'Family' },
            { Name: 'Leo Grant', Status: 'Active', Email: 'leo@example.com', Joined: m.after(-90), Tier: 'Standard' },
            { Name: 'Kim Diaz', Status: 'Lapsed', Email: 'kim@example.com', Joined: m.after(-500), Tier: 'Student' },
          ],
        },
        {
          name: 'Dues',
          icon: 'lucide:coins',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Member', type: 'relation', to: 'Members', cardinality: 'many-to-one', inverseName: 'Dues' },
          ],
          rows: [
            { Name: 'Hana: yearly dues', Amount: 120, Date: m.after(-30), Member: 'Hana Sato' },
            { Name: 'Leo: yearly dues', Amount: 80, Date: m.after(-60), Member: 'Leo Grant' },
          ],
        },
      ],
    },
    {
      id: 'subscriptions',
      title: 'Subscriptions',
      blurb: 'Subscriptions by cost, renewal date and card',
      space: 'Subscriptions',
      icon: 'lucide:refresh-cw',
      work: 'Subscriptions and renewals',
      category: 'money',
      details: 'For anyone who wants to catch a renewal before it bills.',
      like: 'Like Rocket Money',
      featured: false,
      tables: (m) => [
        {
          name: 'Subscriptions',
          icon: 'lucide:refresh-cw',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Active', 'green'), opt('Trial', 'blue'), opt('Canceled')] },
            { name: 'Cost', type: 'number', ...money },
            { name: 'Billing', type: 'select', options: ['Monthly', 'Yearly'] },
            { name: 'Renews', type: 'date' },
            { name: 'Paid with', type: 'relation', to: 'Cards', cardinality: 'many-to-one', inverseName: 'Subscriptions' },
          ],
          rows: [
            { Name: 'Music streaming', Status: 'Active', Cost: 11.99, Billing: 'Monthly', Renews: m.after(9), 'Paid with': 'Travel card' },
            { Name: 'Cloud storage', Status: 'Active', Cost: 29.99, Billing: 'Yearly', Renews: m.after(120), 'Paid with': 'Everyday debit' },
            { Name: 'Meal kit', Status: 'Trial', Cost: 59.94, Billing: 'Monthly', Renews: m.after(3), 'Paid with': 'Travel card' },
          ],
        },
        {
          name: 'Cards',
          icon: 'lucide:credit-card',
          fields: [
            { name: 'Kind', type: 'select', options: ['Credit', 'Debit'] },
            { name: 'Charged', type: 'rollup', relationField: 'Subscriptions', targetField: 'Cost', aggregate: 'sum' },
          ],
          rows: [
            { Name: 'Travel card', Kind: 'Credit' },
            { Name: 'Everyday debit', Kind: 'Debit' },
          ],
        },
      ],
    },
    {
      id: 'savings',
      title: 'Savings',
      blurb: 'Savings goals and the deposits toward each',
      space: 'Savings',
      icon: 'lucide:coins',
      work: 'Savings goals',
      category: 'money',
      details: 'For a person or household saving for something specific.',
      like: 'Like Qapital',
      featured: false,
      tables: (m) => [
        {
          name: 'Goals',
          icon: 'lucide:star',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Saving', 'blue'), opt('Paused', 'amber'), opt('Reached', 'green')] },
            { name: 'Target', type: 'number', ...money },
            { name: 'Target date', type: 'date' },
            { name: 'Saved', type: 'rollup', relationField: 'Deposits', targetField: 'Amount', aggregate: 'sum' },
            { name: 'To go', type: 'formula', expression: 'Target - Saved', ...money },
          ],
          rows: [
            { Name: 'Emergency fund', Status: 'Saving', Target: 6000, 'Target date': m.after(240) },
            { Name: 'Trip to the coast', Status: 'Saving', Target: 2400, 'Target date': m.after(150) },
          ],
        },
        {
          name: 'Deposits',
          icon: 'lucide:coins',
          fields: [
            { name: 'Amount', type: 'number', ...money },
            { name: 'Date', type: 'date' },
            { name: 'Goal', type: 'relation', to: 'Goals', cardinality: 'many-to-one', inverseName: 'Deposits' },
          ],
          rows: [
            { Name: 'First paycheck transfer', Amount: 300, Date: m.on(1), Goal: 'Emergency fund' },
            { Name: 'Birthday money', Amount: 150, Date: m.after(-12), Goal: 'Trip to the coast' },
            { Name: 'Second paycheck transfer', Amount: 300, Date: m.on(15), Goal: 'Emergency fund' },
          ],
        },
      ],
    },
    {
      id: 'habits',
      title: 'Habits',
      blurb: 'Habits and daily check-ins, counted per habit',
      space: 'Habits',
      icon: 'lucide:sun-moon',
      work: 'Daily habits',
      category: 'home',
      details: 'For a person building a routine day by day.',
      like: 'Like Streaks',
      featured: false,
      tables: (m) => [
        {
          name: 'Habits',
          icon: 'lucide:sun-moon',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Active', 'green'), opt('Paused')] },
            { name: 'Area', type: 'select', options: ['Health', 'Mind', 'Home', 'Work'] },
            { name: 'Days per week', type: 'number' },
            { name: 'Check-in count', type: 'rollup', relationField: 'Check-ins', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Read 20 pages', Status: 'Active', Area: 'Mind', 'Days per week': 5 },
            { Name: 'Walk after lunch', Status: 'Active', Area: 'Health', 'Days per week': 7 },
            { Name: 'No phone in bed', Status: 'Paused', Area: 'Health', 'Days per week': 7 },
          ],
        },
        {
          name: 'Check-ins',
          icon: 'lucide:square-check',
          fields: [
            { name: 'Date', type: 'date' },
            { name: 'Done', type: 'checkbox' },
            { name: 'Note', type: 'text' },
            { name: 'Habit', type: 'relation', to: 'Habits', cardinality: 'many-to-one', inverseName: 'Check-ins' },
          ],
          rows: [
            { Name: 'Read today', Date: m.after(0), Done: true, Habit: 'Read 20 pages' },
            { Name: 'Walk yesterday', Date: m.after(-1), Done: true, Note: 'Rained, walked indoors', Habit: 'Walk after lunch' },
            { Name: 'Read yesterday', Date: m.after(-1), Habit: 'Read 20 pages' },
          ],
        },
      ],
    },
    {
      id: 'workouts',
      title: 'Workouts',
      blurb: 'Workouts and sets, with reps and weight',
      space: 'Workouts',
      icon: 'lucide:activity',
      work: 'Fitness and workouts',
      category: 'home',
      details: 'For anyone logging training to see progress.',
      like: 'Like Strong',
      featured: false,
      tables: (m) => [
        {
          name: 'Workouts',
          icon: 'lucide:activity',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Planned', 'blue'), opt('Done', 'green'), opt('Skipped', 'red')] },
            { name: 'Date', type: 'date' },
            { name: 'Kind', type: 'select', options: ['Strength', 'Cardio', 'Mobility'] },
            { name: 'Minutes', type: 'number' },
            { name: 'Feel', type: 'rating', max: 5 },
            { name: 'Set count', type: 'rollup', relationField: 'Sets', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Leg day', Status: 'Done', Date: m.after(-2), Kind: 'Strength', Minutes: 50, Feel: 4 },
            { Name: 'Easy run', Status: 'Done', Date: m.after(-1), Kind: 'Cardio', Minutes: 30, Feel: 3 },
            { Name: 'Upper body', Status: 'Planned', Date: m.after(1), Kind: 'Strength' },
          ],
        },
        {
          name: 'Sets',
          icon: 'lucide:list',
          fields: [
            { name: 'Exercise', type: 'select', options: ['Squat', 'Bench press', 'Deadlift', 'Row'] },
            { name: 'Reps', type: 'number' },
            { name: 'Weight', type: 'number' },
            { name: 'Workout', type: 'relation', to: 'Workouts', cardinality: 'many-to-one', inverseName: 'Sets' },
          ],
          rows: [
            { Name: 'Squat, first set', Exercise: 'Squat', Reps: 8, Weight: 135, Workout: 'Leg day' },
            { Name: 'Squat, second set', Exercise: 'Squat', Reps: 8, Weight: 145, Workout: 'Leg day' },
            { Name: 'Deadlift, first set', Exercise: 'Deadlift', Reps: 5, Weight: 185, Workout: 'Leg day' },
          ],
        },
      ],
    },
    {
      id: 'recipes',
      title: 'Recipes',
      blurb: 'Recipes and a weekly meal plan',
      space: 'Recipes',
      icon: 'lucide:clipboard',
      work: 'Recipes and meal plans',
      category: 'home',
      details: 'For a household planning the week of cooking.',
      like: 'Like Paprika',
      featured: false,
      tables: (m) => [
        {
          name: 'Recipes',
          icon: 'lucide:file-text',
          fields: [
            { name: 'Cuisine', type: 'select', options: ['Italian', 'Mexican', 'Thai', 'Everyday'] },
            { name: 'Minutes', type: 'number' },
            { name: 'Servings', type: 'number' },
            { name: 'Rating', type: 'rating', max: 5 },
            { name: 'Link', type: 'url' },
            { name: 'Times planned', type: 'rollup', relationField: 'Meals', aggregate: 'count' },
          ],
          rows: [
            { Name: 'Lemon pasta', Cuisine: 'Italian', Minutes: 25, Servings: 4, Rating: 5, Link: 'https://example.com/lemon-pasta' },
            { Name: 'Black bean tacos', Cuisine: 'Mexican', Minutes: 30, Servings: 4, Rating: 4 },
            { Name: 'Green curry', Cuisine: 'Thai', Minutes: 40, Servings: 4 },
          ],
        },
        {
          name: 'Meals',
          icon: 'lucide:calendar',
          fields: [
            { name: 'Status', type: 'select', options: [opt('Planned', 'blue'), opt('Cooked', 'green'), opt('Skipped')] },
            { name: 'Date', type: 'date' },
            { name: 'Meal', type: 'select', options: ['Breakfast', 'Lunch', 'Dinner'] },
            { name: 'Recipe', type: 'relation', to: 'Recipes', cardinality: 'many-to-one', inverseName: 'Meals' },
          ],
          rows: [
            { Name: 'Tonight', Status: 'Planned', Date: m.after(0), Meal: 'Dinner', Recipe: 'Lemon pasta' },
            { Name: 'Tomorrow night', Status: 'Planned', Date: m.after(1), Meal: 'Dinner', Recipe: 'Black bean tacos' },
            { Name: 'Last night', Status: 'Cooked', Date: m.after(-1), Meal: 'Dinner', Recipe: 'Green curry' },
          ],
        },
      ],
    },
    {
      id: 'courses',
      title: 'Courses',
      blurb: 'Courses, assignments and grades for a term',
      space: 'Courses',
      icon: 'lucide:award',
      work: 'School and courses',
      category: 'learning',
      details: 'For a student keeping homework and exams on track.',
      like: 'Like MyStudyLife',
      featured: false,
      tables: (m) => [
        {
          name: 'Courses',
          icon: 'lucide:award',
          fields: [
            { name: 'Teacher', type: 'text' },
            { name: 'Term', type: 'select', options: ['Fall', 'Spring', 'Summer'] },
            { name: 'Credits', type: 'number' },
            { name: 'Average grade', type: 'rollup', relationField: 'Assignments', targetField: 'Grade', aggregate: 'avg' },
          ],
          rows: [
            { Name: 'Biology 101', Teacher: 'Ms. Ames', Term: 'Fall', Credits: 4 },
            { Name: 'Statistics', Teacher: 'Mr. Lund', Term: 'Fall', Credits: 3 },
          ],
        },
        {
          name: 'Assignments',
          icon: 'lucide:file-text',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Not started', 'not-started', 'slate', true),
              state('Working', 'in-progress', 'blue'),
              state('Submitted', 'in-progress', 'amber'),
              state('Graded', 'done', 'green'),
            ] },
            { name: 'Due', type: 'date' },
            { name: 'Grade', type: 'number' },
            { name: 'Course', type: 'relation', to: 'Courses', cardinality: 'many-to-one', inverseName: 'Assignments' },
          ],
          rows: [
            { Name: 'Cell structure lab report', Status: 'Submitted', Due: m.after(-1), Course: 'Biology 101' },
            { Name: 'Problem set 3', Status: 'Working', Due: m.after(4), Course: 'Statistics' },
            { Name: 'Midterm', Status: 'Graded', Due: m.after(-10), Grade: 88, Course: 'Biology 101' },
          ],
        },
      ],
    },
    {
      id: 'reading',
      title: 'Reading',
      blurb: 'Books by status, author and rating',
      space: 'Reading',
      icon: 'lucide:star',
      work: 'Reading list',
      category: 'learning',
      details: 'For a reader keeping track of what to read next.',
      like: 'Like Goodreads',
      featured: false,
      tables: (m) => [
        {
          name: 'Books',
          icon: 'lucide:bookmark',
          fields: [
            { name: 'Status', type: 'workflow', states: [
              state('Want to read', 'not-started', 'slate', true),
              state('Reading', 'in-progress', 'blue'),
              state('Finished', 'done', 'green'),
              state('Gave up', 'canceled', 'red'),
            ] },
            { name: 'Genre', type: 'select', options: ['Fiction', 'Nonfiction', 'Poetry'] },
            { name: 'Pages', type: 'number' },
            { name: 'Finished on', type: 'date' },
            { name: 'Rating', type: 'rating', max: 5 },
            { name: 'Author', type: 'relation', to: 'Authors', cardinality: 'many-to-one', inverseName: 'Books' },
          ],
          rows: [
            { Name: 'The lighthouse year', Status: 'Finished', Genre: 'Fiction', Pages: 320, 'Finished on': m.after(-5), Rating: 4, Author: 'Mara Quill' },
            { Name: 'Field notes on rivers', Status: 'Reading', Genre: 'Nonfiction', Pages: 240, Author: 'Tobias Fenn' },
            { Name: 'A map of small towns', Genre: 'Fiction', Pages: 280, Author: 'Mara Quill' },
          ],
        },
        {
          name: 'Authors',
          icon: 'lucide:user',
          fields: [
            { name: 'Book count', type: 'rollup', relationField: 'Books', aggregate: 'count' },
          ],
          rows: [{ Name: 'Mara Quill' }, { Name: 'Tobias Fenn' }],
        },
      ],
    },
  ];

  function searchText(template) {
    const category = CATEGORIES.find((c) => c.id === template.category)?.label ?? '';
    const tables = template.tables(month()).map((t) => t.name);
    return [template.title, template.work, template.blurb, template.details, template.like, category, ...tables].filter(Boolean).join(' ').toLowerCase();
  }

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

  root.WeaveStarters = { userTables, CATEGORIES, TEMPLATES, searchText, spec, firstTable, workspaceName };
})(globalThis);
