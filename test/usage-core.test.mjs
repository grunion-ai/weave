import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/usage-core.js');
const U = globalThis.WeaveUsage;

const kinds = { reg_users: 'users', reg_tables: 'tables', reg_spaces: 'spaces', reg_fields: 'fields' };
const systemOf = (id) => kinds[id] ?? null;
const templates = ['crm', 'tasks'];
const hit = (method, path, body, data) => U.eventFor({ method, path, body, data, systemOf, templates });

test('each create the app learns succeeded maps to one named event with fixed props', () => {
  assert.deepEqual(hit('POST', '/workspaces', { name: 'Acme Secret Co', slug: 'acme' }, { url: '/w/acme/' }), ['workspace_created', { via: 'app' }]);
  assert.deepEqual(hit('POST', '/tables', { space: 'Sales', name: 'Deals' }, { id: 't1', name: 'Deals' }), ['table_created', null]);
  assert.deepEqual(hit('POST', '/tables/t1/entities', { name: 'Big deal', values: { Amount: 9 } }, { id: 'e1', name: 'Big deal' }), ['row_created', null]);
  assert.deepEqual(hit('POST', '/invites', { email: 'ada@example.com', role: 'editor' }, { email: 'ada@example.com' }), ['invite_sent', { role: 'editor' }]);
  assert.deepEqual(hit('POST', '/tables/reg_users/entities', { values: { Role: 'Observer', Email: 'b@example.com' } }, { id: 'a1', invite: { url: 'https://x' } }), ['invite_sent', { role: 'observer' }]);
  assert.deepEqual(hit('POST', '/tables/reg_users/entities', { name: 'bot', values: { Role: 'Editor', Kind: 'Agent' } }, { id: 'a2', token: 'wv_secret' }), ['agent_token_created', null]);
  assert.deepEqual(hit('POST', '/tables/reg_tables/entities', { name: 'Leads' }, { id: 'r1' }), ['table_created', null]);
  assert.deepEqual(hit('POST', '/tables/t1/import.csv', { csv: 'Name\nA\nB\nC' }, { created: 3, errors: [] }), ['rows_imported', { count: 3 }]);
  assert.deepEqual(hit('POST', '/onboarding', { name: 'Mine', template: 'crm' }, { url: '/' }), ['template_used', { source: 'catalog', template: 'crm' }]);
  assert.deepEqual(hit('POST', '/spaces/s1/use', { workspace: 'other', name: 'Copy of Sales' }, { url: '/w/other/' }), ['template_used', { source: 'space' }]);
});

test('reads, edits, deletes and registry rows that are not a table or a person send nothing', () => {
  assert.equal(hit('GET', '/tables', undefined, {}), null);
  assert.equal(hit('PATCH', '/entities/e1', { values: { Name: 'x' } }, { id: 'e1' }), null);
  assert.equal(hit('DELETE', '/entities/e1', undefined, {}), null);
  assert.equal(hit('POST', '/tables/t1/query', {}, { items: [] }), null);
  assert.equal(hit('POST', '/bulk', { ids: ['e1'], op: 'set' }, {}), null);
  assert.equal(hit('POST', '/build', { spaces: [] }, {}), null);
  assert.equal(hit('POST', '/onboarding', { name: 'Mine' }, {}), null);
  assert.equal(hit('POST', '/tables/reg_spaces/entities', { name: 'New space' }, { id: 'x' }), null);
  assert.equal(hit('POST', '/tables/reg_fields/entities', {}, { id: 'x' }), null);
  assert.equal(hit('POST', '/tables/reg_users/entities', { values: { Role: 'Editor' } }, { id: 'x' }), null);
});

test('props never carry typed text, ids or values: unknown roles, templates and counts fall back to fixed shapes', () => {
  assert.deepEqual(hit('POST', '/invites', { email: 'x@example.com', role: 'Supreme <b>' }, {}), ['invite_sent', null]);
  assert.deepEqual(hit('POST', '/onboarding', { template: 'my private thing' }, {}), ['template_used', { source: 'catalog' }]);
  assert.deepEqual(hit('POST', '/tables/t1/import.csv', {}, { created: 'lots' }), ['rows_imported', { count: 0 }]);
  assert.deepEqual(U.template('tasks', templates), ['template_used', { source: 'catalog', template: 'tasks' }]);
  assert.deepEqual(U.template('evil', templates), ['template_used', { source: 'catalog' }]);
  const everything = JSON.stringify([
    hit('POST', '/workspaces', { name: 'Acme Secret Co' }, { url: '/w/acme/', id: 'w9' }),
    hit('POST', '/tables', { name: 'Deals' }, { id: 't1', name: 'Deals' }),
    hit('POST', '/tables/t1/entities', { name: 'Big deal' }, { id: 'e1', name: 'Big deal' }),
    hit('POST', '/invites', { email: 'ada@example.com', role: 'editor' }, { email: 'ada@example.com', id: 'i1' }),
  ]);
  for (const leak of ['Acme', 'Deals', 'Big deal', 'ada@', 'w9', 't1', 'e1', 'i1']) assert.ok(!everything.includes(leak), `${leak} leaked into an event`);
});

test('app_opened is due once per UTC day and only when the day can be stored', () => {
  const box = new Map();
  const store = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, String(v)) };
  const late = new Date('2026-10-16T23:59:00Z');
  assert.equal(U.opened(store, late), true);
  assert.equal(box.get(U.DAY_KEY), '2026-10-16');
  assert.equal(U.opened(store, new Date('2026-10-16T08:00:00Z')), false);
  assert.equal(U.opened(store, new Date('2026-10-17T00:00:01Z')), true);
  assert.equal(box.get(U.DAY_KEY), '2026-10-17');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(U.opened(broken, late), false);
});
