import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { ERROR_CONTRACT, ERROR_CODES, HTTP_ONLY_CODES, contractFor, errorBody } from '../src/errors.js';
import { tempDir } from './lib/temp.mjs';
import { withServer } from './lib/fixtures.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');
const SRC = join(ROOT, 'src');
const srcFiles = () => readdirSync(SRC).filter((n) => n.endsWith('.js'));
const srcOf = (name) => readFileSync(join(SRC, name), 'utf8');

function argsAfter(src, at) {
  let i = at, depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    i += 1;
  }
  return src.slice(at, i - 1);
}

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
  const cli = (args) => spawnSync(process.execPath, ['--no-warnings', BIN, ...args, '--data', data], { encoding: 'utf8', env, timeout: 120_000 });
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

test('every code a response body names is in the contract or the HTTP-only list (Issue #1640)', () => {
  const unlisted = [];
  const emitted = new Set();
  for (const file of srcFiles()) {
    const src = srcOf(file);
    for (const line of src.split('\n')) {
      if (!/\berror\b/.test(line)) continue;
      for (const [, expr] of line.matchAll(/(?<![\w_])code: ([^,}\n]+)/g)) {
        for (const [, code] of expr.matchAll(/'([\w-]+)'/g)) {
          emitted.add(code);
          if (!ERROR_CODES.includes(code)) unlisted.push(`src/${file} answers code '${code}'`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(unlisted)].sort(), [], 'add the code to ERROR_CONTRACT when all three doors reach it, else to HTTP_ONLY_CODES');
  assert.deepEqual(HTTP_ONLY_CODES.filter((c) => !emitted.has(c)), [], 'HTTP_ONLY_CODES names a code no src module answers');
  assert.deepEqual(HTTP_ONLY_CODES.filter((c) => Object.hasOwn(ERROR_CONTRACT, c)), [], 'a code belongs to one list');
});

test('an HTTP-only code still answers the MCP and CLI doors (Issue #1640)', () => {
  const fallback = ERROR_CONTRACT['weave-error'];
  const c = contractFor(new WeaveError('no', 'method-not-allowed'));
  assert.equal(c.mcp, fallback.mcp, 'the MCP door never answers rpc undefined');
  assert.equal(c.exit, fallback.exit, 'the CLI never exits undefined');
});

test('every 4xx and 5xx JSON body names a code (Issue #1640)', () => {
  const routes = srcOf('routes.js');
  const bare = [];
  for (const m of routes.matchAll(/out\((\d{3}),/g)) {
    if (Number(m[1]) < 400) continue;
    const args = argsAfter(routes, m.index + m[0].length);
    if (!args.trimStart().startsWith('{')) continue;
    if (/\bcode: /.test(args)) continue;
    bare.push(`routes.js:${routes.slice(0, m.index).split('\n').length} out(${m[1]}, ...)`);
  }
  assert.deepEqual(bare, [], 'an agent branching on code reads undefined from a body that carries none');
});

test('notFound answers a coded body, so an /api/ path never gets text (Issue #1640)', () => {
  const routes = srcOf('routes.js');
  const strings = [...routes.matchAll(/notFound\((['"`])/g)]
    .map((m) => `routes.js:${routes.slice(0, m.index).split('\n').length}`);
  assert.deepEqual(strings, [], 'notFound(json) is the body for an /api/ path; a bare string reaches it as text/plain');
});

test('errorBody takes the error and nothing else (Issue #1640)', () => {
  const extra = [];
  for (const file of srcFiles()) {
    const src = srcOf(file);
    for (const m of src.matchAll(/errorBody\(/g)) {
      const args = argsAfter(src, m.index + m[0].length);
      if (args.includes(',')) extra.push(`src/${file}:${src.slice(0, m.index).split('\n').length} errorBody(${args.trim()})`);
    }
  }
  assert.deepEqual(extra, [], 'errorBody reads one argument; a second is dropped on the floor');
  assert.equal(errorBody.length, 1);
});

test('AGENTS.md names every HTTP-only code (Issue #1640)', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const missing = HTTP_ONLY_CODES.filter((c) => !agents.includes(`\`${c}\``));
  assert.deepEqual(missing, [], 'an agent reading AGENTS.md must find every code a weave answer can carry');
});

test('every 4xx and 5xx answer carries an X-Request-Id, and a 500 carries the id its body names (Issue #1647)', async () => {
  const w = seed(new Weave());
  w.universalSearch = () => { throw new Error('boom'); };
  const quiet = console.error;
  console.error = () => {};
  try {
    await withServer(w, async ({ fetch, base }) => {
      const ok = await fetch('/api/health');
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('x-request-id'), null, 'a success carries no request id');
      const missing = await fetch('/api/entities/nope');
      assert.equal(missing.status, 404);
      assert.match(missing.headers.get('x-request-id') ?? '', /^[0-9a-f]{8}$/);
      const misdirected = await new Promise((done, fail) => {
        const req = request(`${base}/api/health/x`, { headers: { Host: 'elsewhere.example' } }, (res) => { res.resume(); done(res); });
        req.on('error', fail);
        req.end();
      });
      assert.equal(misdirected.statusCode, 421);
      assert.match(misdirected.headers['x-request-id'] ?? '', /^[0-9a-f]{8}$/);
      const broken = await fetch('/api/search?q=x');
      assert.equal(broken.status, 500);
      const body = await broken.json();
      assert.equal(broken.headers.get('x-request-id'), body.id, 'header and body name the same request');
    });
  } finally {
    console.error = quiet;
  }
});

test('WEAVE_ACCESS_LOG writes one line per finished response with method, path, status, ms, actor and workspace, and never the query string or a share token (Issue #1647)', async () => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await withServer(seed(new Weave()), { accessLog: true }, async ({ fetch }) => {
      await fetch('/api/entities/nope?token=wv_secretvalue');
      await fetch('/s/wvs_sharetokenvalue/api/spaces');
      await fetch('/api/health');
    });
    await withServer(seed(new Weave()), async ({ fetch }) => { await fetch('/api/entities/nope'); });
  } finally {
    console.log = log;
  }
  const records = lines.filter((l) => l.startsWith('weave access ')).map((l) => JSON.parse(l.slice('weave access '.length)));
  assert.equal(records.length, 3, 'one line per response, and none without the opt-in');
  const [missing, share, health] = records;
  assert.deepEqual({ method: missing.method, path: missing.path, status: missing.status }, { method: 'GET', path: '/api/entities/nope', status: 404 });
  assert.equal(typeof missing.ms, 'number');
  assert.equal(typeof missing.actor, 'string');
  assert.equal(typeof missing.workspace, 'string');
  assert.match(missing.id, /^[0-9a-f]{8}$/, 'an error line names the id its answer carries');
  assert.equal(health.status, 200);
  assert.equal(health.id, undefined);
  const all = lines.join('\n');
  assert.ok(!all.includes('secretvalue') && !all.includes('sharetokenvalue'), all);
  assert.match(share.path, /^\/s\/wvs_…\//);
});
