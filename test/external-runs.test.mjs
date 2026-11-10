import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { withViewers } from '../src/access.js';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const ORIGIN = 'https://weave.example.com';
const make = (path) => {
  const w = new Weave({ path });
  w.now = () => new Date('2026-11-10T12:00:00Z');
  return w;
};
const latest = (w, id) => w.listRuns().find((r) => r.id === id);

test('runs persist, start keys deduplicate, and terminal callbacks are immutable', () => {
  const path = join(tempDir('weave-runs-'), 'runs.db');
  const w = make(path);
  const a = w.startRun({ name: 'Daily review', key: 'daily-1', recipient: 'owner@example.com' });
  assert.equal(a.status, 'queued');
  assert.equal(w.startRun({ name: 'Daily review', key: 'daily-1', recipient: 'owner@example.com' }).id, a.id);
  assert.throws(() => w.startRun({ name: 'Different job', key: 'daily-1' }), /key.*different|different.*key/i);
  const running = w.updateRun(a.id, { status: 'running', sessionUrl: 'https://claude.ai/code/session_1' });
  assert.equal(running.status, 'running');
  w.now = () => new Date('2026-11-10T12:05:00Z');
  const done = w.updateRun(a.id, { status: 'succeeded', summary: 'Reviewed two changes.' });
  assert.equal(done.mailStatus, 'pending');
  assert.equal(done.finishedAt, '2026-11-10T12:05:00.000Z');
  assert.deepEqual(w.updateRun(a.id, { status: 'succeeded', summary: 'Reviewed two changes.' }), done);
  assert.throws(() => w.updateRun(a.id, { status: 'failed' }), /terminal|finished/i);
  w.store.close();
  const reopened = make(path);
  assert.deepEqual(latest(reopened, a.id), done);
  reopened.store.close();
});

test('run fields cannot bypass transitions through generic CRUD and invalid input is refused', () => {
  const w = make();
  const r = w.startRun({ name: 'A' });
  assert.throws(() => w.createEntity('System/Runs', { Name: 'Fake', Status: 'succeeded' }), /run.*API|startRun|run start/i);
  assert.throws(() => w.updateEntity(r.id, { Status: 'succeeded' }), /run.*API|updateRun|run update/i);
  assert.throws(() => w.deleteEntity(r.id), /run.*retain|cannot.*run|run.*cannot/i);
  assert.throws(() => w.startRun({ name: 'A', recipient: 'a@example.com\nBcc: other@example.com' }), /recipient/i);
  assert.throws(() => w.startRun({ name: 'A', timeoutMinutes: 0 }), /timeout/i);
  assert.throws(() => w.updateRun(r.id, { sessionUrl: 'javascript:alert(1)' }), /sessionUrl/i);
  assert.throws(() => w.updateRun(r.id, { status: 'made-up' }), /status/i);
  assert.throws(() => w.updateRun(r.id, { recipient: 'other@example.com' }), /recipient|unknown/i);
  assert.equal(w.updateRun(r.id, { status: 'succeeded' }).mailStatus, 'disabled');
});

test('completion sends one frozen HTML and text confirmation, even with concurrent maintenance', async () => {
  const w = make();
  const r = w.startRun({ name: 'Review', recipient: 'owner@example.com' });
  w.updateRun(r.id, { status: 'failed', error: 'Remote job failed' });
  const sent = [];
  let release;
  const mail = async (m) => { sent.push(m); await new Promise((r) => { release = r; }); return { id: 'email_1' }; };
  const first = w.runMaintenance({ mail, origin: ORIGIN });
  await w.runMaintenance({ mail, origin: ORIGIN });
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /Remote job failed/);
  assert.match(sent[0].text, /Remote job failed/);
  assert.equal(sent[0].idempotencyKey, `weave-run-${r.id}`);
  release();
  await first;
  assert.equal(latest(w, r.id).mailStatus, 'sent');
  assert.equal(latest(w, r.id).mailProviderId, 'email_1');
  assert.ok(sent[0].html.includes(`${ORIGIN}${w.permalink('entity', r.id)}`));
  await w.runMaintenance({ mail, origin: ORIGIN });
  assert.equal(sent.length, 1);
});

test('silent runs time out and absent mail is visible without losing the confirmation', async () => {
  const w = make();
  const r = w.startRun({ name: 'Silent', recipient: 'owner@example.com', timeoutMinutes: 1 });
  w.now = () => new Date('2026-11-10T12:02:00Z');
  await w.runMaintenance({ origin: ORIGIN });
  assert.equal(latest(w, r.id).status, 'timed-out');
  assert.match(latest(w, r.id).mailError, /configured/i);
  const sent = [];
  await w.runMaintenance({ mail: async (m) => { sent.push(m); return { id: 'email_timeout' }; }, origin: ORIGIN });
  assert.equal(sent.length, 1);
  assert.equal(latest(w, r.id).mailStatus, 'sent');
});

test('mail retries survive restart with identical content and idempotency key', async () => {
  const path = join(tempDir('weave-run-mail-'), 'runs.db');
  const w = make(path);
  const r = w.startRun({ name: 'Retry', recipient: 'owner@example.com' });
  w.updateRun(r.id, { status: 'succeeded', summary: 'Done' });
  let first;
  await w.runMaintenance({ origin: ORIGIN, mail: async (m) => { first = m; throw new Error('network unavailable'); } });
  assert.equal(latest(w, r.id).mailAttempts, 1);
  w.store.close();
  const next = make(path);
  next.now = () => new Date('2026-11-10T12:02:00Z');
  let second;
  await next.runMaintenance({ origin: 'https://changed.example.com', mail: async (m) => { second = m; return { id: 'email_retry' }; } });
  assert.deepEqual(second, first);
  assert.equal(latest(next, r.id).mailStatus, 'sent');
  next.store.close();
});

test('an ambiguous email past its provider deduplication horizon is never automatically resent', async () => {
  const w = make();
  const r = w.startRun({ name: 'Uncertain', recipient: 'owner@example.com' });
  w.updateRun(r.id, { status: 'succeeded' });
  await w.runMaintenance({ origin: ORIGIN, mail: async () => { throw new Error('response lost'); } });
  w.now = () => new Date('2026-11-11T12:01:00Z');
  let sent = 0;
  await w.runMaintenance({ origin: ORIGIN, mail: async () => { sent++; return { id: 'wrong' }; } });
  assert.equal(sent, 0);
  assert.equal(latest(w, r.id).mailStatus, 'failed');
  assert.match(latest(w, r.id).mailError, /24|deduplication|ambiguous/i);
});

test('workflow actions retain a queued external run after launch and let callbacks complete it', async () => {
  const w = make();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Job' });
  const auto = w.createAutomation(t.id, {
    name: 'Launch', trigger: { type: 'entity-created' }, actions: [
      { type: 'start-run', name: '{{Name}}', recipient: 'owner@example.com', timeoutMinutes: 10 },
      { type: 'update-run', run: '{{steps.1.id}}', status: 'running', sessionUrl: 'https://claude.ai/code/session_1' },
    ],
  });
  w.createEntity(t.id, { Name: 'Daily' });
  await w.automationsSettled();
  const [r] = w.listRuns();
  assert.equal(r.status, 'running');
  assert.equal(r.workflow, auto.id);
  assert.equal(r.name, 'Daily');
  assert.equal(r.sessionUrl, 'https://claude.ai/code/session_1');
  assert.equal(w.readEntity(auto.id).fields.Health, 'Healthy');
});

test('workspace-scoped run controls refuse observers, space tokens and foreign ids', async () => {
  const w = make();
  const r = w.startRun({ name: 'Workspace run' });
  assert.throws(() => w.asAccount({ id: 'observer', role: 'observer' }, () => w.updateRun(r.id, { status: 'succeeded' })), /editor/i);
  assert.throws(() => w.asAccount({ id: 'scoped', role: 'editor', space: 'space-1' }, () => w.startRun({ name: 'No' })), /workspace account/i);
  assert.throws(() => withViewers({ of: () => ({ role: 'architect', unseated: true }) }, () => w.startRun({ name: 'Unseated' })), /editor/i);
  assert.throws(() => withViewers({ of: () => ({ role: 'architect', share: {} }) }, () => w.listRuns()), /editor/i);
  const other = make();
  assert.throws(() => other.updateRun(r.id, { status: 'succeeded' }), /not found|No run/i);
  assert.equal(w.readEntity(r.id).readOnly, true);
  const ws = w.query('System/Workspaces').items[0];
  assert.throws(() => w.link(r.id, 'Workspace', [ws.id]), /read-only/i);
  assert.throws(() => w.link(ws.id, 'Runs', [r.id]), /read-only/i);
  assert.throws(() => w.setDoc(r.id, 'forged'), /read-only/i);
});

test('two engine instances serialize claims and restarting after a send lease reuses its payload', async () => {
  const path = join(tempDir('weave-run-lease-'), 'runs.db');
  const w = make(path);
  const r = w.startRun({ name: 'Leased', recipient: 'owner@example.com' });
  w.updateRun(r.id, { status: 'succeeded' });
  let release;
  let first;
  const pending = w.runMaintenance({ origin: ORIGIN, mail: async (msg) => { first = msg; await new Promise((resolve, reject) => { release = () => reject(new Error('Old send failed')); }); } });
  const other = make(path);
  let count = 0;
  await other.runMaintenance({ origin: ORIGIN, mail: async () => { count++; } });
  assert.equal(count, 0);
  other.now = () => new Date('2026-11-10T12:02:00Z');
  await other.runMaintenance({ origin: ORIGIN, mail: async (msg) => { assert.deepEqual(msg, first); count++; return { id: 'leased' }; } });
  assert.equal(count, 1);
  release();
  await pending;
  assert.equal(latest(w, r.id).mailStatus, 'sent');
  w.store.close();
  other.store.close();
});

test('a failed later row does not change an earlier dispatched run', async () => {
  const w = make();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Job' });
  w.addField(t.id, { name: 'Session', type: 'text' });
  w.createEntity(t.id, { Name: 'First', Session: 'https://claude.ai/code/first' });
  w.createEntity(t.id, { Name: 'Second', Session: 'invalid-url' });
  w.createAutomation(t.id, { name: 'Batch', trigger: { type: 'schedule', cron: '* * * * *' }, actions: [
    { type: 'start-run', name: '{{Name}}' },
    { type: 'update-run', run: '{{steps.1.id}}', status: 'running', sessionUrl: '{{Session}}' },
  ] });
  w.runSchedules();
  w.now = () => new Date('2026-11-10T12:01:00Z');
  w.runSchedules();
  const runs = w.listRuns();
  assert.equal(runs.find((r) => r.name === 'First').status, 'running');
  assert.equal(runs.find((r) => r.name === 'Second').status, 'failed');
});

test('a dispatch that exhausts retries after restart fails the same tracked run', async () => {
  const prior = process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
  process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
  const endpoint = createServer((req, res) => { res.writeHead(503); res.end('unavailable'); });
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  const path = join(tempDir('weave-run-dispatch-'), 'runs.db');
  let w = make(path);
  try {
    w.createSpace({ name: 'Ops' });
    const t = w.createTable({ space: 'Ops', name: 'Job' });
    w.deliveryAttempts = 2;
    w.createAutomation(t.id, { name: 'Dispatch', trigger: { type: 'entity-created' }, actions: [
      { type: 'start-run', name: '{{Name}}', recipient: 'owner@example.com' },
      { type: 'http-request', url: `http://127.0.0.1:${endpoint.address().port}/fire` },
    ] });
    w.createEntity(t.id, { Name: 'Retried launch' });
    await w.automationsSettled();
    const [run] = w.listRuns();
    assert.equal(run.status, 'queued');
    w.store.close();
    w = make(path);
    w.deliveryAttempts = 2;
    w.now = () => new Date('2026-11-10T12:02:00Z');
    w.runDeliveries();
    await w.automationsSettled();
    const [failed] = w.listRuns();
    assert.equal(failed.id, run.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.mailStatus, 'pending');
    assert.match(failed.error, /gave up after 2 attempts/);
  } finally {
    w.store.close();
    endpoint.closeAllConnections();
    await new Promise((resolve) => endpoint.close(resolve));
    if (prior === undefined) delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
    else process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = prior;
  }
});

test('email attempts are bounded and a permanent provider rejection stops immediately', async () => {
  const w = make();
  const run = w.startRun({ name: 'Permanent', recipient: 'owner@example.com' });
  w.updateRun(run.id, { status: 'failed', error: 'Job failed' });
  await w.runMaintenance({ origin: ORIGIN, mail: async () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }); } });
  assert.equal(latest(w, run.id).mailStatus, 'failed');
  assert.equal(latest(w, run.id).mailAttempts, 1);
  const retry = w.startRun({ name: 'Retry ceiling', recipient: 'owner@example.com' });
  w.updateRun(retry.id, { status: 'succeeded' });
  let calls = 0;
  for (let i = 0; i < 10; i++) {
    w.now = () => new Date(Date.parse('2026-11-10T12:00:00Z') + i * 60 * 60_000);
    await w.runMaintenance({ origin: ORIGIN, mail: async () => { calls++; throw new Error('network'); } });
  }
  assert.equal(calls, 8);
  assert.equal(latest(w, retry.id).mailStatus, 'failed');
});

test('an authenticated completion webhook reads its run id and result from trigger body', async () => {
  const w = new Weave({ keystorePath: join(tempDir('weave-run-hook-'), 'keys.json') });
  w.now = () => new Date('2026-11-10T12:00:00Z');
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Event' });
  const run = w.startRun({ name: 'Remote callback', recipient: 'owner@example.com' });
  const hook = w.createAutomation(t.id, { name: 'Completion', trigger: { type: 'webhook-inbound', key: 'delivery' }, actions: [
    { type: 'update-run', run: '{{trigger.body.run}}', status: '{{trigger.body.status}}', summary: '{{trigger.body.summary}}' },
  ] });
  const secret = w.revealHookSecret(hook.id).secret;
  const bytes = Buffer.from(JSON.stringify({ delivery: 'done-1', run: run.id, status: 'succeeded', summary: 'Completed remotely.' }));
  const answer = w.receiveHook(hook.hook.path.split('/').at(-1), { bytes, header: (name) => name === 'x-weave-secret' ? secret : undefined });
  assert.equal(answer.status, 200);
  assert.equal(latest(w, run.id).status, 'succeeded');
  assert.equal(latest(w, run.id).summary, 'Completed remotely.');
  assert.throws(() => w.createAutomation('System/Runs', { trigger: { type: 'schedule', cron: '* * * * *' }, actions: [{ type: 'set-field', field: 'Status', value: 'succeeded' }] }), /read-only/i);
});

test('an expired external run never dispatches its waiting HTTP retry', async () => {
  const prior = process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
  process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
  let calls = 0;
  const endpoint = createServer((req, res) => { calls++; res.writeHead(503); res.end('unavailable'); });
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  const w = make();
  try {
    w.createSpace({ name: 'Ops' });
    const t = w.createTable({ space: 'Ops', name: 'Job' });
    w.createAutomation(t.id, { name: 'Dispatch', trigger: { type: 'entity-created' }, actions: [
      { type: 'start-run', name: '{{Name}}', timeoutMinutes: 1 },
      { type: 'http-request', url: `http://127.0.0.1:${endpoint.address().port}/fire` },
    ] });
    w.createEntity(t.id, { Name: 'Expired launch' });
    await w.automationsSettled();
    w.now = () => new Date('2026-11-10T12:02:00Z');
    w.runSchedules();
    await w.automationsSettled();
    assert.equal(calls, 1);
    await w.runMaintenance();
    assert.equal(w.listRuns()[0].status, 'timed-out');
  } finally {
    endpoint.closeAllConnections();
    await new Promise((resolve) => endpoint.close(resolve));
    if (prior === undefined) delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
    else process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = prior;
  }
});

test('workflow-only runs remain hidden from editors outside their private space', () => {
  const w = make();
  w.createSpace({ name: 'Private' });
  const table = w.createTable({ space: 'Private', name: 'Task' });
  const workflow = w.createAutomation(table.id, { name: 'Private worker', trigger: { type: 'schedule', cron: '* * * * *' }, actions: [{ type: 'start-run' }] });
  const run = w.startRun({ name: 'Private run', workflow: workflow.id });
  w.updateSpace('Private', { access: 'private' });
  w.asAccount({ id: 'outsider', role: 'editor' }, () => {
    assert.deepEqual(w.listRuns(), []);
    assert.throws(() => w.updateRun(run.id, { status: 'succeeded' }), /not found|No run/i);
    assert.throws(() => w.startRun({ name: 'Another', workflow: workflow.id }), /not found/i);
  });
});
