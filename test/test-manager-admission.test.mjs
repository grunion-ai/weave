/* Feature #236 review (change 446, patchset 2): a job the manager never
   admits must say so in a way the gate can tell apart from a red suite, and
   a manager started from older code must not serve newer worktrees. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as manager from '../scripts/test-manager.mjs';
import { managerHarness } from './lib/fixtures.mjs';

const { ROOT, scratch, cli, fixture } = managerHarness('weave-admission-test-');
const trivial = () => fixture(`trivial-${Math.random().toString(36).slice(2)}`, "import test from 'node:test'; test('ran', () => {});");

test('a job the manager never admits within WEAVE_TEST_QUEUE_WAIT_MS exits 75 with a NOT ADMITTED marker naming the reason', { timeout: 20_000 }, async () => {
  const r = await cli([trivial()], { WEAVE_TEST_MAX_LOAD: '-1', WEAVE_TEST_QUEUE_WAIT_MS: '300' }).done;
  assert.equal(r.code, manager.NOT_ADMITTED, r.out);
  assert.equal(manager.NOT_ADMITTED, 75);
  assert.match(r.out, /^# TEST MANAGER NOT ADMITTED: .*load: [\d.]+ \(limit -1\)/m, r.out);
  assert.doesNotMatch(r.out, /^# TEST MANAGER running/m, 'the job never ran');
});

test('a queued job cut off by a manager stop is NOT ADMITTED too, not a red run', { timeout: 20_000 }, async () => {
  const a = cli([trivial()], { WEAVE_TEST_MAX_LOAD: '-1', WEAVE_TEST_QUEUE_WAIT_MS: '600000' });
  for (let i = 0; i < 200; i++) {
    const status = await manager.request({ type: 'status' }, { directory: scratch }).catch(() => null);
    if (status?.queued?.length) break;
    await new Promise(r => setTimeout(r, 30));
  }
  await manager.request({ type: 'stop' }, { directory: scratch });
  const r = await a.done;
  assert.equal(r.code, 75, r.out);
  assert.match(r.out, /^# TEST MANAGER NOT ADMITTED: manager stopped/m, r.out);
});

test('the default job timeout matches the gate cap of 3600 s', () => {
  assert.equal(typeof manager.jobTimeout, 'function', 'jobTimeout is exported');
  assert.equal(manager.jobTimeout(undefined), 3_600_000);
  assert.equal(manager.jobTimeout(3_600_000), 3_600_000);
  assert.equal(manager.jobTimeout(5 * 3_600_000), 3_600_000, 'capped at an hour');
  assert.equal(manager.jobTimeout(10), 100);
});

test('the manager directory is keyed on a hash of the manager source', async () => {
  const current = manager.managerDirectory({});
  assert.match(current, /weave-test-manager-[^/]+-[0-9a-f]{12}$/);
  const older = join(scratch, 'older-test-manager.mjs');
  writeFileSync(older, readFileSync(join(ROOT, 'scripts/test-manager.mjs'), 'utf8') + '\n// an older build\n');
  const stale = await import(pathToFileURL(older).href);
  assert.notEqual(stale.managerDirectory({}), current, 'different source, different socket');
  assert.equal(manager.managerDirectory({ WEAVE_TEST_MANAGER_DIR: '/tmp/x' }), '/tmp/x', 'an explicit directory still wins');
});
