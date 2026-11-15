import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const run = promisify(execFile);

const cleanEnv = () => {
  const env = { ...process.env, WEAVE_UPDATE_CHECK: 'off' };
  for (const k of ['WEAVE_AUTO_UPDATE', 'WEAVE_DEFER_MIGRATIONS', 'WEAVE_TRACK', 'WEAVE_DEPLOY_TOKEN']) delete env[k];
  return env;
};

test('form create refuses a definition that is JSON but not an object', async () => {
  const data = join(tempDir('weave-cli-form-'), 'w.db');
  for (const definition of ['"just text"', '5', 'true', '[1, 2]', 'null']) {
    const r = await run('node', [BIN, '--data', data, 'form', 'create', '--definition', definition], { env: cleanEnv() }).catch((e) => e);
    assert.match(r.stderr, /form create\/update needs --definition as a JSON object/, `--definition ${definition}`);
  }
});

test('supervise with WEAVE_AUTO_UPDATE on starts the supervisor and names the release it serves', async () => {
  const dir = tempDir('weave-cli-supervise-');
  const data = join(dir, 'weave.db');
  const child = spawn(process.execPath, [BIN, 'supervise', '--port', '0', '--data', data], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnv(), WEAVE_AUTO_UPDATE: '1' } });
  let log = '';
  const seen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`supervise never reported:\n${log}`)), 60_000);
    child.stdout.on('data', (d) => { log += d; if (/weave supervise: serving/.test(log)) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (d) => { log += d; });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`supervise exited ${code}:\n${log}`)); });
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    await seen;
    assert.match(log, /weave supervise: serving image \(.+\) at http:\/\/127\.0\.0\.1:\d+; checking for a newer release every 10 minutes/);
  } finally {
    child.kill('SIGKILL');
    await closed;
  }
});
