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
test('manager (browser): warm browser reused across jobs with fresh contexts', { skip: chromium ? false : 'playwright not installed' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weave-browser-manager-'));
  const helper = pathToFileURL(join(ROOT, 'test/lib/browser.mjs')).href;
  const env = { ...process.env, NODE_TEST_CONTEXT: '', WEAVE_TEST_JOB: '', WEAVE_TEST_BROWSER_ENDPOINT: '', WEAVE_TEST_MANAGER_DIR: directory,
    WEAVE_TEST_MIN_FREE_GB: '0', WEAVE_TEST_MIN_MEMORY_PERCENT: '0', WEAVE_TEST_MAX_LOAD: '99999' };
  async function run(name, body) {
    const file = join(directory, `${name}.test.mjs`);
    writeFileSync(file, `import test from 'node:test'; import assert from 'node:assert/strict'; import { chromium } from ${JSON.stringify(helper)}; test('isolated connection', async () => { const connection = await chromium.launch(); try { ${body} } finally { await connection.close(); } });`);
    const child = spawn(process.execPath, ['scripts/test.mjs', file], { cwd: ROOT, env });
    let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    const code = await new Promise(r => child.on('close', r)); assert.equal(code, 0, output);
    return request({ type: 'status' }, { directory });
  }
  try {
    const first = await run('first', `const one = await connection.newContext(); await one.addCookies([{ name: 'private', value: 'one', domain: 'example.com', path: '/' }]); const two = await connection.newContext(); assert.equal((await two.cookies()).length, 0);`);
    const second = await run('second', `assert.equal(connection.contexts().length, 0); const context = await connection.newContext(); assert.equal((await context.cookies()).length, 0);`);
    assert.ok(first.browser?.pid); assert.equal(second.browser.pid, first.browser.pid);
    assert.equal(second.browser.jobs, 2);
  } finally { await request({ type: 'stop' }, { directory }).catch(() => {}); rmSync(directory, { recursive: true, force: true }); }
});
