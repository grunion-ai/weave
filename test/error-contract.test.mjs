import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { ERROR_CONTRACT, contractFor, errorBody } from '../src/errors.js';
import { tempDir } from './lib/temp.mjs';
import { withServer } from './lib/fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');

function seed(w) {
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  return w;
}

const CASES = [
  {
    code: 'not-found',
    cli: ['get', 'Task#99'],
    mcp: ['weave_get_entity', { entity: 'Task#99' }],
    http: ['GET', '/api/entities/Task%2399'],
  },
  {
    code: 'invalid',
    cli: ['field', 'add', 'Task', 'Points', 'bogus'],
    mcp: ['weave_add_field', { db: 'Task', name: 'Points', type: 'bogus' }],
    http: ['POST', '/api/tables/Task/fields', { name: 'Points', type: 'bogus' }],
  },
  {
    code: 'conflict',
    cli: ['table', 'create', 'Ops', 'Task'],
    mcp: ['weave_create_table', { space: 'Ops', name: 'Task' }],
    http: ['POST', '/api/tables', { space: 'Ops', name: 'Task' }],
  },
];

test('every WeaveError code names one HTTP status, one MCP code and one CLI exit (Feature #179)', () => {
  const exits = new Map();
  for (const [code, c] of Object.entries(ERROR_CONTRACT)) {
    assert.ok(Number.isInteger(c.http) && c.http >= 400 && c.http < 600, `${code} http`);
    assert.ok(Number.isInteger(c.mcp) && c.mcp < -32000 + 1 && c.mcp >= -32768, `${code} mcp`);
    assert.ok(Number.isInteger(c.exit) && c.exit > 0 && c.exit < 126, `${code} exit`);
    if (exits.has(c.exit)) assert.equal(ERROR_CONTRACT[exits.get(c.exit)].http, c.http, `${code} shares exit ${c.exit} with ${exits.get(c.exit)} only when the status matches`);
    exits.set(c.exit, code);
  }
  assert.deepEqual(contractFor(new WeaveError('x', 'not-found')), { code: 'not-found', ...ERROR_CONTRACT['not-found'] });
  assert.equal(contractFor(new WeaveError('x')).exit, 1, 'an uncoded WeaveError keeps exit 1');
  assert.equal(contractFor(new WeaveError('x', 'no-such-code')).http, 400, 'an unknown code is a 400');
  assert.equal(contractFor(new Error('boom')).http, 500);
  assert.deepEqual(errorBody(new WeaveError('gone', 'not-found')), { error: 'gone', code: 'not-found' });
});

test('one failure answers the same message and code on CLI, MCP and HTTP (Feature #179)', async () => {
  const dir = tempDir('weave-error-contract-');
  const data = join(dir, 'ws.db');
  const env = { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json'), WEAVE_ACTOR: 'contract' };
  const cli = (args) => spawnSync(process.execPath, ['--no-warnings', BIN, ...args, '--data', data], { encoding: 'utf8', env });
  assert.equal(cli(['space', 'create', 'Ops']).status, 0);
  assert.equal(cli(['table', 'create', 'Ops', 'Task']).status, 0);
  const w = seed(new Weave());
  await withServer(w, async ({ base }) => {
    for (const c of CASES) {
      const want = ERROR_CONTRACT[c.code];
      const r = cli(c.cli);
      assert.equal(r.status, want.exit, `weave ${c.cli.join(' ')} exits ${want.exit}: ${r.stderr}`);
      const cliLine = r.stderr.trim().split('\n').pop();
      const m = /^weave: error \[([a-z_-]+)\]: (.*)$/.exec(cliLine);
      assert.ok(m, `CLI names the code: ${cliLine}`);
      assert.equal(m[1], c.code);

      const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: c.mcp[0], arguments: c.mcp[1] } }, { tools: 'all' });
      assert.equal(res.result.isError, true, c.mcp[0]);
      assert.deepEqual(Object.keys(res.result.structuredContent).sort(), ['code', 'error', 'rpc']);
      assert.equal(res.result.structuredContent.code, c.code, `${c.mcp[0]} keeps the code`);
      assert.equal(res.result.structuredContent.rpc, want.mcp);
      assert.equal(res.result.content[0].text, `Error: ${res.result.structuredContent.error}`, 'the text line still reads Error: message');

      const [method, path, body] = c.http;
      const h = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      assert.equal(h.status, want.http, `${method} ${path}`);
      const hb = await h.json();
      assert.equal(hb.code, c.code);

      assert.equal(m[2], hb.error, `CLI and HTTP agree on the message for ${c.code}`);
      assert.equal(res.result.structuredContent.error, hb.error, `MCP and HTTP agree on the message for ${c.code}`);
    }
  });
});
