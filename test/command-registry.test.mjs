import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { handleMcpMessage, TOOLS } from '../src/mcp.js';
import { COMMANDS, BY_TOOL, cliCommand, matchRoute, toolDefinition } from '../src/commands.js';
import { unwrapData } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');

test('every registry command is well formed and reachable on each door it names (Feature #179)', () => {
  const names = new Set();
  for (const c of COMMANDS) {
    assert.ok(/^[a-z]+(\.[a-z]+)*$/.test(c.name), `${c.name} is a dotted lowercase name`);
    assert.ok(!names.has(c.name), `${c.name} is registered once`);
    names.add(c.name);
    assert.ok(['schema', 'entity', 'none'].includes(c.writes), `${c.name} says what it writes`);
    assert.equal(typeof c.run, 'function', `${c.name} runs`);
    assert.ok(Array.isArray(c.engine) && c.engine.every((m) => typeof Weave.prototype[m] === 'function'), `${c.name} names engine methods that exist`);
    assert.ok(c.tool && c.cli && c.http, `${c.name} has all three doors`);
    assert.ok(c.tool.description.length >= 40, `${c.name} describes its tool`);
    assert.deepEqual(TOOLS.find((t) => t.name === c.tool.name), { ...toolDefinition(c.tool.name), annotations: TOOLS.find((t) => t.name === c.tool.name).annotations }, `${c.tool.name} in tools/list is the registry entry`);
    assert.equal(BY_TOOL.get(c.tool.name), c);
    assert.equal(cliCommand(c.cli.command, c.cli.sub), c, `weave ${c.cli.command} ${c.cli.sub} is the registry entry`);
    assert.equal(matchRoute(c.http.method, c.http.path.replace(/:[a-z]+/gi, 'x'))?.cmd, c, `${c.http.method} ${c.http.path} is the registry entry`);
    for (const k of c.cli.positional ?? []) assert.ok(k in c.tool.properties, `${c.name}: the CLI argument ${k} is a tool argument`);
    for (const k of c.http.path.match(/:([a-z]+)/gi) ?? []) assert.ok(k.slice(1) in c.tool.properties, `${c.name}: the path parameter ${k} is a tool argument`);
  }
});

function seed(w) {
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.createTable({ space: 'Ops', name: 'Person' });
  w.createEntity('Task', { Name: 'Alpha' });
}

const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['id', 'fieldId', 'activity', 'at', 'seq', 'deletedAt', 'createdAt', 'updatedAt', 'actor', 'inverseFieldId', 'targetDbId', 'targetDb', 'targetDbs', 'dbId', 'relationField'].includes(k) ? undefined : x)));

test('one script of field writes answers the same on CLI, MCP and HTTP (Feature #179)', async () => {
  const dir = tempDir('weave-registry-');
  const data = join(dir, 'ws.db');
  const env = { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json'), WEAVE_ACTOR: 'registry' };
  const cli = (args) => {
    const r = spawnSync(process.execPath, ['--no-warnings', BIN, ...args, '--data', data], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `weave ${args.join(' ')}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  const cliWeave = new Weave({ path: data, actor: 'registry' });
  seed(cliWeave);
  cliWeave.save?.();
  const mcpWeave = new Weave();
  seed(mcpWeave);
  const mcp = (name, args) => {
    const res = handleMcpMessage(mcpWeave, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { ...args, verbose: true } } }, { tools: 'all' });
    assert.ok(!res.result.isError, `${name}: ${res.result.content[0].text}`);
    return JSON.parse(unwrapData(res.result.content[0].text));
  };
  const httpWeave = new Weave();
  seed(httpWeave);
  const { server } = await startServer(httpWeave, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  };
  try {
    const steps = [
      [['field', 'add', 'Task', 'Points', 'number', '--description', 'Effort'], ['weave_add_field', { db: 'Task', name: 'Points', type: 'number', config: { description: 'Effort' } }], ['POST', '/api/tables/Task/fields', { name: 'Points', type: 'number', config: { description: 'Effort' } }]],
      [['formula', 'check', 'Task', 'Points * 2', '--scan'], ['weave_check_formula', { db: 'Task', expression: 'Points * 2', scan: true }], ['POST', '/api/tables/Task/formula-check', { expression: 'Points * 2', scan: true }]],
      [['field', 'update', 'Task', 'Points', '--name', 'Effort', '--width', '120'], ['weave_update_field', { db: 'Task', field: 'Points', name: 'Effort', config: { width: 120 } }], ['PATCH', '/api/tables/Task/fields/Points', { name: 'Effort', config: { width: 120 } }]],
      [['relation', 'add', 'Task', 'Owner', 'Person', '--inverse', 'Tasks'], ['weave_add_relation', { db: 'Task', name: 'Owner', targetDb: 'Person', inverseName: 'Tasks' }], ['POST', '/api/tables/Task/relations', { name: 'Owner', targetDb: 'Person', inverseName: 'Tasks' }]],
      [['field', 'delete', 'Task', 'Effort'], ['weave_delete_field', { db: 'Task', field: 'Effort' }], ['DELETE', '/api/tables/Task/fields/Effort']],
      [['field', 'restore', 'Task', 'Effort'], ['weave_restore_field', { db: 'Task', field: 'Effort' }], ['POST', '/api/tables/Task/fields/Effort/restore']],
    ];
    for (const [c, [tool, args], [method, path, body]] of steps) {
      const fromCli = strip(cli(c));
      const fromMcp = strip(mcp(tool, args));
      const fromHttp = strip(await http(method, path, body));
      assert.deepEqual(fromMcp, fromHttp, `${tool} and ${method} ${path} answer alike`);
      assert.deepEqual(fromCli, fromHttp, `weave ${c.slice(0, 2).join(' ')} and ${method} ${path} answer alike`);
    }
    const entry = mcpWeave.activityFeed({ entityId: mcpWeave.getTable('Task').id, kinds: ['field-config-updated'], limit: 1 }).items[0];
    const rolled = mcp('weave_rollback_field', { activity: entry.id });
    assert.equal(rolled.field.name, 'Points', 'the rollback door runs the registry entry and undoes the rename');
  } finally { server.close(); }
});

test('weave\'s own model is served on every door, and the workspace outline still is (Issue #654)', async () => {
  const { ONTOLOGY } = await import('../src/engine.js');
  const dir = tempDir('weave-glossary-');
  const data = join(dir, 'ws.db');
  const env = { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json') };
  const seeded = new Weave({ path: data });
  seed(seeded);
  const cli = (...args) => {
    const r = spawnSync(process.execPath, ['--no-warnings', BIN, 'ontology', ...args, '--data', data], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    try { return JSON.parse(r.stdout); } catch { return r.stdout; }
  };
  const w = new Weave();
  seed(w);
  const mcp = (args) => {
    const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_ontology', arguments: args } }, { tools: 'all' });
    assert.ok(!res.result.isError, res.result.content[0].text);
    const text = unwrapData(res.result.content[0].text);
    try { return JSON.parse(text); } catch { return text; }
  };
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const want = JSON.parse(JSON.stringify(ONTOLOGY));
    assert.deepEqual(cli('--depth', 'glossary'), want, 'weave ontology --depth glossary');
    assert.deepEqual(mcp({ depth: 'glossary' }), want, 'weave_ontology {depth: "glossary"}');
    assert.deepEqual(await (await fetch(`${base}/api/ontology?depth=glossary`)).json(), want, 'GET /api/ontology?depth=glossary');
    assert.equal(want.core.key, 'entity');
    assert.ok(want.levels.some((l) => l.key === 'record'));

    const outline = (o) => (typeof o === 'string' ? o : o.outline ?? JSON.stringify(o));
    for (const [door, got] of [['CLI', cli()], ['MCP', mcp({})], ['HTTP', await (await fetch(`${base}/api/ontology`)).text()]]) {
      assert.match(outline(got), /^weave ontology: \d+ tables? in \d+ spaces?[^]*\n  Task: /, `${door} still answers the outline`);
    }
    const bad = await fetch(`${base}/api/ontology?depth=deep`);
    assert.equal(bad.status, 400, 'an unknown depth is still refused');
  } finally { server.close(); }
});
