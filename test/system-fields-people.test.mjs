import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, fnBodyOf } from './lib/source.mjs';

await import('../public/date-grain.js');
await import('../public/date-core.js');
await import('../public/actor-core.js');
const { stamp } = globalThis.weaveDateCore;
const A = globalThis.weaveActor;

const AT = '2026-08-28T17:14:03.000Z';

test('a system stamp reads as the date fields read: month, day, year and a 12-hour clock (Feature #326)', () => {
  assert.equal(stamp(AT, 'UTC').text, 'Aug 28, 2026 5:14 PM');
  assert.equal(stamp(AT, 'America/Los_Angeles').text, 'Aug 28, 2026 10:14 AM', 'the viewer\'s own wall clock');
  const local = globalThis.weaveDateGrain.fromInstant(AT, 'Asia/Tokyo');
  assert.equal(stamp(AT, 'Asia/Tokyo').text, globalThis.weaveDateGrain.formatDate(local, { time: true }), 'the date-field formatter, reused');
});

test('the hover title carries seconds and the zone', () => {
  assert.match(stamp(AT, 'UTC').title, /August 28, 2026/);
  assert.match(stamp(AT, 'UTC').title, /5:14:03 PM UTC/);
  assert.match(stamp(AT, 'America/Los_Angeles').title, /10:14:03 AM PDT/);
});

test('a missing or unreadable stamp prints nothing', () => {
  for (const bad of [null, undefined, '', 'not a date']) assert.deepEqual(stamp(bad, 'UTC'), { text: '', title: '' });
});

const USERS = [
  { id: 'u1', name: 'Kyle Adriany', kind: 'Person', role: 'Architect', email: 'kyle@example.com', workspaceId: 'ws1' },
  { id: 'u2', name: 'claude-code', kind: 'Agent', role: 'Editor', email: '', workspaceId: 'ws1' },
  { id: 'u3', name: 'dana', kind: 'Person', role: 'Observer', email: 'dana@example.com', workspaceId: 'ws2' },
];
const here = { workspaceId: 'ws1' };

test('an actor naming a Person row resolves to it: the row\'s name, a link target and a Name · Role · Email title', () => {
  const r = A.resolveActor('Kyle Adriany', USERS, here);
  assert.equal(r.kind, 'person');
  assert.equal(r.user.id, 'u1');
  assert.equal(r.name, 'Kyle Adriany');
  assert.equal(r.via, null);
  assert.equal(r.title, 'Kyle Adriany · Architect · kyle@example.com');
});

test('an actor naming an Agent row resolves as an agent', () => {
  const r = A.resolveActor('claude-code', USERS, here);
  assert.equal(r.kind, 'agent');
  assert.equal(r.user.id, 'u2');
  assert.equal(r.title, 'claude-code · Editor', 'an empty Email is left out');
});

test('"<name> via <client>" resolves to the named user and keeps the via door', () => {
  const r = A.resolveActor('Kyle Adriany via VMH4hSRpVOhCwUno', USERS, here);
  assert.equal(r.kind, 'person');
  assert.equal(r.user.id, 'u1');
  assert.equal(r.via, 'MCP');
  assert.equal(r.title, 'Kyle Adriany · Architect · kyle@example.com · via MCP');
  assert.doesNotMatch(JSON.stringify(r), /VMH4hSRpVOhCwUno/, 'the client id never surfaces');
  assert.equal(A.resolveActor('mcp:claude-code', USERS, here).kind, 'agent');
});

test('an actor with no Users row in this workspace is unknown: no row, no link target', () => {
  const web = A.resolveActor('web', USERS, here);
  assert.equal(web.kind, 'unknown');
  assert.equal(web.user, null);
  assert.equal(web.name, 'Web');
  assert.equal(web.title, 'Web');
  assert.equal(A.resolveActor('root', USERS, here).kind, 'unknown');
  assert.equal(A.resolveActor('dana', USERS, here).kind, 'unknown', 'a user of another workspace does not match');
  assert.equal(A.resolveActor('dana', USERS, { workspaceId: 'ws2' }).kind, 'person');
  assert.equal(A.resolveActor('web', undefined, here).kind, 'unknown', 'before the Users rows land');
});

test('workflow and empty actors pass through as parseActor reads them', () => {
  assert.deepEqual(A.resolveActor('workflow:7d1da813', USERS, here), { kind: 'workflow', workflowId: '7d1da813' });
  assert.deepEqual(A.resolveActor('', USERS, here), { kind: 'none' });
});

test('the system columns render through the shared stamp and the Users resolver', () => {
  assert.doesNotMatch(APP, /createdAt \?\? ''\)\.slice\(0, 16\)/, 'no sliced ISO strings');
  assert.match(APP, /'Created At': \(e\) => stampEl\(e\.createdAt\)/);
  assert.match(APP, /'Modified At': \(e\) => stampEl\(e\.updatedAt\)/);
  const chip = fnBodyOf('actorChipEl');
  assert.match(chip, /weaveActor\.resolveActor\(/);
  assert.match(chip, /workspaceUsers\(\[a\.handle\]\)/, 'a chip asks for the one handle it draws (Issue #850)');
  assert.match(fnBodyOf('workspaceUsers'), /registryTable\('users'\)/);
  assert.match(fnBodyOf('flushUsers'), /api\('POST', `\/tables\/\$\{t\.id\}\/query`/, 'one read path: the member route hands a registry table to the hub');
});
