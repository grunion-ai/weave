/* Issue #114 — a server process that outlived its own checkout.

   Static assets (app.js, style.css) are read from disk per request; src/* is
   loaded once at boot. So a checkout that moves under a running process
   serves NEW client code against an OLD engine. On 2026-08-28 the :4400
   process booted at 07:54, commit 3f3075d landed at 07:57, and + New /
   Shift+Enter row creation failed silently for everyone holding the page —
   nothing on screen said the two halves disagreed.

   `behind` (Feature #171) cannot carry this. It compares the boot HEAD to the
   REMOTE's main, it is fetched lazily and at most every five minutes (so the
   first health call after a boot has no verdict at all), it is absent
   whenever ls-remote fails, and its remedy is a pull. The dangerous condition
   is local, synchronous and fixed by a restart: the HEAD on disk is not the
   HEAD this process booted from. Health carries that as `diskSha` + `stale`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBuild, buildInfo, startServer } from '../src/server.js';
import { Weave } from '../src/engine.js';

const sha = (c) => c.repeat(40);

test('describeBuild: the checkout moved under the process — stale', () => {
  const b = describeBuild({ head: sha('a'), disk: sha('b') });
  assert.equal(b.sha, 'aaaaaaa', 'the commit this process booted from');
  assert.equal(b.diskSha, 'bbbbbbb', 'the commit that served the page');
  assert.equal(b.stale, true, 'the engine is older than the app.js beside it');
});

test('describeBuild: process and checkout agree — not stale', () => {
  const b = describeBuild({ head: sha('c'), disk: sha('c') });
  assert.equal(b.stale, false, 'stale is a verdict, not a maybe');
});

test('describeBuild: no readable disk head leaves no verdict behind', () => {
  const b = describeBuild({ head: sha('d'), disk: null });
  assert.equal(b.sha, 'ddddddd');
  assert.ok(!('stale' in b), 'a checkout that cannot be read is not evidence of staleness');
  assert.ok(!('diskSha' in b));
});

test('describeBuild: stale is decided without waiting for a remote', () => {
  // The five-minute ls-remote had not answered yet on the load that broke:
  // no latest, no `behind`, and the page still ran new code on an old engine.
  const b = describeBuild({ head: sha('a'), disk: sha('b'), latest: null });
  assert.equal(b.stale, true);
  assert.ok(!('behind' in b), 'behind needs the remote; stale never does');
});

test('describeBuild: a current process on an old checkout is behind, not stale', () => {
  const b = describeBuild({ head: sha('a'), disk: sha('a'), latest: sha('b') });
  assert.equal(b.stale, false, 'the two halves agree — nothing is broken, only old');
  assert.equal(b.behind, true, 'and the pull is still owed');
});

test('describeBuild: nothing to say without a head', () => {
  assert.equal(describeBuild({ head: null, disk: sha('a') }), null);
});

test('/api/health carries the disk head beside the boot head', async () => {
  // Build info is opt-in (Feature #171) — the shared test server must stay
  // silent — so this spins its own the way bin/weave.js serve does.
  const { server, port } = await startServer(new Weave(), { port: 0, build: buildInfo });
  try {
    const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.match(h.sha ?? '', /^[0-9a-f]{7}$/, 'the running commit rides the payload');
    assert.match(h.diskSha ?? '', /^[0-9a-f]{7}$/, 'and the commit on disk beside it');
    assert.equal(typeof h.stale, 'boolean', 'stale is a verdict, not a maybe');
    assert.equal(h.stale, h.diskSha !== h.sha, 'and it is exactly the disagreement');
  } finally {
    server.close();
  }
});
