import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { request, managerDirectory, resourceReason } from '../scripts/test-manager.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'weave-manager-test-'));
const env = { ...process.env, WEAVE_TEST_MANAGER_DIR: scratch, WEAVE_TEST_JOB: '', NODE_TEST_CONTEXT: '', WEAVE_TEST_MIN_FREE_GB: '0', WEAVE_TEST_MIN_MEMORY_PERCENT: '0', WEAVE_TEST_MAX_LOAD: '99999' };
test.after(async () => { await request({ type: 'stop' }, { directory: scratch }).catch(() => {}); rmSync(scratch, { recursive: true, force: true }); });
function cli(args, overrides = {}) {
  const child = spawn(process.execPath, ['scripts/test.mjs', ...args], { cwd: ROOT, env: { ...env, ...overrides } });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return { child, done: new Promise(resolve => child.on('close', code => resolve({ code, out }))) };
}
function fixture(name, source) { const path = join(scratch, `${name}.test.mjs`); writeFileSync(path, source); return path; }

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
test('two requested test jobs execute serially and status names the running allocation', async () => {
  const events = join(scratch, 'events');
  const file = fixture('serial', `import test from 'node:test'; import { appendFileSync } from 'node:fs'; test('owned allocation', async () => { appendFileSync(${JSON.stringify(events)}, 'start\\n'); await new Promise(r => setTimeout(r, 300)); appendFileSync(${JSON.stringify(events)}, 'end\\n'); });`);
  const a = cli([file]); const b = cli([file]);
  const results = await Promise.all([a.done, b.done]);
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  assert.equal(readFileSync(events, 'utf8'), 'start\nend\nstart\nend\n');
  const status = await request({ type: 'status' }, { directory: scratch });
  assert.equal(status.active, null); assert.equal(status.queued.length, 0);
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

async function running() {
  for (let i = 0; i < 100; i++) {
    const status = await request({ type: 'status' }, { directory: scratch }).catch(() => null);
    if (status?.active) return status;
    await new Promise(r => setTimeout(r, 30));
  }
  throw new Error('job never became active');
}
test('active cancellation removes owned temporary files and admits the next job', async () => {
  const file = fixture('cancel', "import test from 'node:test'; test('wait', async () => { await new Promise(r => setTimeout(r, 10000)); });");
  const a = cli([file]); const state = await running();
  assert.equal((await request({ type: 'cancel', id: state.active.id }, { directory: scratch })).code, 0);
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
    if (!status.active) return;
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
