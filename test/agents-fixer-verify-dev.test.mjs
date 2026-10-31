import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, verify, parseArgs } from '../agents/fixer/verify-dev.mjs';

const SHA = 'cfeb8754479c603f3715cb661c9fd5bffd653146';
const OTHER = 'c44d3dd15c64afc23b03d3bd4c7ca5429fb3d5f9';

const health = ({ commit = SHA, lastSwap } = {}) => ({
  ok: true,
  name: 'weave',
  auth: { ok: true },
  supervisor: {
    release: `c${commit}`,
    commit,
    track: 'main',
    since: '2026-10-31T19:30:04.188Z',
    lastSwap: lastSwap ?? { at: '2026-10-31T19:30:01.421Z', from: `c${OTHER}`, to: `c${commit}`, ok: true },
  },
});

function fakeClock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}

const respond = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });

test('matches the full sha', () => {
  assert.equal(matches(health(), SHA), true);
});

test('matches a 7-character prefix', () => {
  assert.equal(matches(health(), SHA.slice(0, 7)), true);
});

test('refuses a 6-character prefix', () => {
  assert.equal(matches(health(), SHA.slice(0, 6)), false);
});

test('refuses another sha', () => {
  assert.equal(matches(health(), OTHER), false);
  assert.equal(matches(health(), 'deadbeefdeadbeef'), false);
});

test('refuses a failed lastSwap to that sha', () => {
  const h = health({ lastSwap: { at: '2026-10-31T19:30:01.421Z', from: `c${OTHER}`, to: `c${SHA}`, ok: false } });
  assert.equal(matches(h, SHA), false);
  assert.equal(matches(h, SHA.slice(0, 7)), false);
});

test('a failed lastSwap to another sha does not block a match', () => {
  const h = health({ lastSwap: { at: '2026-10-31T19:30:01.421Z', from: `c${SHA}`, to: `c${OTHER}`, ok: false } });
  assert.equal(matches(h, SHA), true);
});

test('refuses a health body with no supervisor', () => {
  assert.equal(matches({ ok: true }, SHA), false);
  assert.equal(matches(null, SHA), false);
});

test('verify resolves once the supervisor serves the sha', async () => {
  const clock = fakeClock();
  const bodies = [health({ commit: OTHER }), health({ commit: OTHER }), health()];
  const urls = [];
  const fetch = async (url) => { urls.push(url); return respond(bodies.shift())(); };
  const out = await verify({ sha: SHA, host: 'https://dev.example.test/', timeoutMs: 900_000, fetch, clock });
  assert.equal(out.ok, true);
  assert.equal(out.health.supervisor.commit, SHA);
  assert.deepEqual(urls, Array(3).fill('https://dev.example.test/api/health'));
  assert.deepEqual(clock.sleeps, [10_000, 10_000]);
});

test('verify times out with the last health body', async () => {
  const clock = fakeClock();
  const fetch = respond(health({ commit: OTHER }));
  const out = await verify({ sha: 'deadbeefdeadbeef', host: 'https://dev.example.test', timeoutMs: 30_000, fetch, clock });
  assert.equal(out.ok, false);
  assert.equal(out.health.supervisor.commit, OTHER);
  assert.ok(clock.now() >= 30_000 && clock.now() <= 40_000);
});

test('verify keeps polling through fetch errors and non-200 answers', async () => {
  const clock = fakeClock();
  const answers = [
    async () => { throw new Error('ECONNRESET'); },
    respond(null, 502),
    respond(health()),
  ];
  const fetch = (url) => answers.shift()(url);
  const out = await verify({ sha: SHA, host: 'https://dev.example.test', timeoutMs: 900_000, fetch, clock });
  assert.equal(out.ok, true);
  assert.equal(clock.sleeps.length, 2);
});

test('verify on a timeout after only errors reports the last error', async () => {
  const clock = fakeClock();
  const fetch = async () => { throw new Error('ENOTFOUND'); };
  const out = await verify({ sha: SHA, host: 'https://dev.example.test', timeoutMs: 20_000, fetch, clock });
  assert.equal(out.ok, false);
  assert.deepEqual(out.health, { error: 'ENOTFOUND' });
});

test('parseArgs reads sha, host and timeout with defaults', () => {
  assert.deepEqual(parseArgs([SHA]), { sha: SHA, host: 'https://dev.weave.grunion.ai', timeoutMs: 900_000 });
  assert.deepEqual(parseArgs(['abcdef1', '--host', 'http://127.0.0.1:4500', '--timeout', '30']), { sha: 'abcdef1', host: 'http://127.0.0.1:4500', timeoutMs: 30_000 });
});

test('parseArgs refuses a missing or malformed sha and a bad timeout', () => {
  assert.throws(() => parseArgs([]), /sha/);
  assert.throws(() => parseArgs(['abcdef']), /sha/);
  assert.throws(() => parseArgs(['not-a-sha']), /sha/);
  assert.throws(() => parseArgs([SHA, '--timeout', 'soon']), /timeout/);
});
