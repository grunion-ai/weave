import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './lib/source.mjs';

await import('../public/save-queue.js');
const { createSaveQueue, bindPageHide, DEBOUNCE_MS, TICK_MS } = globalThis.WeaveSaveQueue;

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

function server({ fail = 0, error = () => Object.assign(new Error('Could not reach the server; nothing was saved'), { code: 'offline' }) } = {}) {
  const sent = [];
  let failing = fail;
  return {
    sent,
    set failing(n) { failing = n; },
    send: async (job) => {
      if (failing > 0) { failing--; sent.push({ ...job, ok: false }); throw error(job); }
      sent.push({ ...job, ok: true });
      return { id: job.entityId, fields: { [job.field]: job.value } };
    },
  };
}

const job = (entityId, field, value) => ({ entityId, field, value });
const landed = (srv) => srv.sent.filter((s) => s.ok).map((s) => `${s.entityId}.${s.field}=${s.value}`);

test('save queue: the debounce is 600 ms and the tick shows for two seconds (Feature #217)', () => {
  assert.equal(DEBOUNCE_MS, 600);
  assert.equal(TICK_MS, 2000);
});

test('save queue: edits to one key inside the debounce send once, with the last value (Feature #217)', async () => {
  const t = clock();
  const srv = server();
  const q = createSaveQueue({ send: srv.send, timers: t });
  q.push(job('e1', 'Note', 'a'));
  await t.advance(300);
  q.push(job('e1', 'Note', 'ab'));
  await t.advance(599);
  assert.deepEqual(srv.sent, [], 'nothing goes before the key has been quiet for 600 ms');
  assert.equal(q.pending, 1, 'one key waits');
  await t.advance(1);
  assert.deepEqual(landed(srv), ['e1.Note=ab']);
  assert.equal(q.pending, 0);
});

test('save queue: four quick edits to four keys send four writes in the order they were made (Feature #217)', async () => {
  const t = clock();
  const srv = server();
  const q = createSaveQueue({ send: srv.send, timers: t });
  for (const [i, f] of ['A', 'B', 'C', 'D'].entries()) {
    q.push(job('e1', f, i));
    await t.advance(50);
  }
  assert.equal(q.pending, 4);
  assert.equal(q.state, 'pending');
  await t.advance(1000);
  assert.deepEqual(landed(srv), ['e1.A=0', 'e1.B=1', 'e1.C=2', 'e1.D=3']);
  assert.equal(q.state, 'saved', 'a drained queue reads saved');
  await t.advance(TICK_MS);
  assert.equal(q.state, 'idle', 'and idle once the tick has shown');
});

test('save queue: writes go one at a time, never two in flight (Feature #217)', async () => {
  const t = clock();
  let inFlight = 0;
  let most = 0;
  const order = [];
  const q = createSaveQueue({
    timers: t,
    send: async (j) => {
      inFlight++; most = Math.max(most, inFlight);
      await drain();
      order.push(j.field);
      inFlight--;
    },
  });
  q.push(job('e1', 'A', 1));
  q.push(job('e2', 'B', 2));
  q.push(job('e3', 'C', 3));
  await q.flush();
  assert.equal(most, 1);
  assert.deepEqual(order, ['A', 'B', 'C']);
});

test('save queue: a failed write is retried once and lands (Feature #217)', async () => {
  const t = clock();
  const srv = server({ fail: 1 });
  const q = createSaveQueue({ send: srv.send, timers: t });
  const done = q.push(job('e1', 'Note', 'x'));
  await t.advance(DEBOUNCE_MS);
  assert.equal(srv.sent.length, 2, 'the first try and one retry');
  assert.deepEqual(landed(srv), ['e1.Note=x']);
  assert.deepEqual(await done, { id: 'e1', fields: { Note: 'x' } }, 'the push answers with what the server sent back');
  assert.equal(q.state, 'saved');
});

test('save queue: a write that fails twice is kept, reads failed, and lands on the next flush (Feature #217)', async () => {
  const t = clock();
  const srv = server({ fail: 2 });
  const fails = [];
  const q = createSaveQueue({ send: srv.send, timers: t, onFail: (err, j) => fails.push([err.code, j.field]) });
  let answer = null;
  q.push(job('e1', 'Note', 'kept')).then((r) => { answer = r; });
  await t.advance(DEBOUNCE_MS);
  assert.equal(srv.sent.length, 2, 'one try, one retry, no more');
  assert.equal(q.state, 'failed');
  assert.equal(q.pending, 1, 'the edit is still pending');
  assert.deepEqual(fails, [['offline', 'Note']], 'the failure is reported once');
  assert.equal(answer, null, 'the push has not answered yet');
  await t.advance(60_000);
  assert.equal(srv.sent.length, 2, 'a failed write waits for a flush, it does not loop');
  await q.flush();
  assert.deepEqual(landed(srv), ['e1.Note=kept']);
  assert.deepEqual(answer, { id: 'e1', fields: { Note: 'kept' } });
  assert.equal(q.state, 'saved');
  assert.equal(q.pending, 0);
});

test('save queue: a refusal from the server is not retried or kept; the push rejects with it (Feature #217)', async () => {
  const t = clock();
  const srv = server({ fail: 1, error: () => Object.assign(new Error('changed first'), { status: 412, code: 'stale' }) });
  const q = createSaveQueue({ send: srv.send, timers: t });
  const done = q.push(job('e1', 'Note', 'mine'));
  await t.advance(DEBOUNCE_MS);
  await assert.rejects(done, { code: 'stale' });
  assert.equal(srv.sent.length, 1, 'no retry for an answer the server gave on purpose');
  assert.equal(q.pending, 0);
  assert.notEqual(q.state, 'failed');
});

test('save queue: a server error (5xx) is retried like a lost connection (Feature #217)', async () => {
  const t = clock();
  const srv = server({ fail: 1, error: () => Object.assign(new Error('Server error'), { status: 503 }) });
  const q = createSaveQueue({ send: srv.send, timers: t });
  q.push(job('e1', 'Note', 'y'));
  await t.advance(DEBOUNCE_MS);
  assert.deepEqual(landed(srv), ['e1.Note=y']);
});

test('save queue: a newer edit to a failed key replaces the kept value (Feature #217)', async () => {
  const t = clock();
  const srv = server({ fail: 2 });
  const q = createSaveQueue({ send: srv.send, timers: t });
  const first = q.push(job('e1', 'Note', 'old'));
  await t.advance(DEBOUNCE_MS);
  assert.equal(q.state, 'failed');
  const second = q.push(job('e1', 'Note', 'new'));
  assert.equal(q.pending, 1, 'one key, one pending edit');
  await t.advance(DEBOUNCE_MS);
  assert.deepEqual(landed(srv), ['e1.Note=new']);
  assert.deepEqual(await first, await second, 'both pushes answer with the write that carried the newest value');
});

test('save queue: flush sends every waiting edit now, in order, and answers when they land (Feature #217)', async () => {
  const t = clock();
  const srv = server();
  const q = createSaveQueue({ send: srv.send, timers: t });
  q.push(job('e1', 'A', 1));
  q.push(job('e2', 'B', 2));
  await q.flush();
  assert.deepEqual(landed(srv), ['e1.A=1', 'e2.B=2']);
  assert.equal(q.pending, 0);
  await t.advance(DEBOUNCE_MS);
  assert.equal(srv.sent.length, 2, 'the cleared debounce timers send nothing more');
});

test('save queue: flush on an idle queue answers at once and changes nothing (Feature #217)', async () => {
  const t = clock();
  const srv = server();
  const q = createSaveQueue({ send: srv.send, timers: t });
  await q.flush();
  assert.equal(q.state, 'idle');
  assert.deepEqual(srv.sent, []);
  q.push(job('e1', 'Note', 'after'));
  await t.advance(DEBOUNCE_MS);
  assert.deepEqual(landed(srv), ['e1.Note=after'], 'and the queue still sends what comes next');
  q.push(job('e1', 'Note', 'flushed'));
  await q.flush();
  assert.deepEqual(landed(srv), ['e1.Note=after', 'e1.Note=flushed'], 'by its timer or by a flush');
});

test('save queue: a leaving flush starts every write at once, last value per key (Feature #217)', async () => {
  const t = clock();
  const started = [];
  const q = createSaveQueue({ timers: t, send: (j) => { started.push(`${j.field}=${j.value}`); return new Promise(() => {}); } });
  q.push(job('e1', 'A', 1));
  q.push(job('e1', 'B', 2));
  q.push(job('e1', 'C', 3));
  q.flush({ leaving: true });
  assert.deepEqual(started, ['A=1', 'B=2', 'C=3'], 'all three leave before the page goes, none waits on another');
});

test('save queue: a push can carry its own send, which the queue uses for that key (Feature #217)', async () => {
  const t = clock();
  const srv = server();
  const own = [];
  const q = createSaveQueue({ send: srv.send, timers: t });
  q.push({ key: 'doc:e1:Body', value: '# hi', send: async (j) => { own.push(j.value); return 'put'; } });
  q.push(job('e1', 'Name', 'x'));
  await q.flush();
  assert.deepEqual(own, ['# hi']);
  assert.deepEqual(landed(srv), ['e1.Name=x']);
});

test('save queue: listeners hear every state change (Feature #217)', async () => {
  const t = clock();
  const srv = server({ fail: 2 });
  const q = createSaveQueue({ send: srv.send, timers: t });
  const heard = [];
  q.subscribe((s) => heard.push(s.state));
  q.push(job('e1', 'Note', 'x'));
  await t.advance(DEBOUNCE_MS);
  await q.flush();
  await t.advance(TICK_MS);
  assert.deepEqual(heard.filter((s, i) => s !== heard[i - 1]), ['pending', 'failed', 'pending', 'saved', 'idle']);
});

test('save queue: the page going hidden, or away, flushes at once (Feature #217)', async () => {
  const t = clock();
  const srv = server();
  const q = createSaveQueue({ send: srv.send, timers: t });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  bindPageHide(q, win, doc);
  q.push(job('e1', 'Note', 'hidden'));
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await drain();
  assert.deepEqual(landed(srv), ['e1.Note=hidden'], 'visibilitychange to hidden flushes');
  q.push(job('e1', 'Note', 'gone'));
  win.dispatchEvent(new Event('pagehide'));
  await drain();
  assert.deepEqual(landed(srv), ['e1.Note=hidden', 'e1.Note=gone'], 'pagehide, the unload event iOS Safari fires, flushes');
  doc.visibilityState = 'visible';
  q.push(job('e1', 'Note', 'back'));
  doc.dispatchEvent(new Event('visibilitychange'));
  await drain();
  assert.equal(landed(srv).length, 2, 'coming back into view does not flush');
});

test('save queue: index.html loads save-queue.js before app.js (Feature #217)', () => {
  const html = read('public/index.html');
  const at = html.indexOf('<script src="/save-queue.js" defer></script>');
  assert.ok(at > -1, 'index.html loads public/save-queue.js');
  assert.ok(at < html.indexOf('<script src="/app.js" defer></script>'), 'before app.js reads it');
});
