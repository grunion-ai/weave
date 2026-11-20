import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Deck' });
  w.addField('Deck', { name: 'Files', type: 'attachments' });
  return w;
}

async function serve(w) {
  const { server } = await startServer(w, { port: 0 });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const attachUrl = (base, entity) => `${base}/api/entities/${entity}/fields/Files/files`;

const post = (base, entity, body, token) => fetch(attachUrl(base, entity), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

function stalledUpload(base, entity, token) {
  const encoder = new TextEncoder();
  let open;
  const held = new Promise((resolve) => { open = resolve; });
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('{"name":"slow.bin","mime":"application/octet-stream","bytes":"'));
      await held;
      controller.enqueue(encoder.encode('AAAA"}'));
      controller.close();
    },
  });
  const sent = fetch(attachUrl(base, entity), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
    duplex: 'half',
  });
  return { sent, finish: () => open() };
}

async function refusalWhileHeld(base, entity, token, { budget = 3000 } = {}) {
  const deadline = Date.now() + budget;
  for (;;) {
    const res = await post(base, entity, { name: 'third.bin', mime: 'application/octet-stream', bytes: 'AAAA' }, token);
    if (res.status === 429) return res;
    await res.arrayBuffer();
    if (Date.now() > deadline) return res;
  }
}

test('a third upload held open at the same time is refused with a retry hint (Issue #1429)', async () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { base, close } = await serve(w);
  const first = stalledUpload(base, e.id);
  const second = stalledUpload(base, e.id);
  try {
    const res = await refusalWhileHeld(base, e.id);
    assert.equal(res.status, 429, 'two uploads were already in flight, so the third had to wait its turn');
    const body = await res.json();
    assert.equal(body.code, 'rate-limited', 'the refusal carries the rate-limited contract code');
    assert.match(body.error, /upload/i, 'the refusal says which work was turned away');
    assert.equal(res.headers.get('retry-after'), '60', 'the refusal tells the caller when to come back');
  } finally {
    first.finish();
    second.finish();
    await Promise.all([first.sent, second.sent]);
    close();
  }
});

test('a slot comes back when an upload finishes, so the next one lands (Issue #1429)', async () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { base, close } = await serve(w);
  const first = stalledUpload(base, e.id);
  const second = stalledUpload(base, e.id);
  try {
    assert.equal((await refusalWhileHeld(base, e.id)).status, 429, 'the cap held while two uploads were open');
    first.finish();
    second.finish();
    for (const res of await Promise.all([first.sent, second.sent])) {
      assert.equal(res.status, 201, 'an upload that was never refused still lands');
    }
    const after = await post(base, e.id, { name: 'fourth.bin', mime: 'application/octet-stream', bytes: 'AAAA' });
    assert.equal(after.status, 201, 'the cap counts uploads in flight, not uploads per minute');
    assert.equal(w.getEntity(e.id).files.length, 3, 'every upload that was admitted is attached');
  } finally {
    first.finish();
    second.finish();
    close();
  }
});

test('the cap is per account, so one busy token never blocks another (Issue #1429)', async () => {
  const w = fresh();
  const busy = w.createAccount({ name: 'busy-bot', role: 'editor' });
  const other = w.createAccount({ name: 'other-bot', role: 'editor' });
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { base, close } = await serve(w);
  const first = stalledUpload(base, e.id, busy.token);
  const second = stalledUpload(base, e.id, busy.token);
  try {
    assert.equal((await refusalWhileHeld(base, e.id, busy.token)).status, 429, 'the busy token is over its own cap');
    const guest = await post(base, e.id, { name: 'guest.bin', mime: 'application/octet-stream', bytes: 'AAAA' }, other.token);
    assert.equal(guest.status, 201, 'a second account keyed on the busy one would be refused the same way');
  } finally {
    first.finish();
    second.finish();
    await Promise.all([first.sent, second.sent]);
    close();
  }
});
