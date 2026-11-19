import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { BUDGET, HOSTS, PATH, ROUNDS, SUITE, median, probe, readingsFor, sample } from '../scripts/edge-probe.mjs';

const at = (tls, firstByte) => ({ status: 200, tls, firstByte });

test('the budget passes the first byte weave answers today and catches the wait Issue #1268 recorded', () => {
  const today = readingsFor('weave.grunion.ai', [at(47, 124), at(51, 126), at(49, 125)]);
  for (const r of today) assert.ok(r.value <= r.budget, `${r.key} read ${r.value} ms against a budget of ${r.budget} ms`);

  const recorded = readingsFor('weave.grunion.ai', [at(54, 510), at(50, 507), at(58, 518)]);
  for (const r of recorded) assert.ok(r.value > r.budget, `${r.key} read ${r.value} ms, over its budget of ${r.budget} ms`);
});

test('a reading carries the median, the runs behind it and its budget', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);

  assert.deepEqual(readingsFor('dev.weave.grunion.ai', [at(50, 130), at(48, 120), at(52, 140)]), [
    { suite: SUITE, key: 'dev.weave.grunion.ai|first-byte', value: 130, budget: BUDGET['first-byte'], runs: [130, 120, 140] },
    { suite: SUITE, key: 'dev.weave.grunion.ai|after-tls', value: 80, budget: BUDGET['after-tls'], runs: [80, 72, 88] },
  ]);
  assert.deepEqual(readingsFor('weave.grunion.ai', []), [], 'a host that answered nothing has no reading to judge');
});

test('the probe reads every host over three rounds', async () => {
  const asked = [];
  const io = { sample: async (host) => { asked.push(host); return at(50, 120); } };
  const out = await probe(io);
  assert.deepEqual(asked, HOSTS.flatMap((h) => Array(ROUNDS).fill(h)));
  assert.deepEqual(out.skipped, []);
  assert.equal(out.readings.length, HOSTS.length * 2);
  assert.ok(out.readings.every((r) => r.suite === SUITE && Number.isFinite(r.value)));
});

test('an unreachable host records nothing and says so, so the trend lane stays honest (Issue #1268)', async () => {
  const io = { sample: async (host) => (host === 'down.example' ? { error: 'getaddrinfo ENOTFOUND down.example' } : at(50, 120)) };
  const out = await probe(io, { hosts: ['down.example', 'up.example'] });
  assert.deepEqual(out.readings.map((r) => r.key), ['up.example|first-byte', 'up.example|after-tls']);
  assert.deepEqual(out.skipped, ['down.example answered nothing on round 1: getaddrinfo ENOTFOUND down.example']);
});

test('a host that answers anything but 200 is measuring its own error page, not weave', async () => {
  const io = { sample: async () => ({ status: 503, tls: 50, firstByte: 120 }) };
  const out = await probe(io, { hosts: ['sick.example'] });
  assert.deepEqual(out.readings, []);
  assert.deepEqual(out.skipped, ['sick.example answered nothing on round 1: HTTP 503']);
});

test('sample times the socket it opens: connect, first byte and the error path', async () => {
  const server = createServer((req, res) => {
    assert.equal(req.url, PATH);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    const taken = await sample(`127.0.0.1:${port}`, { requestImpl: httpRequest });
    assert.equal(taken.status, 200);
    assert.ok(taken.tls >= 0 && taken.firstByte >= taken.tls, `first byte ${taken.firstByte} ms comes after the socket at ${taken.tls} ms`);
    assert.equal(taken.error, undefined);
  } finally { server.close(); }

  const refused = await sample('127.0.0.1:1', { requestImpl: httpRequest });
  assert.match(refused.error, /ECONNREFUSED|EACCES/);
  assert.equal(refused.status, undefined);
});

test('the probe asks weave and dev for the cheapest route there is', () => {
  assert.deepEqual(HOSTS, ['weave.grunion.ai', 'dev.weave.grunion.ai']);
  assert.equal(PATH, '/api/health');
  assert.equal(ROUNDS, 3);
});
