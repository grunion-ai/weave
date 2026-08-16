// Seed a demo workspace showing off every Weave feature.
import { Weave } from '../src/engine.js';

export function seed(w) {
  // ---------- Product space ----------
  w.createSpace({ name: 'Product', description: 'Product development' });
  const projects = w.createDatabase({ space: 'Product', name: 'Project' });
  const tasks = w.createDatabase({ space: 'Product', name: 'Task' });

  w.addField(projects, { name: 'Budget', type: 'number' });
  w.addField(projects, { name: 'Kickoff', type: 'date' });
  w.addField(projects, {
    name: 'Stage', type: 'workflow', config: {
      states: [
        { name: 'Discovery', category: 'not-started', default: true },
        { name: 'Building', category: 'in-progress' },
        { name: 'Shipped', category: 'done' },
      ],
    },
  });

  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addField(tasks, { name: 'Due', type: 'date' });
  w.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2', 'P3'] } });
  w.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['bug', 'feature', 'chore', 'design'] } });
  w.addField(tasks, {
    name: 'State', type: 'workflow', config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'In Progress', category: 'in-progress' },
        { name: 'Review', category: 'in-progress' },
        { name: 'Done', category: 'done' },
        { name: 'Canceled', category: 'canceled' },
      ],
    },
  });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(tasks, { name: 'Project Budget', type: 'lookup', config: { relationField: 'Project', targetField: 'Budget' } });
  w.addField(tasks, { name: 'Size', type: 'formula', config: { expression: 'if(empty(Estimate), "unsized", if(Estimate > 5, "large", "small"))' } });
  w.addField(projects, { name: 'Task Count', type: 'rollup', config: { relationField: 'Tasks', aggregate: 'count' } });
  w.addField(projects, { name: 'Total Estimate', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' } });
  w.addField(projects, { name: 'Task List', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Name', aggregate: 'join' } });

  // ---------- People space ----------
  w.createSpace({ name: 'People' });
  const people = w.createDatabase({ space: 'People', name: 'Person' });
  w.addField(people, { name: 'Email', type: 'email' });
  w.addField(people, { name: 'Role', type: 'select', config: { options: ['Engineer', 'Designer', 'PM'] } });
  w.addRelation(tasks, { name: 'Assignee', targetDb: people, cardinality: 'many-to-one', inverseName: 'Assigned Tasks' });
  w.addField(people, { name: 'Open Load', type: 'rollup', config: { relationField: 'Assigned Tasks', targetField: 'Estimate', aggregate: 'sum' } });

  // ---------- Automation ----------
  w.createAutomation(tasks, {
    name: 'Log completion',
    trigger: { type: 'state-changed', field: 'State', toState: 'Done' },
    actions: [
      { type: 'append-doc', text: '---\n\n✅ Completed on {{Today}}.' },
      { type: 'add-comment', text: 'Task "{{Name}}" moved to Done.' },
    ],
  });

  // ---------- Entities ----------
  const ada = w.createEntity(people, { name: 'Ada Chen', values: { Email: 'ada@example.com', Role: 'Engineer' } });
  const leo = w.createEntity(people, { name: 'Leo Marsh', values: { Email: 'leo@example.com', Role: 'Designer' } });

  const apollo = w.createEntity(projects, {
    name: 'Apollo Launch', values: { Budget: 120000, Kickoff: '2026-07-01' },
    doc: `# Apollo Launch

The Q3 flagship release. Tracks the new onboarding flow and billing revamp.

## Goals

1. Cut onboarding drop-off by 30%
2. Self-serve plan upgrades

## Key tasks

Watch [[Task#1]] and [[Task#3]] — they gate the launch date.

| Milestone | Date |
|-----------|------|
| Beta | 2026-08-20 |
| GA | 2026-09-15 |
`,
  });
  w.setState(apollo.id, 'Stage', 'Building');

  const hermes = w.createEntity(projects, {
    name: 'Hermes Docs', values: { Budget: 30000, Kickoff: '2026-08-10' },
    doc: '# Hermes Docs\n\nDeveloper documentation portal refresh.',
  });

  const t1 = w.createEntity(tasks, {
    name: 'Design onboarding wizard',
    values: { Estimate: 8, Due: '2026-08-22', Priority: 'P0', Tags: ['design', 'feature'], Project: 'Apollo Launch', Assignee: 'Leo Marsh' },
    doc: `# Design onboarding wizard

New three-step wizard replacing the legacy form.

## Requirements

- [x] Step map agreed
- [ ] High-fidelity mocks
- [ ] Prototype hand-off

> Design debt from the old flow is documented in [[Project#2|Hermes Docs]].

\`\`\`
wizard/
  StepAccount.tsx
  StepWorkspace.tsx
  StepInvite.tsx
\`\`\`
`,
  });
  w.setState(t1.id, 'State', 'In Progress');

  const t2 = w.createEntity(tasks, {
    name: 'Billing API migration',
    values: { Estimate: 13, Due: '2026-09-01', Priority: 'P1', Tags: ['feature'], Project: 'Apollo Launch', Assignee: 'Ada Chen' },
    doc: '# Billing API migration\n\nMove to usage-based metering endpoints.',
  });

  const t3 = w.createEntity(tasks, {
    name: 'Fix signup race condition',
    values: { Estimate: 3, Due: '2026-08-18', Priority: 'P0', Tags: ['bug'], Project: 'Apollo Launch', Assignee: 'Ada Chen' },
    doc: '# Fix signup race condition\n\nDuplicate workspace rows when double-submitting the signup form.\n\n- [x] Reproduce\n- [x] Patch unique constraint\n- [x] Regression test',
  });
  w.setState(t3.id, 'State', 'Done'); // fires the automation

  const t4 = w.createEntity(tasks, {
    name: 'Write API quickstart',
    values: { Estimate: 5, Due: '2026-09-05', Priority: 'P2', Tags: ['chore'], Project: 'Hermes Docs', Assignee: 'Leo Marsh' },
  });

  w.addComment(t1.id, { author: 'ada', text: 'Wizard step 2 needs the workspace-name check from the race-condition fix.' });
  w.addComment(apollo.id, { author: 'leo', text: 'Beta date holds if mocks land this week.' });

  return { projects, tasks, people, apollo, hermes, t1, t2, t3, t4, ada, leo };
}

// Run directly: seed the default (or --data) workspace file.
if (import.meta.url === `file://${process.argv[1]}`) {
  const pathArg = process.argv.indexOf('--data');
  const path = pathArg >= 0 ? process.argv[pathArg + 1] : new URL('../demo-workspace.json', import.meta.url).pathname;
  const w = new Weave({ path });
  if (w.listSpaces().length) {
    console.log('Workspace already has data; not reseeding.');
    process.exit(0);
  }
  seed(w);
  console.log(`Seeded demo workspace at ${path}`);
}
