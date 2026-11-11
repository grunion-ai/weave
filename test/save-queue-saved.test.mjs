import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/save-queue.js');
const { createSaveQueue } = globalThis.WeaveSaveQueue;

function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await drain();
      }
      now = until;
      await drain();
    },
  };
}
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const offline = () => Object.assign(new Error('Could not reach the server; nothing was saved'), { code: 'offline' });
const echo = async (job) => ({ id: job.entityId, fields: { [job.field]: job.value } });
const job = (entityId, field, value) => ({ entityId, field, value });

test('save queue: every landed write is announced once, with its result and job, before its push settles (Issue #1681)', async () => {
  const t = clock();
  const heard = [];
  const q = createSaveQueue({ send: echo, timers: t });
  q.onSaved((result, j) => heard.push(`saved ${j.entityId}.${j.field}=${result.fields[j.field]}`));
  const a = q.push(job('e1', 'A', 1)).then((r) => heard.push(`settled A=${r.fields.A}`));
  const b = q.push(job('e2', 'B', 2)).then((r) => heard.push(`settled B=${r.fields.B}`));
  await t.advance(600);
  await Promise.all([a, b]);
  assert.deepEqual(heard, ['saved e1.A=1', 'settled A=1', 'saved e2.B=2', 'settled B=2']);
});

test('save queue: a write that does not land is not announced; the retry that lands is, once (Issue #1681)', async () => {
  const t = clock();
  let down = true;
  const heard = [];
  const q = createSaveQueue({ send: (j) => (down ? Promise.reject(offline()) : echo(j)), timers: t });
  q.onSaved((result) => heard.push(result.fields.Note));
  q.push({ ...job('e1', 'Note', 'kept'), keep: true });
  await t.advance(600);
  assert.equal(q.state, 'failed');
  assert.deepEqual(heard, [], 'nothing landed, so nothing is announced');
  down = false;
  await q.flush();
  assert.deepEqual(heard, ['kept'], 'the retry landed and is announced once');
});

test('save queue: a listener stops hearing writes once it unsubscribes (Issue #1681)', async () => {
  const t = clock();
  const heard = [];
  const q = createSaveQueue({ send: echo, timers: t });
  const off = q.onSaved((result) => heard.push(result.fields.A));
  q.push(job('e1', 'A', 1));
  await t.advance(600);
  off();
  q.push(job('e1', 'A', 2));
  await t.advance(600);
  assert.deepEqual(heard, [1]);
});

test('save queue: a listener that throws neither strands the write nor stops the queue, and its error still surfaces (Issue #1681)', async () => {
  const t = clock();
  const sent = [];
  const q = createSaveQueue({ send: (j) => { sent.push(j.value); return echo(j); }, timers: t });
  q.onSaved(() => { throw new Error('listener broke'); });
  const heard = [];
  q.onSaved((result) => heard.push(result.fields.A));
  const first = q.push(job('e1', 'A', 1));
  await assert.rejects(t.advance(600), /listener broke/, 'the error is thrown again on its own turn');
  assert.deepEqual((await first).fields, { A: 1 }, 'the write still settles');
  q.push(job('e1', 'A', 2));
  await assert.rejects(t.advance(600), /listener broke/);
  assert.deepEqual(sent, [1, 2], 'and the queue keeps sending');
  assert.deepEqual(heard, [1, 2], 'every other listener still hears each write');
});
