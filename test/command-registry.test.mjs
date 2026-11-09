import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { handleMcpMessage, TOOLS } from '../src/mcp.js';
import { COMMANDS, BY_TOOL, FAMILIES, cliCommand, matchRoute, toolCommand, toolDefinition } from '../src/commands.js';
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
    assert.ok(['schema', 'entity', 'keystore', 'none'].includes(c.writes), `${c.name} says what it writes`);
    assert.equal(typeof c.run, 'function', `${c.name} runs`);
    assert.ok(Array.isArray(c.engine) && c.engine.every((m) => typeof Weave.prototype[m] === 'function'), `${c.name} names engine methods that exist`);
    assert.ok(c.tool && c.cli && c.http, `${c.name} has all three doors`);
    assert.ok(c.tool.description.length >= 40, `${c.name} describes its tool`);
    assert.equal(TOOLS.find((t) => t.name === c.tool.name), c.tool, `${c.tool.name} in tools/list is the registry entry`);
    if (c.action) {
      assert.ok(c.tool.inputSchema.properties.action, `${c.name}: its tool takes an action`);
      if (!c.toolRefusal) assert.equal(toolCommand(c.tool.name, { action: c.action }), c, `${c.tool.name} {action: ${c.action}} is the registry entry`);
    } else assert.equal(BY_TOOL.get(c.tool.name), c);
    assert.equal(cliCommand(c.cli.command, c.cli.sub), c, `weave ${c.cli.command} ${c.cli.sub} is the registry entry`);
    assert.equal(matchRoute(c.http.method, c.http.path.replace(/:[a-z]+/gi, 'x'))?.cmd, c, `${c.http.method} ${c.http.path} is the registry entry`);
    for (const k of c.cli.positional ?? []) assert.ok(k in c.tool.inputSchema.properties, `${c.name}: the CLI argument ${k} is a tool argument`);
    for (const k of c.http.path.match(/:([a-z]+)/gi) ?? []) assert.ok(k.slice(1) in c.tool.inputSchema.properties, `${c.name}: the path parameter ${k} is a tool argument`);
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

test('one script of space and table writes answers the same on CLI, MCP and HTTP (Feature #179)', async () => {
  const dir = tempDir('weave-registry-schema-');
  const data = join(dir, 'ws.db');
  const env = { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json'), WEAVE_ACTOR: 'registry' };
  const cli = (args) => {
    const r = spawnSync(process.execPath, ['--no-warnings', BIN, ...args, '--data', data], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `weave ${args.join(' ')}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  new Weave({ path: data });
  const mcpWeave = new Weave();
  const mcp = (name, args) => {
    const res = handleMcpMessage(mcpWeave, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { ...args, verbose: true } } }, { tools: 'all' });
    assert.ok(!res.result.isError, `${name}: ${res.result.content[0].text}`);
    return JSON.parse(unwrapData(res.result.content[0].text));
  };
  const { server } = await startServer(new Weave(), { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  };
  const strip2 = (v) => JSON.parse(JSON.stringify(strip(v), (k, x) => (k.endsWith('Id') || ['fieldOrder', 'fields', 'members', 'url', 'icon', 'position', 'views', 'publicId', 'nameFieldId', 'next', 'hints', 'term'].includes(k) ? undefined : x)));
  try {
    const steps = [
      [['space', 'create', 'Ops', '--description', 'Daily'], ['weave_create_space', { name: 'Ops', description: 'Daily' }], ['POST', '/api/spaces', { name: 'Ops', description: 'Daily' }]],
      [['space', 'create', 'Lab'], ['weave_create_space', { name: 'Lab' }], ['POST', '/api/spaces', { name: 'Lab' }]],
      [['space', 'update', 'Lab', '--description', 'Experiments'], ['weave_update_space', { space: 'Lab', description: 'Experiments' }], ['PATCH', '/api/spaces/Lab', { description: 'Experiments' }]],
      [['table', 'create', 'Ops', 'Task'], ['weave_create_table', { space: 'Ops', name: 'Task' }], ['POST', '/api/tables', { space: 'Ops', name: 'Task' }]],
      [['table', 'update', 'Task', '--description', 'Work'], ['weave_update_table', { db: 'Task', description: 'Work' }], ['PATCH', '/api/tables/Task', { description: 'Work' }]],
      [['table', 'duplicate', 'Task'], ['weave_duplicate_table', { db: 'Task' }], ['POST', '/api/tables/Task/duplicate']],
      [['table', 'move', 'Task', 'Lab'], ['weave_move_table', { db: 'Task', space: 'Lab' }], ['POST', '/api/tables/Task/move', { space: 'Lab' }]],
      [['table', 'delete', 'Task'], ['weave_delete_table', { db: 'Task' }], ['DELETE', '/api/tables/Task']],
      [['table', 'restore', 'Lab/Task'], ['weave_restore_table', { db: 'Lab/Task' }], ['POST', '/api/tables/Lab%2FTask/restore']],
      [['space', 'delete', 'Lab'], ['weave_delete_space', { space: 'Lab' }], ['DELETE', '/api/spaces/Lab']],
      [['space', 'restore', 'Lab'], ['weave_restore_space', { space: 'Lab' }], ['POST', '/api/spaces/Lab/restore']],
    ];
    for (const [c, [tool, args], [method, path, body]] of steps) {
      const fromHttp = strip2(await http(method, path, body));
      assert.deepEqual(strip2(mcp(tool, args)), fromHttp, `${tool} and ${method} ${path} answer alike`);
      assert.deepEqual(strip2(cli(c)), fromHttp, `weave ${c.slice(0, 2).join(' ')} and ${method} ${path} answer alike`);
    }
    const res = await fetch(`${base}/api/tables/Lab%2FTask/move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 400, 'a move with no space is still refused');
    assert.match((await res.json()).error, /space is required/);
  } finally { server.close(); }
});

test('the HTTP role gate reads writes from the registry: an editor is refused every schema write and runs the rest (Feature #179)', async () => {
  const w = new Weave();
  seed(w);
  w.addField('Task', { name: 'Points', type: 'number' });
  w.createAccount({ name: 'arch', role: 'architect' });
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const sample = { db: 'Task', field: 'Points', space: 'Ops' };
  try {
    for (const c of COMMANDS) {
      if (c.http.method === 'GET' || c.writes === 'keystore') continue;
      const path = c.http.path.replace(/:([a-z]+)/gi, (_, k) => encodeURIComponent(sample[k] ?? 'x'));
      const body = c.name === 'formula.check' ? { expression: 'Points * 2' } : {};
      const res = await fetch(base + path, { method: c.http.method, headers: { authorization: `Bearer ${editor}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (c.writes === 'schema') {
        assert.equal(res.status, 403, `${c.http.method} ${c.http.path} is a schema write`);
        assert.equal(json.error, 'This token cannot change the schema');
      } else {
        assert.equal(res.status, 200, `${c.http.method} ${c.http.path} writes no schema: ${JSON.stringify(json)}`);
      }
    }
  } finally { server.close(); }
});

async function threeDoors(prefix, { env: extra = {}, seeded = seed, local = false } = {}) {
  const dir = tempDir(prefix);
  const data = join(dir, 'ws.db');
  const env = { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json'), WEAVE_ACTOR: 'registry', ...extra };
  const keystore = (door) => join(dir, `keystore-${door}.json`);
  const run = (args) => spawnSync(process.execPath, ['--no-warnings', BIN, ...args, '--data', data], { encoding: 'utf8', env });
  const cli = (args) => {
    const r = run(args);
    assert.equal(r.status, 0, `weave ${args.join(' ')}: ${r.stderr}`);
    try { return JSON.parse(r.stdout); } catch { return r.stdout; }
  };
  const cliWeave = new Weave({ path: data, actor: 'registry' });
  seeded(cliWeave);
  cliWeave.store.close?.();
  const mcpWeave = new Weave({ keystorePath: keystore('mcp'), localKeyAccess: local });
  seeded(mcpWeave);
  const call = (name, args) => handleMcpMessage(mcpWeave, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { tools: 'all' }).result;
  const mcp = (name, args) => {
    const res = call(name, args);
    assert.ok(!res.isError, `${name}: ${res.content[0].text}`);
    return JSON.parse(unwrapData(res.content[0].text));
  };
  const httpWeave = new Weave({ keystorePath: keystore('http') });
  seeded(httpWeave);
  const { server } = await startServer(httpWeave, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const raw = (method, path, body, headers = {}) => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const http = async (method, path, body, headers) => {
    const res = await raw(method, path, body, headers);
    const json = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  };
  return { run, cli, call, mcp, raw, http, httpWeave, close: () => server.close() };
}

const bare = (v) => JSON.parse(JSON.stringify(strip(v), (k, x) => (k.endsWith('Id') ? undefined : x)));

test('the automation family answers the same on CLI, MCP and HTTP, and a miss names what there is (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-automation-');
  const trigger = { type: 'entity-created' };
  const actions = [{ type: 'add-comment', text: 'Seen' }];
  try {
    const made = {
      cli: d.cli(['automation', 'create', 'Task', '--name', 'Stamp', '--trigger', JSON.stringify(trigger), '--actions', JSON.stringify(actions)]),
      mcp: d.mcp('weave_create_automation', { db: 'Task', name: 'Stamp', trigger, actions }),
      http: await d.http('POST', '/api/automations', { db: 'Task', name: 'Stamp', trigger, actions }),
    };
    assert.deepEqual(bare(made.mcp), bare(made.http), 'weave_create_automation and POST /api/automations answer alike');
    assert.deepEqual(bare(made.cli), bare(made.http), 'weave automation create and POST /api/automations answer alike');
    const steps = [
      [['automation', 'describe', 'Task'], ['describe', {}, 'rules'], ['GET', '/api/automations?db=Task']],
      [['automation', 'list', 'Task'], ['list', {}, 'automations'], ['GET', '/api/automations/list?db=Task']],
      [['automation', 'update', ':id', '--patch', '{"enabled":false}'], ['update', { patch: { enabled: false } }], ['PATCH', '/api/automations/:id', { enabled: false }]],
      [['automation', 'delete', ':id'], ['delete', {}], ['DELETE', '/api/automations/:id']],
    ];
    for (const [c, [action, args, wrap], [method, path, body]] of steps) {
      const fromHttp = bare(await d.http(method, path.replace(':id', made.http.id), body));
      const fromMcp = d.mcp('weave_automations', { action, db: 'Task', automation: made.mcp.id, ...args });
      assert.deepEqual(bare(wrap ? fromMcp[wrap] : fromMcp), fromHttp, `weave_automations ${action} and ${method} ${path} answer alike`);
      assert.deepEqual(bare(d.cli(c.map((x) => (x === ':id' ? made.cli.id : x)))), fromHttp, `weave ${c.slice(0, 2).join(' ')} and ${method} ${path} answer alike`);
    }
    assert.deepEqual(d.cli(['automation']), [], 'weave automation alone lists');
    const again = await d.raw('DELETE', `/api/automations/${made.http.id}`);
    assert.equal(again.status, 404, 'deleting a deleted automation over HTTP is a 404');
    assert.deepEqual(await again.json(), { error: `No automation '${made.http.id}'`, code: 'not-found' });
    assert.deepEqual(d.mcp('weave_automations', { action: 'delete', automation: made.mcp.id }), { id: made.mcp.id, deleted: false }, 'MCP answers deleted: false');
    assert.equal(d.call('weave_automations', { action: 'run' }).content[0].text, "Error: Unknown automations action 'run' (list, describe, update, delete)");
    const miss = d.run(['automation', 'run']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown automation subcommand 'run'\. Try: create, list, describe, update, delete/);
  } finally { d.close(); }
});

test('the key family answers the same on CLI, MCP and HTTP, and MCP still never reveals (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-keys-', { local: true, seeded: (w) => { seed(w); w.createAccount({ name: 'ann', role: 'editor' }); } });
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  const keyed = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['owner', 'rotatedAt', 'sharedWith', 'grants'].includes(k) ? undefined : x)));
  try {
    const steps = [
      [['key', 'set', 'stripe', '--value', 'sk-one'], ['set', { name: 'stripe', value: 'sk-one' }], ['POST', '/api/keys', { name: 'stripe', value: 'sk-one' }]],
      [['key', 'set', 'team/hook', '--value', 'sk-two'], ['set', { name: 'team/hook', value: 'sk-two' }], ['POST', '/api/keys', { name: 'team/hook', value: 'sk-two' }]],
      [['key', 'list'], ['list', {}, 'keys'], ['GET', '/api/keys']],
      [['key', 'share', 'stripe', '--with', 'ann'], ['share', { name: 'stripe', account: 'ann' }], ['POST', '/api/keys/stripe/share', { account: 'ann' }]],
      [['key', 'unshare', 'stripe', '--with', 'ann'], ['unshare', { name: 'stripe', account: 'ann' }], ['DELETE', '/api/keys/stripe/share', { account: 'ann' }]],
      [['key', 'delete', 'team/hook'], ['delete', { name: 'team/hook' }], ['DELETE', '/api/keys/team/hook']],
      [['key'], ['list', {}, 'keys'], ['GET', '/api/keys']],
    ];
    for (const [c, [action, args, wrap], [method, path, body]] of steps) {
      const fromHttp = keyed(await d.http(method, path, body, auth));
      const fromMcp = d.mcp('weave_keys', { action, ...args });
      assert.deepEqual(keyed(wrap ? fromMcp[wrap] : fromMcp), fromHttp, `weave_keys ${action} and ${method} ${path} answer alike`);
      assert.deepEqual(keyed(d.cli(c)), fromHttp, `weave ${c.slice(0, 2).join(' ')} and ${method} ${path} answer alike`);
    }
    assert.equal(d.cli(['key', 'reveal', 'stripe']), 'sk-one\n', 'weave key reveal prints the bare value');
    assert.deepEqual(await d.http('POST', '/api/keys/stripe/reveal', {}, auth), { name: 'stripe', value: 'sk-one' });
    assert.equal(d.call('weave_keys', { action: 'reveal', name: 'stripe' }).content[0].text, 'Error: Revealing a secret is not an agent action — use `weave key reveal` or the app.');
    assert.equal(d.call('weave_keys', { action: 'rotate' }).content[0].text, "Error: Unknown keys action 'rotate' (list, set, share, unshare, delete)");
    const miss = d.run(['key', 'rotate']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown key subcommand 'rotate'\. Try: list, set, reveal, share, unshare, delete/);
    const unread = await d.raw('GET', '/api/keys/stripe', null, auth);
    assert.equal(unread.status, 404);
    assert.deepEqual(await unread.json(), { error: 'Secrets cannot be read back', code: 'not-found' });
  } finally { d.close(); }
});
