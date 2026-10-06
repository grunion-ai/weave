import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { request } from '../scripts/test-manager.mjs';
import { chromium } from './lib/browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const helper = pathToFileURL(join(ROOT, 'test/lib/browser.mjs')).href;
const skip = chromium ? false : 'playwright not installed';
const directory = mkdtempSync(join(tmpdir(), 'weave-lease-test-'));
test.after(async () => { await request({ type: 'stop' }, { directory }).catch(() => {}); rmSync(directory, { recursive: true, force: true }); });

function script(name, body, overrides = {}, deadline = 60_000) {
  const file = join(directory, `${name}.mjs`);
  writeFileSync(file, `import { chromium } from ${JSON.stringify(helper)};\n${body}\n`);
  const child = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, NODE_TEST_CONTEXT: '', WEAVE_TEST_JOB: '', WEAVE_TEST_BROWSER_ENDPOINT: '',
    WEAVE_TEST_MANAGER_DIR: directory, WEAVE_TEST_MIN_FREE_GB: '0', WEAVE_TEST_MIN_MEMORY_PERCENT: '0', WEAVE_TEST_MAX_LOAD: '99999', ...overrides } });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => { out += '\n<killed at deadline>'; child.kill('SIGKILL'); }, deadline);
  return new Promise(r => child.on('close', code => { clearTimeout(timer); r({ code, out }); }));
}

test('a raw lease carries the admission overrides to the manager', { skip, timeout: 60_000 }, async () => {
  const r = await script('overrides', `
    try { const b = await chromium.launch(); console.log('ADMITTED'); await b.close(); }
    catch (error) { console.log('REFUSED', error.code, error.message); }`,
  { WEAVE_TEST_MAX_LOAD: '-1', WEAVE_TEST_QUEUE_WAIT_MS: '300' }, 30_000);
  assert.match(r.out, /REFUSED 75 .*load: [\d.]+ \(limit -1\)/, r.out);
});

test('two launches in one process share one lease, released after both close', { skip, timeout: 150_000 }, async () => {
  const r = await script('two-launches', `
    const a = await chromium.launch(); console.log('FIRST');
    const b = await chromium.launch(); console.log('SECOND', a.isConnected(), b.isConnected());
    await a.close();
    const context = await b.newContext(); await context.close();
    console.log('SECOND STILL LEASED', b.isConnected());
    await b.close(); console.log('CLOSED');`, {}, 120_000);
  assert.match(r.out, /SECOND true true/, r.out);
  assert.match(r.out, /SECOND STILL LEASED true/, r.out);
  assert.match(r.out, /CLOSED/, r.out);
  assert.equal(r.code, 0, r.out);
  const status = await request({ type: 'status' }, { directory });
  assert.equal(status.active, null, 'the lease was released'); assert.equal(status.queued.length, 0);
});
