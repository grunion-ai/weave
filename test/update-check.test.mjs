/* Issue #253: a newer release has to reach the person running an old one.

   Tags and GitHub Releases are published on every landing now, but a running
   instance compared itself only with main's sha (`behind`), and a plain clone
   or a source zip never learned a release existed. Kyle decided on 2026-09-28
   that the server asks GitHub for the latest release at most once a day,
   compares it with its own package version, and says so where the stale and
   behind signals already show. WEAVE_UPDATE_CHECK=off makes no request at all.

   None of these tests reach GitHub: every check gets an injected fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReleaseCheck, updateCheckFromEnv, newerVersion, RELEASES_URL } from '../src/update-check.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-09-28T12:00:00Z');
const answer = (tag) => async () => new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/grunion-ai/weave/releases/tag/${tag}` }), { status: 200 });
function counting(impl) {
  const f = async (...a) => { f.calls.push(a); return impl(...a); };
  f.calls = [];
  return f;
}
const scratch = () => join(mkdtempSync(join(tmpdir(), 'weave-update-')), 'update-check.json');
const clock = (t = T0) => { const c = () => c.t; c.t = t; return c; };

test('the switch reads WEAVE_UPDATE_CHECK: on unless it says off', () => {
  assert.equal(updateCheckFromEnv({}), true, 'on by default');
  for (const v of ['off', 'OFF', '0', 'false', 'no', ' off ']) assert.equal(updateCheckFromEnv({ WEAVE_UPDATE_CHECK: v }), false, v);
  for (const v of ['on', '1', 'true', '']) assert.equal(updateCheckFromEnv({ WEAVE_UPDATE_CHECK: v }), true, JSON.stringify(v));
});

test('switched off, the check makes no request and reports nothing', async () => {
  const fetch = counting(answer('v9.9.9'));
  const check = createReleaseCheck({ version: '0.4.51', enabled: false, fetch, cacheFile: scratch() });
  assert.equal(check.status(), null);
  await check.refresh();
  assert.equal(check.status(), null);
  assert.equal(fetch.calls.length, 0, 'no request at all');
});

test('one unauthenticated GET to the latest-release endpoint, nothing about the install in it', async () => {
  const fetch = counting(answer('v0.4.52'));
  const check = createReleaseCheck({ version: '0.4.51', fetch, cacheFile: scratch(), now: clock() });
  await check.refresh();
  assert.equal(fetch.calls.length, 1);
  const [url, init] = fetch.calls[0];
  assert.equal(url, RELEASES_URL);
  assert.equal(RELEASES_URL, 'https://api.github.com/repos/grunion-ai/weave/releases/latest');
  assert.equal(init.method ?? 'GET', 'GET');
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  assert.ok(!('authorization' in headers), 'no token');
  assert.ok(init.signal, 'the request can time out');
});

test('a newer release marks the install behind it', async () => {
  const now = clock();
  const check = createReleaseCheck({ version: '0.4.51', fetch: answer('v0.4.52'), cacheFile: scratch(), now });
  await check.refresh();
  assert.deepEqual(check.status(), { latestRelease: '0.4.52', releaseCheckedAt: new Date(T0).toISOString(), releaseBehind: true });
});

test('an equal or older release does not', async () => {
  for (const tag of ['v0.4.51', 'v0.4.50', 'v0.3.99']) {
    const check = createReleaseCheck({ version: '0.4.51', fetch: answer(tag), cacheFile: scratch(), now: clock() });
    await check.refresh();
    assert.equal(check.status().releaseBehind, false, tag);
    assert.equal(check.status().latestRelease, tag.slice(1));
  }
});

test('versions compare numerically, not as strings', () => {
  assert.equal(newerVersion('0.4.10', '0.4.9'), true);
  assert.equal(newerVersion('0.10.0', '0.9.9'), true);
  assert.equal(newerVersion('1.0.0', '0.99.99'), true);
  assert.equal(newerVersion('0.4.9', '0.4.10'), false);
  assert.equal(newerVersion('0.4.51', '0.4.51'), false);
});

test('it runs at most once a day, and a restart inside the day reads the cache instead', async () => {
  const cacheFile = scratch();
  const now = clock();
  const fetch = counting(answer('v0.4.52'));
  const first = createReleaseCheck({ version: '0.4.51', fetch, cacheFile, now });
  first.status(); // the first status kicks the request off without waiting for it
  await first.refresh();
  first.status(); first.status();
  await first.refresh();
  assert.equal(fetch.calls.length, 1, 'repeated health calls reuse the answer');
  assert.ok(existsSync(cacheFile), 'the answer is kept on disk with its timestamp');
  const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
  assert.equal(cached.latest, '0.4.52');
  assert.equal(cached.checkedAt, T0);

  now.t = T0 + DAY - 60_000;
  const restarted = createReleaseCheck({ version: '0.4.51', fetch, cacheFile, now });
  assert.equal(restarted.status().releaseBehind, true, 'the restart knows the answer at once');
  await restarted.refresh();
  assert.equal(fetch.calls.length, 1, 'a restart inside the day makes no request');

  now.t = T0 + DAY + 1;
  restarted.status();
  await restarted.refresh();
  assert.equal(fetch.calls.length, 2, 'a day later it asks again');
});

test('a failed request changes nothing and throws nothing', async () => {
  const failures = {
    'no network': async () => { throw new TypeError('fetch failed'); },
    'rate limit': async () => new Response('{"message":"API rate limit exceeded"}', { status: 403 }),
    'not json': async () => new Response('<html>', { status: 200 }),
    'no tag': async () => new Response('{"name":"x"}', { status: 200 }),
    'odd tag': async () => new Response('{"tag_name":"nightly"}', { status: 200 }),
  };
  for (const [why, impl] of Object.entries(failures)) {
    const cold = createReleaseCheck({ version: '0.4.51', fetch: impl, cacheFile: scratch(), now: clock() });
    await cold.refresh();
    assert.equal(cold.status(), null, `${why}: nothing is reported as newer`);

    const cacheFile = scratch();
    writeFileSync(cacheFile, JSON.stringify({ latest: '0.4.51', checkedAt: T0 - 2 * DAY }));
    const warm = createReleaseCheck({ version: '0.4.51', fetch: impl, cacheFile, now: clock() });
    const before = warm.status();
    await warm.refresh();
    assert.deepEqual(warm.status(), before, `${why}: the previous answer stands`);
    assert.equal(warm.status().releaseBehind, false);
  }
});

test('a failed request still waits a day before the next try', async () => {
  const now = clock();
  const fetch = counting(async () => { throw new TypeError('fetch failed'); });
  const check = createReleaseCheck({ version: '0.4.51', fetch, cacheFile: scratch(), now });
  check.status(); await check.refresh();
  now.t += 60 * 60 * 1000;
  check.status(); await check.refresh();
  assert.equal(fetch.calls.length, 1, 'no retry storm against a rate limit');
});

test('a hung request times out in seconds and never blocks a status call', async () => {
  let aborted = false;
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }));
  const check = createReleaseCheck({ version: '0.4.51', fetch: hang, cacheFile: scratch(), timeoutMs: 50 });
  const t = Date.now();
  assert.equal(check.status(), null, 'status answers at once while the request is out');
  assert.ok(Date.now() - t < 20);
  await check.refresh();
  assert.equal(aborted, true, 'the request was cut off');
  assert.equal(check.status(), null);
});

/* Issue #563: the timeout has to fire on its own. AbortSignal.timeout's timer is
   unref'd, so a hung request was cut off only while something else happened to hold
   the event loop open: the test runner's own handles on node 24, nothing on 22.16,
   where the case above and every case after it were cancelled with "Promise
   resolution is still pending but the event loop has already resolved" and reddened
   both 22.16 legs of the tests workflow. A bare child process holds no such handles,
   so it reproduces that on any node. */
test('the timeout fires with nothing else holding the event loop open', () => {
  const src = JSON.stringify(fileURLToPath(new URL('../src/update-check.js', import.meta.url)));
  const script = `
    const { createReleaseCheck } = await import(${src});
    let aborted = false;
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }));
    await createReleaseCheck({ version: '0.4.51', fetch: hang, timeoutMs: 50 }).refresh();
    console.log(aborted ? 'aborted' : 'never aborted');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, `the check alone has to keep the loop alive until it times out; exit ${r.status}: ${r.stderr}`);
  assert.equal(r.stdout.trim(), 'aborted', 'the hung request was cut off');
});

/* The other side of that timer: it is ref'd, so a cut-off left armed after the answer
   would hold weave open for the rest of timeoutMs. The child asks for a 20 s cut-off and
   gets its answer at once, so it exits in milliseconds or not before this call's 4 s. */
test('the cut-off is cleared when the answer lands, so the process still exits at once', () => {
  const src = JSON.stringify(fileURLToPath(new URL('../src/update-check.js', import.meta.url)));
  const script = `
    const { createReleaseCheck } = await import(${src});
    const reply = async () => new Response('{"tag_name":"v0.4.52"}', { status: 200 });
    const check = createReleaseCheck({ version: '0.4.51', fetch: reply, timeoutMs: 20_000 });
    await check.refresh();
    console.log(check.status().latestRelease);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 4000 });
  assert.equal(r.signal, null, 'the answered check kept the process alive for its whole cut-off');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '0.4.52');
});

test('an unreadable cache is ignored, not fatal', async () => {
  const cacheFile = scratch();
  writeFileSync(cacheFile, 'not json');
  const check = createReleaseCheck({ version: '0.4.51', fetch: answer('v0.4.52'), cacheFile, now: clock() });
  assert.equal(check.status(), null);
  await check.refresh();
  assert.equal(check.status().releaseBehind, true);
});

test('/api/health carries the release verdict beside sha and behind, which keep their meaning', async () => {
  const { startServer, buildInfo, armReleaseCheck, describeBuild } = await import('../src/server.js');
  const { Weave } = await import('../src/engine.js');
  const check = createReleaseCheck({ version: '0.0.1', fetch: answer('v99.0.0'), cacheFile: scratch(), now: clock() });
  await check.refresh();
  armReleaseCheck(check);
  const { server, port } = await startServer(new Weave(), { port: 0, build: buildInfo });
  try {
    const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(h.latestRelease, '99.0.0');
    assert.equal(h.releaseCheckedAt, new Date(T0).toISOString());
    assert.equal(h.releaseBehind, true);
    assert.match(h.sha ?? '', /^[0-9a-f]{7}$/, 'the commit fields are still there');
  } finally {
    server.close();
    armReleaseCheck(null);
  }
  // behind still means main has a commit the boot head lacks (Issue #459), nothing else
  const s = (c) => c.repeat(40);
  assert.equal(describeBuild({ head: s('a'), disk: s('a'), latest: s('b') }).behind, true);
  assert.ok(!('releaseBehind' in describeBuild({ head: s('a'), disk: s('a'), latest: s('a') })));
});

test('weave serve arms the check from WEAVE_UPDATE_CHECK, after the server is listening', () => {
  const bin = readFileSync(new URL('../bin/weave.js', import.meta.url), 'utf8');
  const serve = bin.slice(bin.indexOf("const { port: actual } = await startServer(w"));
  assert.match(bin, /updateCheckFromEnv\(\)/, 'the switch is the environment, like every other serve setting');
  assert.match(serve, /createReleaseCheck\(/, 'the check is created after startServer, so it never delays the listen');
  assert.match(serve, /armReleaseCheck\(/);
});

test('the instance chip says a newer release exists, in the place behind already uses', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const chip = app.slice(app.indexOf('state.healthChip = el('), app.indexOf("stats.append(status);"));
  assert.match(chip, /h\.releaseBehind/, 'the chip reads the release verdict');
  assert.match(chip, /is-behind/, 'with the existing behind style, no new banner');
  assert.match(chip, /latestRelease/);
});
