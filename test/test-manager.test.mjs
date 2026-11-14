import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { request, managerDirectory, resourceReason } from '../scripts/test-manager.mjs';
import { managerHarness, stubBrowserDriver } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const { ROOT, scratch, env, cli, fixture } = managerHarness('weave-manager-test-');
const stubRoot = realpathSync(tempDir('weave-manager-stub-driver-'));
mkdirSync(join(stubRoot, 'scripts'));
for (const name of ['test.mjs', 'test-manager.mjs', 'failed-files.mjs']) writeFileSync(join(stubRoot, 'scripts', name), readFileSync(join(ROOT, 'scripts', name)));
stubBrowserDriver(stubRoot);
execFileSync('git', ['init', '-q'], { cwd: stubRoot });
const browserCli = args => {
  const child = spawn(process.execPath, [join(stubRoot, 'scripts/test.mjs'), ...args], { cwd: stubRoot, env });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return { child, done: new Promise(resolve => child.on('close', code => resolve({ code, out }))) };
};
const hold = release => `import test from 'node:test'; import { existsSync } from 'node:fs'; test('held', async () => { while (!existsSync(${JSON.stringify(release)})) await new Promise(r => setTimeout(r, 20)); });`;

test('manager directory is per-user and independent of a worktree', () => {
  const before = managerDirectory({});
  const old = process.env.TMPDIR;
  try { process.env.TMPDIR = '/tmp/different-worktree-tmp'; assert.equal(managerDirectory({}), before); }
  finally { if (old === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = old; }
  assert.ok(!managerDirectory({}).startsWith(ROOT));
});
test('resource admission reports disk, memory and load reasons', () => {
  assert.match(resourceReason({ freeGB: 1, memoryPercent: 50, load: 1, cpus: 10 }), /disk/);
  assert.match(resourceReason({ freeGB: 20, memoryPercent: 2, load: 1, cpus: 10 }), /memory/);
  assert.match(resourceReason({ freeGB: 20, memoryPercent: 50, load: 100, cpus: 10 }), /load/);
  assert.equal(resourceReason({ freeGB: 20, memoryPercent: 50, load: 1, cpus: 10 }), null);
});
test('two browser jobs share the one slot, run one after the other, and status names the running allocation', async () => {
  const events = join(scratch, 'events');
  const file = fixture('serial-browser', `import test from 'node:test'; import { appendFileSync } from 'node:fs'; test('owned allocation', async () => { appendFileSync(${JSON.stringify(events)}, 'start\\n'); await new Promise(r => setTimeout(r, 300)); appendFileSync(${JSON.stringify(events)}, 'end\\n'); });`);
  const a = browserCli([file]); const b = browserCli([file]);
  const first = await running(s => s.active?.files.includes(file));
  assert.equal(first.job.lane, 'browser');
  assert.equal(first.unit.length, 0, 'the second browser job waits for the slot, never beside it');
  const results = await Promise.all([a.done, b.done]);
  assert.ok(results.every(r => r.code === 0 && /in the browser slot/.test(r.out)), JSON.stringify(results));
  assert.equal(readFileSync(events, 'utf8'), 'start\nend\nstart\nend\n');
  const status = await request({ type: 'status' }, { directory: scratch });
  assert.equal(status.active, null); assert.equal(status.unit.length, 0); assert.equal(status.queued.length, 0);
});
test('a unit-only job is admitted beside an active browser job and never appears in status.active', async () => {
  const slotRelease = join(scratch, 'release-slot'), unitRelease = join(scratch, 'release-unit');
  const holder = fixture('slot-holder-browser', hold(slotRelease));
  const unit = fixture('beside-the-slot', hold(unitRelease));
  const slot = browserCli(['--timeout=30000', holder]);
  try {
    await running(s => s.active?.files.includes(holder));
    const beside = cli(['--timeout=30000', unit]);
    let finished = false;
    const outcome = beside.done.then(r => { finished = true; return r; });
    const seen = [];
    for (let i = 0; !finished && i < 1500; i++) {
      const status = await request({ type: 'status' }, { directory: scratch });
      seen.push(status);
      if (status.unit.some(job => job.files.includes(unit))) writeFileSync(unitRelease, '');
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(finished, 'the unit job finished while the browser job held the slot');
    const r = await outcome;
    assert.equal(r.code, 0, r.out); assert.match(r.out, /in the unit lane/);
    assert.ok(seen.some(s => s.unit.some(job => job.files.includes(unit) && job.lane === 'unit')), 'status listed the job in the unit lane');
    assert.ok(seen.every(s => !s.active?.files.includes(unit)), 'the unit job never held the slot');
    assert.ok(seen.every(s => s.active?.files.includes(holder)), 'the browser job held the slot throughout');
  } finally { writeFileSync(unitRelease, ''); writeFileSync(slotRelease, ''); }
  assert.equal((await slot.done).code, 0);
});
test('empty named selection fails instead of expanding to broad discovery', async () => {
  const r = await cli(['--targeted']).done;
  assert.notEqual(r.code, 0); assert.match(r.out, /empty|requires/i);
});
test('job timeout fails and the next queued job still completes', async () => {
  const hanging = fixture('hanging', "import test from 'node:test'; test('hang', async () => { await new Promise(r => setTimeout(r, 10000)); });");
  const good = fixture('good', "import test from 'node:test'; test('next', () => {});");
  const a = cli(['--timeout=250', hanging]); const b = cli([good]);
  const [failed, passed] = await Promise.all([a.done, b.done]);
  assert.notEqual(failed.code, 0); assert.match(failed.out, /timeout/i); assert.equal(passed.code, 0, passed.out);
});

async function running(ready = s => s.active || s.unit.length) {
  for (let i = 0; i < 200; i++) {
    const status = await request({ type: 'status' }, { directory: scratch }).catch(() => null);
    if (status && ready(status)) return { ...status, job: status.active || status.unit[0] };
    await new Promise(r => setTimeout(r, 30));
  }
  throw new Error('job never became active');
}
test('active cancellation removes owned temporary files and admits the next job', async () => {
  const file = fixture('cancel', "import test from 'node:test'; test('wait', async () => { await new Promise(r => setTimeout(r, 10000)); });");
  const a = cli([file]); const state = await running();
  assert.equal((await request({ type: 'cancel', id: state.job.id }, { directory: scratch })).code, 0);
  assert.notEqual((await a.done).code, 0);
  const { readdirSync } = await import('node:fs');
  assert.equal(readdirSync(scratch).filter(n => n.startsWith('job-')).length, 0);
});
test('worktree inputs modified during a job invalidate success', async () => {
  const file = fixture('drift', "import test from 'node:test'; test('wait', async () => { await new Promise(r => setTimeout(r, 400)); });");
  const a = cli([file]); await running();
  await new Promise(r => setTimeout(r, 150)); writeFileSync(file, readFileSync(file, 'utf8') + '\n// changed\n');
  const result = await a.done;
  assert.notEqual(result.code, 0); assert.match(result.out, /changed during tests/);
});
test('disconnected clients cancel their allocation', async () => {
  const file = fixture('disconnect', "import test from 'node:test'; test('wait', async () => { await new Promise(r => setTimeout(r, 10000)); });");
  const a = cli([file]); await running(); a.child.kill('SIGKILL'); await a.done;
  for (let i = 0; i < 100; i++) {
    const status = await request({ type: 'status' }, { directory: scratch });
    if (!status.active && !status.unit.length) return;
    await new Promise(r => setTimeout(r, 30));
  }
  assert.fail('disconnected client retained allocation');
});
test('daemon death reaps its active test process and stale socket restarts', async () => {
  const marker = join(scratch, 'owned-pid');
  const file = fixture('daemon-death', `import test from 'node:test'; import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, String(process.pid)); test('wait', async () => { await new Promise(r => setTimeout(r, 10000)); });`);
  const a = cli([file]); const status = await running();
  let pid;
  for (let i = 0; i < 100; i++) { try { pid = Number(readFileSync(marker, 'utf8')); break; } catch {} await new Promise(r => setTimeout(r, 30)); }
  assert.ok(pid); process.kill(status.pid, 'SIGKILL'); assert.notEqual((await a.done).code, 0);
  let alive = true;
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { alive = false; break; } await new Promise(r => setTimeout(r, 30)); }
  assert.equal(alive, false, 'test child survived its daemon');
  const good = fixture('restart', "import test from 'node:test'; test('restart', () => {});");
  const result = await cli([good]).done; assert.equal(result.code, 0, result.out);
});


test('warm daemon survives deletion of its original worktree source', async () => {
  const source = join(scratch, 'disposable-manager.mjs');
  const directory = mkdtempSync('/tmp/weave-disposable-');
  writeFileSync(source, readFileSync(join(ROOT, 'scripts/test-manager.mjs')));
  const daemon = spawn(process.execPath, [realpathSync(source), '--serve', directory], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { await request({ type: 'status' }, { directory }); ready = true; break; } catch {} await new Promise(r => setTimeout(r, 30)); }
    assert.ok(ready); rmSync(source);
    const good = fixture('worktree-removed', "import test from 'node:test'; test('survivor', () => {});");
    const result = await cli([good], { WEAVE_TEST_MANAGER_DIR: directory }).done;
    assert.equal(result.code, 0, result.out);
  } finally { await request({ type: 'stop' }, { directory }).catch(() => {}); daemon.kill(); rmSync(directory, { recursive: true, force: true }); }
});
