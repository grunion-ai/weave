import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { bootAndStop } from './lib/serve-fixture.mjs';

function child(t, source) {
  const proc = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); });
  return proc;
}

test('boot timeout reaps the server before rejecting', async (t) => {
  const proc = child(t, 'setInterval(() => {}, 1000)');
  await assert.rejects(bootAndStop(proc, { timeout: 200, killAfter: 100 }), /serve never came up/);
  assert.ok(proc.signalCode, 'the timed-out child is still alive');
});

test('successful boot reaps a server that ignores SIGTERM', async (t) => {
  const proc = child(t, "process.on('SIGTERM', () => {}); console.log('Weave running'); setInterval(() => {}, 1000)");
  const log = await bootAndStop(proc, { timeout: 10000, killAfter: 100 });
  assert.match(log, /Weave running/);
  assert.equal(proc.signalCode, 'SIGKILL');
});

test('early exit reports the server output', async (t) => {
  const proc = child(t, "console.error('boot failed'); process.exitCode = 7");
  await assert.rejects(bootAndStop(proc), /serve exited 7:[\s\S]*boot failed/);
});

test('spawn errors reject without waiting for the boot timeout', async () => {
  const proc = spawn('/nonexistent-weave-fixture-executable', [], { stdio: ['ignore', 'pipe', 'pipe'] });
  await assert.rejects(bootAndStop(proc), /ENOENT/);
});
