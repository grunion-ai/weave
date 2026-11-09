import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { handleMcpMessage, TOOLS } from '../src/mcp.js';
import { COMMANDS, BY_TOOL, FAMILIES, cliCommand, matchRoute, toolCommand, toolDefinition, httpPaths } from '../src/commands.js';
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
    assert.ok(c.http || c.via?.http, `${c.name} has an HTTP door or names where its route lives`);
    for (const door of ['tool', 'cli']) assert.ok(c[door] || c.via?.[door], `${c.name} has a ${door} door or names the one that carries it`);
    if (c.via?.tool) assert.ok(TOOLS.some((t) => t.name === c.via.tool), `${c.name}: ${c.via.tool} is in tools/list`);
    if (c.via?.cli) assert.ok(COMMANDS.some((x) => x.name === c.via.cli && x.cli), `${c.name}: ${c.via.cli} carries the CLI door`);
    if (c.tool) {
      assert.ok(c.tool.description.length >= 40, `${c.name} describes its tool`);
      assert.equal(TOOLS.find((t) => t.name === c.tool.name), c.tool, `${c.tool.name} in tools/list is the registry entry`);
      if (c.action !== undefined) {
        const key = c.actionArg ?? 'action';
        assert.ok(c.tool.inputSchema.properties[key], `${c.name}: its tool takes ${key}`);
        if (!c.toolRefusal) assert.equal(toolCommand(c.tool.name, { [key]: c.action }), c, `${c.tool.name} {${key}: ${c.action}} is the registry entry`);
      } else assert.equal(BY_TOOL.get(c.tool.name), c);
    }
    if (c.cli && !c.cli.swap) assert.equal(cliCommand(c.cli.command, c.cli.sub), c, `weave ${c.cli.command} ${c.cli.sub} is the registry entry`);
    for (const path of httpPaths(c)) {
      assert.equal(matchRoute(c.http.method, path.replace(/:[a-z]+/gi, 'x'))?.cmd, c, `${c.http.method} ${path} is the registry entry`);
      if (c.tool && !c.http.args) for (const k of path.match(/:([a-z]+)/gi) ?? []) assert.ok(k.slice(1) in c.tool.inputSchema.properties, `${c.name}: the path parameter ${k} is a tool argument`);
    }
    if (c.tool && c.cli) for (const k of c.cli.positional ?? []) assert.ok(k in c.tool.inputSchema.properties, `${c.name}: the CLI argument ${k} is a tool argument`);
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
  w.addRelation('Task', { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-many' });
  w.addField('Task', { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }] } });
  w.createEntity('Person', { Name: 'Pat' });
  const alpha = w.query('Task').items[0].id;
  const gone = w.createEntity('Task', { Name: 'Gone' }).id;
  w.deleteEntity(gone);
  w.createAccount({ name: 'arch', role: 'architect' });
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  w.setDoc(alpha, 'first');
  const said = w.addComment(alpha, { author: 'ed', text: 'hi' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const seen = w.createView({ name: 'Seen', blocks: [{ table: 'Task' }] }).id;
  const filed = w.attachFile(alpha, { name: 'gate.txt', mime: 'text/plain', bytes: Buffer.from('gate').toString('base64') }).id;
  const sample = { db: 'Task', field: 'Points', space: 'Ops', entity: alpha, seq: 1, comment: said.id, view: seen, file: filed };
  const bodies = {
    'formula.check': { expression: 'Points * 2' },
    'entity.link': { field: 'Owner', targets: ['Pat'] },
    'entity.unlink': { field: 'Owner', targets: ['Pat'] },
    'entity.state': { field: 'Stage', state: 'Doing' },
    'entity.bulk': { ids: [alpha], op: 'set', values: { Points: 1 } },
    'doc.set': { doc: 'second' },
    'doc.append': { doc: 'third' },
    'comment.add': { text: 'more' },
    'file.attach': { name: 'more.txt', mime: 'text/plain', contentBase64: Buffer.from('more').toString('base64') },
    'view.create': { name: 'Gate', blocks: [{ table: 'Task' }] },
    'workspace.logo.set': { name: 'gate.svg', contentBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') },
  };
  try {
    for (const c of COMMANDS) {
      if (!c.http || c.http.method === 'GET' || c.writes === 'keystore' || ['view.share', 'view.unshare', 'template.use', 'workspace.move'].includes(c.name) || c.cli?.command === 'share') continue;
      const params = c.name === 'entity.restore' ? { ...sample, entity: gone } : sample;
      const path = c.http.path.replace(/:([a-z]+)/gi, (_, k) => encodeURIComponent(params[k] ?? 'x'));
      const body = bodies[c.name] ?? {};
      const res = await fetch(base + path, { method: c.http.method, headers: { authorization: `Bearer ${editor}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (['automation.replay', 'automation.receive'].includes(c.name)) {
        assert.deepEqual([res.status, json.code], [404, 'not-found'], `${c.http.method} ${c.http.path} writes no schema and looks the record up`);
      } else if (c.writes === 'schema') {
        assert.equal(res.status, 403, `${c.http.method} ${c.http.path} is a schema write`);
        assert.equal(json.error, 'This token cannot change the schema');
      } else {
        assert.equal(res.status, c.http.status ?? 200, `${c.http.method} ${c.http.path} writes no schema: ${JSON.stringify(json)}`);
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
  return { run, cli, call, mcp, raw, http, httpWeave, mcpWeave, close: () => server.close() };
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
    assert.equal(d.call('weave_automations', { action: 'run' }).content[0].text, "Error: Unknown automations action 'run' (list, describe, update, delete, replay)");
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
    assert.equal(d.call('weave_keys', { action: 'migrate', to: 'keychain' }).content[0].text, 'Error: Moving the key store is not an agent action: run `weave key migrate --to keychain` or `--to file` on the machine that holds it.');
    const pinned = d.run(['key', 'migrate', '--to', 'keychain']);
    assert.notEqual(pinned.status, 0);
    assert.match(pinned.stderr, /After the move weave would still read the file store/);
    const remote = await d.raw('POST', '/api/keys/migrate', { to: 'keychain' }, auth);
    assert.equal(remote.status, 403);
    assert.match((await remote.json()).error, /local operator act/);
    const miss = d.run(['key', 'rotate']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown key subcommand 'rotate'\. Try: list, set, reveal, share, unshare, delete, migrate/);
    const unread = await d.raw('GET', '/api/keys/stripe', null, auth);
    assert.equal(unread.status, 404);
    assert.deepEqual(await unread.json(), { error: 'Secrets cannot be read back', code: 'not-found' });
  } finally { d.close(); }
});

test('the CSV pair answers the same on CLI, MCP and HTTP, and export stays raw text (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-csv-');
  const csv = 'Name\nBeta\nGamma\n';
  const file = join(tempDir('weave-registry-csv-file-'), 'rows.csv');
  writeFileSync(file, csv);
  try {
    const imported = {
      cli: d.cli(['csv', 'import', 'Task', '--file', file]),
      mcp: d.mcp('weave_import_csv', { db: 'Task', csv }),
      http: await d.http('POST', '/api/tables/Task/import.csv', { csv }),
    };
    assert.deepEqual(imported.mcp, imported.http, 'weave_import_csv and POST /api/tables/Task/import.csv answer alike');
    assert.deepEqual(imported.cli, imported.http, 'weave csv import and POST /api/tables/Task/import.csv answer alike');
    assert.equal(imported.http.created, 2);
    const res = await d.raw('GET', '/api/tables/Task/export.csv');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    const fromHttp = (await res.text()).replace(/\d{4}-\d\d-\d\dT[^,\n]+/g, 'T');
    const exported = d.call('weave_export_csv', { db: 'Task' });
    assert.ok(!exported.isError, exported.content[0].text);
    assert.equal(unwrapData(exported.content[0].text).replace(/\d{4}-\d\d-\d\dT[^,\n]+/g, 'T'), fromHttp, 'weave_export_csv and GET export.csv answer alike');
    for (const args of [['csv', 'Task'], ['csv', 'export', 'Task']]) {
      const r = d.run(args);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.replace(/\d{4}-\d\d-\d\dT[^,\n]+/g, 'T'), fromHttp, `weave ${args.join(' ')} prints the export as it is`);
    }
    assert.match(fromHttp, /^Public Id,Name,/);
    assert.equal(fromHttp.split('\n').filter((l) => /Beta|Gamma|Alpha/.test(l)).length, 3);
    assert.equal(cliCommand('csv', 'Task')?.name, 'csv.export', 'weave csv <table> runs the registry export');
    assert.equal(matchRoute('POST', '/api/tables/Task/import.csv')?.cmd.name, 'csv.import');
  } finally { d.close(); }
});

test('audit and activity answer the same on CLI, MCP and HTTP, each door with its own page (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-activity-');
  const logged = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['ts', 'spaces'].includes(k) ? undefined : x)));
  try {
    const audits = [
      [['audit'], {}, '/api/audit'],
      [['audit', '--limit', '1'], { limit: 1 }, '/api/audit?limit=1'],
    ];
    for (const [c, args, path] of audits) {
      const fromHttp = logged(await d.http('GET', path));
      assert.deepEqual(logged(d.mcp('weave_audit', args).events), fromHttp, `weave_audit and GET ${path} answer alike`);
      assert.deepEqual(logged(d.cli(c)), fromHttp, `weave ${c.join(' ')} and GET ${path} answer alike`);
    }
    assert.equal((await d.http('GET', '/api/audit?limit=1')).length, 1);
    const feeds = [
      [['activity', '--table', 'Task'], { table: 'Task' }, '/api/activity?table=Task'],
      [['activity', '--table', 'Task', '--kinds', 'created,updated'], { table: 'Task', kinds: ['created', 'updated'] }, '/api/activity?table=Task&kind=created&kind=updated'],
      [['activity', '--table', 'Task', '--limit', '1'], { table: 'Task', limit: 1 }, '/api/activity?table=Task&limit=1'],
    ];
    for (const [c, args, path] of feeds) {
      const fromHttp = logged(await d.http('GET', path));
      assert.deepEqual(logged(d.mcp('weave_activity', args)), fromHttp, `weave_activity and GET ${path} answer alike`);
      assert.deepEqual(logged(d.cli(c)), fromHttp, `weave ${c.join(' ')} and GET ${path} answer alike`);
    }
    const first = {
      cli: d.cli(['activity', '--table', 'Task']).items[0].id,
      mcp: d.mcp('weave_activity', { table: 'Task' }).items[0].id,
      http: (await d.http('GET', '/api/activity?table=Task')).items[0].id,
    };
    const one = logged(await d.http('GET', `/api/activity/${encodeURIComponent(first.http)}`));
    assert.equal(one.kind, 'created');
    assert.deepEqual(logged(d.mcp('weave_activity', { id: first.mcp })), one, 'weave_activity {id} and GET /api/activity/:id answer alike');
    assert.deepEqual(logged(d.cli(['activity', first.cli])), one, 'weave activity <id> and GET /api/activity/:id answer alike');
    assert.equal((await d.raw('GET', '/api/audit?offset=-1')).status, 400, 'a bad audit offset is still a 400');
    assert.equal(matchRoute('GET', '/api/audit')?.cmd.name, 'audit');
    assert.equal(matchRoute('GET', `/api/activity/${first.http}`)?.cmd.name, 'activity');
    assert.equal(matchRoute('GET', '/api/activity')?.cmd.name, 'activity');
  } finally { d.close(); }
});

test('the registry pair and the relation map answer the same on CLI, MCP and HTTP (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-meta-');
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  const meta = bare;
  try {
    const steps = [
      [['registry'], { action: 'report' }, ['GET', '/api/registry']],
      [['registry', 'report'], {}, ['GET', '/api/registry']],
      [['registry', 'rebuild'], { action: 'rebuild' }, ['POST', '/api/registry/rebuild']],
    ];
    for (const [c, args, [method, path]] of steps) {
      const fromHttp = meta(await d.http(method, path, method === 'POST' ? {} : undefined, auth));
      assert.deepEqual(meta(d.mcp('weave_registry', args)), fromHttp, `weave_registry ${args.action ?? ''} and ${method} ${path} answer alike`);
      assert.deepEqual(meta(d.cli(c)), fromHttp, `weave ${c.join(' ')} and ${method} ${path} answer alike`);
    }
    assert.deepEqual(meta(d.mcp('weave_registry', { action: 'check' })), meta(d.mcp('weave_registry', {})), 'an action weave_registry does not know still reports');
    const miss = d.run(['registry', 'check']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown registry subcommand 'check'\. Try: report, rebuild/);
    const res = await d.raw('GET', '/api/relation-map.mmd');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    const ids = (s) => s.replace(/\b[A-Z][0-9a-f]{8}\b/g, 'X');
    const map = ids(await res.text());
    assert.match(map, /Task/);
    const fromMcp = d.mcp('weave_relation_map', {});
    assert.deepEqual(Object.keys(fromMcp), ['mermaid'], 'weave_relation_map answers {mermaid}');
    assert.equal(ids(fromMcp.mermaid), map);
    assert.equal(ids(d.cli(['map'])), `${map}\n`, 'weave map prints the diagram');
    assert.equal(matchRoute('POST', '/api/registry/rebuild')?.cmd.name, 'registry.rebuild');
    assert.equal(matchRoute('GET', '/api/relation-map.mmd')?.cmd.name, 'relation.map');
  } finally { d.close(); }
});

test('link, unlink, state and restore answer the same on CLI, MCP and HTTP (Feature #179)', async () => {
  const seeded = (w) => {
    seed(w);
    w.addRelation('Task', { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-many', inverseName: 'Tasks' });
    w.addField('Task', { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'In Review', category: 'in-progress' }] } });
    w.createEntity('Person', { Name: 'Pat' });
    w.createEntity('Person', { Name: 'Sam' });
    w.deleteEntity(w.createEntity('Task', { Name: 'Gone' }).id);
  };
  const d = await threeDoors('weave-registry-rows-', { seeded });
  const idOf = (w, name) => w.query('Task', { where: [['Name', '=', name]], includeDeleted: true }).items[0].id;
  const row = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['revision', 'url', 'ts', 'raw', 'modifiedBy', 'createdBy'].includes(k) ? undefined : x)));
  try {
    const steps = [
      [['link', 'Task#1', 'Owner', 'Pat', 'Sam'], ['weave_link', { field: 'Owner', targets: ['Pat', 'Sam'] }], ['POST', 'link', { field: 'Owner', targets: ['Pat', 'Sam'] }]],
      [['unlink', 'Task#1', 'Owner', 'Sam'], ['weave_unlink', { field: 'Owner', targets: ['Sam'] }], ['POST', 'unlink', { field: 'Owner', items: ['Sam'] }]],
      [['link', 'Task#1', 'Owner', 'Pat', '--unlink'], ['weave_unlink', { field: 'Owner', targets: ['Pat'] }], ['POST', 'unlink', { field: 'Owner', targets: ['Pat'] }]],
      [['state', 'Task#1', 'Stage', 'In', 'Review'], ['weave_set_state', { field: 'Stage', state: 'In Review' }], ['POST', 'state', { field: 'Stage', state: 'In Review' }]],
      [['restore', 'Task#2'], ['weave_restore_entity', {}, 'Gone'], ['POST', 'restore', {}, 'Gone']],
    ];
    for (const [c, [tool, args, mcpName = 'Alpha'], [method, tail, body, httpName = 'Alpha']] of steps) {
      const fromHttp = row(await d.http(method, `/api/entities/${idOf(d.httpWeave, httpName)}/${tail}`, body));
      assert.deepEqual(row(d.mcp(tool, { entity: idOf(d.mcpWeave, mcpName), ...args, verbose: true })), fromHttp, `${tool} and ${method} ${tail} answer alike`);
      assert.deepEqual(row(d.cli(c)), fromHttp, `weave ${c.join(' ')} and ${method} ${tail} answer alike`);
    }
    for (const [name, path] of [['entity.link', 'link'], ['entity.unlink', 'unlink'], ['entity.state', 'state'], ['entity.restore', 'restore']]) {
      assert.equal(matchRoute('POST', `/api/entities/x/${path}`)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('record create, read, update and delete answer the same on CLI, MCP and HTTP, each door with its own extras (Feature #179)', async () => {
  const seeded = (w) => { seed(w); w.addField('Task', { name: 'Points', type: 'number' }); };
  const d = await threeDoors('weave-registry-crud-', { seeded });
  const row = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['revision', 'url', 'ts', 'raw', 'modifiedBy', 'createdBy', 'publicId'].includes(k) ? undefined : x)));
  try {
    const made = {
      cli: d.cli(['create', 'Task', 'Beta', '--values', '{"Points":3}']),
      mcp: d.mcp('weave_create_entity', { db: 'Task', name: 'Beta', values: { Points: 3 }, verbose: true }),
      http: await d.http('POST', '/api/tables/Task/entities', { name: 'Beta', values: { Points: 3 } }),
    };
    assert.deepEqual(row(made.mcp), row(made.http), 'weave_create_entity and POST /api/tables/Task/entities answer alike');
    assert.deepEqual(row(made.cli), row(made.http), 'weave create and POST /api/tables/Task/entities answer alike');
    const created = await d.raw('POST', '/api/tables/Task/entities', { name: 'Gamma' });
    assert.equal(created.status, 201);
    const read = { cli: d.cli(['get', made.cli.id]), mcp: d.mcp('weave_get_entity', { entity: made.mcp.id, verbose: true }), http: await d.http('GET', `/api/entities/${made.http.id}`) };
    assert.deepEqual(row(read.mcp), row(read.http));
    assert.deepEqual(row(read.cli), row(read.http));
    const updated = {
      cli: d.cli(['update', made.cli.id, '--values', '{"Points":5}']),
      mcp: d.mcp('weave_update_entity', { entity: made.mcp.id, values: { Points: 5 }, verbose: true }),
      http: await d.http('PATCH', `/api/entities/${made.http.id}`, { values: { Points: 5 } }),
    };
    assert.ok(Array.isArray(updated.http.affected), 'PATCH still answers affected');
    const { affected, ...httpRow } = updated.http;
    assert.equal(updated.mcp.affected, undefined, 'weave_update_entity answers no affected');
    assert.equal(updated.cli.affected, undefined, 'weave update answers no affected');
    assert.deepEqual(row(updated.mcp), row(httpRow));
    assert.deepEqual(row(updated.cli), row(httpRow));
    const stale = await d.raw('PATCH', `/api/entities/${made.http.id}`, { Points: 7 }, { 'if-match': '"1"' });
    assert.equal(stale.status, 412, 'a stale If-Match is still a 412');
    const staleBody = await stale.json();
    assert.equal(staleBody.code, 'stale');
    assert.equal(staleBody.entity.id, made.http.id, 'the 412 carries the record as it stands');
    const refused = d.call('weave_update_entity', { entity: made.mcp.id, Points: 1 });
    assert.ok(refused.isError, 'weave_update_entity still refuses values outside values');
    const gone = {
      cli: d.cli(['delete', made.cli.id]),
      mcp: d.mcp('weave_delete_entity', { entity: made.mcp.id, verbose: true }),
      http: await d.http('DELETE', `/api/entities/${made.http.id}`),
    };
    assert.equal(gone.http.ok, true, 'DELETE still answers ok: true');
    const { ok, ...httpGone } = gone.http;
    assert.deepEqual(row(gone.mcp), row(httpGone));
    assert.deepEqual(row(gone.cli), row(httpGone));
    for (const [method, path, name] of [['POST', '/api/tables/Task/entities', 'entity.create'], ['GET', '/api/entities/x', 'entity.read'], ['PATCH', '/api/entities/x', 'entity.update'], ['DELETE', '/api/entities/x', 'entity.delete']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('query, trash, stats and bulk answer the same on CLI, MCP and HTTP, each door with its own page and extras (Feature #179)', async () => {
  const seeded = (w) => {
    seed(w);
    w.addField('Task', { name: 'Points', type: 'number' });
    w.createEntity('Task', { Name: 'Beta', Points: 4 });
    w.deleteEntity(w.createEntity('Task', { Name: 'Gone' }).id);
  };
  const d = await threeDoors('weave-registry-reads-', { seeded });
  const row = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['revision', 'url', 'ts', 'raw', 'modifiedBy', 'createdBy'].includes(k) ? undefined : x)));
  const idOf = (w, name) => w.query('Task', { where: [['Name', '=', name]] }).items[0].id;
  const where = [['Points', '>', 1]];
  try {
    const queried = {
      cli: d.cli(['query', 'Task', '--where', JSON.stringify(where), '--relations', 'chip']),
      mcp: d.mcp('weave_query', { db: 'Task', where }),
      http: await d.http('POST', '/api/tables/Task/query', { where, relations: 'chip' }),
    };
    assert.equal(queried.http.items.length, 1);
    assert.deepEqual(row(queried.mcp), row(queried.http), 'weave_query and POST /api/tables/Task/query answer alike');
    assert.deepEqual(row(queried.cli), row(queried.http), 'weave query and POST /api/tables/Task/query answer alike');
    assert.equal((await d.raw('POST', '/api/tables/Task/query', { limit: 'many' })).status, 400, 'a bad HTTP limit is still a 400');
    const trashed = { cli: d.cli(['trash', 'Task']), mcp: d.mcp('weave_trash', { table: 'Task' }), http: await d.http('GET', '/api/tables/Task/trash') };
    assert.deepEqual(Object.keys(trashed.http), ['total', 'items']);
    assert.equal(trashed.http.total, 1);
    assert.deepEqual(row(trashed.mcp.items), row(trashed.http.items), 'weave_trash and GET /api/tables/Task/trash answer alike');
    assert.deepEqual(row(trashed.cli), row(trashed.http.items), 'weave trash prints the bare list');
    const everywhere = await d.http('GET', '/api/trash');
    assert.deepEqual(Object.keys(everywhere), ['total', 'items', 'views', 'purge'], 'GET /api/trash still carries views and purge');
    assert.equal(everywhere.purge, true);
    assert.deepEqual(row(d.mcp('weave_trash', {}).items), row(everywhere.items));
    assert.deepEqual(row(d.cli(['trash'])), row(everywhere.items));
    const stats = { cli: d.cli(['stats', 'Task', '--field', 'Points']), mcp: d.mcp('weave_stats', { table: 'Task', field: 'Points' }), http: await d.http('GET', '/api/tables/Task/stats?field=Points') };
    assert.deepEqual(row(stats.mcp), row(stats.http), 'weave_stats and GET /api/tables/Task/stats answer alike');
    assert.deepEqual(row(stats.cli), row(stats.http), 'weave stats and GET /api/tables/Task/stats answer alike');
    const narrowed = encodeURIComponent(JSON.stringify(where));
    assert.deepEqual(row(d.cli(['stats', 'Task', '--where', JSON.stringify(where)])), row(await d.http('GET', `/api/tables/Task/stats?where=${narrowed}`)));
    const bad = await d.raw('GET', '/api/tables/Task/stats?where=nope');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'where must be JSON' }, 'a where that is not JSON still answers without a code');
    const usage = d.run(['stats']);
    assert.notEqual(usage.status, 0);
    assert.match(usage.stderr, /Usage: stats <table>/);
    const values = { Points: 9 };
    const bulk = {
      cli: d.cli(['bulk', 'set', 'Task#1', '--values', JSON.stringify(values)]),
      mcp: d.mcp('weave_bulk', { ids: [idOf(d.mcpWeave, 'Alpha')], op: 'set', values }),
      http: await d.http('POST', '/api/bulk', { ids: [idOf(d.httpWeave, 'Alpha')], op: 'set', values }),
    };
    const counted = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]));
    assert.equal(bulk.http.done.length, 1);
    assert.deepEqual(counted(bulk.mcp), counted(bulk.http), 'weave_bulk and POST /api/bulk answer alike');
    assert.deepEqual(counted(bulk.cli), counted(bulk.http), 'weave bulk and POST /api/bulk answer alike');
    assert.equal(d.httpWeave.query('Task', { where: [['Points', '=', 9]] }).total, 1, 'the bulk set landed');
    for (const [method, path, name] of [['POST', '/api/tables/x/query', 'entity.query'], ['GET', '/api/trash', 'entity.trash'], ['GET', '/api/tables/x/trash', 'entity.trash'], ['GET', '/api/tables/x/stats', 'table.stats'], ['POST', '/api/bulk', 'entity.bulk']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('documents, their revisions and comments answer the same on CLI, MCP and HTTP, each door with its own envelope (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-docs-');
  const idOf = (w) => w.query('Task', { where: [['Name', '=', 'Alpha']] }).items[0].id;
  const page = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['ts', 'at', 'actor', 'author'].includes(k) ? undefined : x)));
  const ids = { mcp: idOf(d.mcpWeave), http: idOf(d.httpWeave) };
  try {
    assert.deepEqual(d.cli(['doc', 'set', 'Task#1', '--content', 'one']), { ok: true });
    assert.deepEqual(d.mcp('weave_set_doc', { entity: ids.mcp, markdown: 'one' }), { ok: true, length: 3 }, 'weave_set_doc still answers the length');
    assert.deepEqual(await d.http('PUT', `/api/entities/${ids.http}/doc`, { doc: 'one' }), { ok: true, base: createHash('sha256').update('one').digest('hex') }, 'HTTP names the base the next write starts from (Issue #1443)');
    assert.deepEqual(d.cli(['doc', 'append', 'Task#1', '--content', 'two']), { ok: true });
    assert.deepEqual(d.mcp('weave_set_doc', { entity: ids.mcp, markdown: 'two', mode: 'append' }).ok, true);
    assert.deepEqual(await d.http('POST', `/api/entities/${ids.http}/doc`, { markdown: 'two' }), { ok: true });
    const doc = await d.http('GET', `/api/entities/${ids.http}/doc`);
    assert.deepEqual(Object.keys(doc), ['field', 'doc']);
    assert.equal(doc.field, null);
    const fromMcp = d.call('weave_get_doc', { entity: ids.mcp });
    assert.equal(unwrapData(fromMcp.content[0].text), doc.doc, 'weave_get_doc answers the bare markdown');
    assert.equal(d.cli(['doc', 'get', 'Task#1']), `${doc.doc}\n`, 'weave doc get prints the bare markdown');
    assert.equal((await d.http('GET', `/api/entities/${ids.http}/doc?field=Description`)).field, 'Description');
    const empty = await d.raw('PUT', `/api/entities/${ids.http}/doc`, { text: 'x' });
    assert.equal(empty.status, 400, 'a write with no doc or markdown is still a 400');
    assert.match((await empty.json()).error, /carries its text under `doc` or `markdown`/);
    const bareSet = d.run(['doc', 'set', 'Task#1']);
    assert.notEqual(bareSet.status, 0);
    assert.match(bareSet.stderr, /doc set needs its text: --content <markdown> or --file <path>/);
    const listed = { cli: d.cli(['doc-revisions', 'Task#1']), mcp: d.mcp('weave_doc_revisions', { entity: ids.mcp }), http: await d.http('GET', `/api/entities/${ids.http}/doc/revisions`) };
    assert.ok(listed.http.revisions.length >= 1);
    assert.deepEqual(page(listed.mcp), page(listed.http), 'weave_doc_revisions and GET doc/revisions answer alike');
    assert.deepEqual(page(listed.cli), page(listed.http), 'weave doc-revisions and GET doc/revisions answer alike');
    const seq = listed.http.revisions.at(-1).seq;
    const one = { cli: d.cli(['doc-revisions', 'Task#1', '--seq', String(seq)]), mcp: d.mcp('weave_doc_revisions', { entity: ids.mcp, seq }), http: await d.http('GET', `/api/entities/${ids.http}/doc/revisions/${seq}`) };
    assert.deepEqual(page(one.mcp), page(one.http), 'weave_doc_revisions {seq} and GET doc/revisions/:seq answer alike');
    assert.deepEqual(page(one.cli), page(one.http));
    const back = { cli: d.cli(['doc-restore', 'Task#1', '--seq', String(seq)]), mcp: d.mcp('weave_doc_restore', { entity: ids.mcp, seq }), http: await d.http('POST', `/api/entities/${ids.http}/doc/revisions/${seq}/restore`, {}) };
    assert.deepEqual(page(back.mcp), page(back.http), 'weave_doc_restore and POST restore answer alike');
    assert.deepEqual(page(back.cli), page(back.http));
    const noSeq = d.run(['doc-restore', 'Task#1']);
    assert.notEqual(noSeq.status, 0);
    assert.match(noSeq.stderr, /--seq is required: a revision from doc-revisions/);
    const said = { cli: d.cli(['comment', 'Task#1', 'looks', 'good']), mcp: d.mcp('weave_add_comment', { entity: ids.mcp, text: 'looks good' }), http: await d.http('POST', `/api/entities/${ids.http}/comments`, { text: 'looks good' }) };
    assert.deepEqual(page(said.mcp), page(said.http), 'weave_add_comment and POST comments answer alike');
    assert.deepEqual(page(said.cli), page(said.http));
    assert.equal(said.cli.author, 'cli');
    assert.equal(said.mcp.author, 'agent');
    const added = await d.raw('POST', `/api/entities/${ids.http}/comments`, { text: 'again' });
    assert.equal(added.status, 201);
    const commentOf = (r) => r.id;
    const gone = {
      cli: d.cli(['comment', 'delete', 'Task#1', commentOf(said.cli)]),
      mcp: d.mcp('weave_delete_comment', { entity: ids.mcp, comment: commentOf(said.mcp) }),
      http: await d.http('DELETE', `/api/entities/${ids.http}/comments/${commentOf(said.http)}`),
    };
    assert.deepEqual(gone.http, { ok: true }, 'DELETE comments still answers ok');
    assert.deepEqual(page(gone.cli), page(gone.mcp), 'weave comment delete and weave_delete_comment answer alike');
    for (const [method, path, name] of [['GET', '/api/entities/x/doc', 'doc.read'], ['PUT', '/api/entities/x/doc', 'doc.set'], ['POST', '/api/entities/x/doc', 'doc.append'], ['GET', '/api/entities/x/doc/revisions', 'doc.revisions'], ['GET', '/api/entities/x/doc/revisions/3', 'doc.revisions'], ['POST', '/api/entities/x/doc/revisions/3/restore', 'doc.restore'], ['POST', '/api/entities/x/comments', 'comment.add'], ['DELETE', '/api/entities/x/comments/y', 'comment.delete']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('search and undo answer the same on CLI, MCP and HTTP, each door with its own engine call and envelope (Feature #179)', async () => {
  const seeded = (w) => { seed(w); w.addField('Task', { name: 'Points', type: 'number' }); w.createEntity('Task', { Name: 'Zebrafinch' }); };
  const d = await threeDoors('weave-registry-search-', { seeded });
  const hit = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['url', 'score', 'ts', 'at'].includes(k) ? undefined : x)));
  const idOf = (w) => w.query('Task', { where: [['Name', '=', 'Alpha']] }).items[0].id;
  try {
    const found = { mcp: d.mcp('weave_search', { query: 'zebrafinch' }), http: await d.http('GET', '/api/search?q=zebrafinch') };
    assert.ok(found.http.some((h) => h.kind === 'entity'));
    assert.deepEqual(hit(found.mcp), hit(found.http), 'weave_search and GET /api/search answer alike');
    const scoped = await d.http('GET', '/api/search?q=zebrafinch&tables=Person');
    assert.equal(scoped.filter((h) => h.kind === 'entity').length, 0, 'tables still narrows the HTTP search');
    const cliFound = d.cli(['search', 'zebra', 'finch', '--limit', '5']);
    const engine = new Weave({ path: join(tempDir('weave-registry-search-copy-'), 'x.db') });
    seeded(engine);
    assert.deepEqual(hit(cliFound), hit(engine.search('zebra finch', { limit: 5 })), 'weave search still runs the record search');
    d.cli(['update', 'Task#1', '--values', '{"Points":2}']);
    d.mcp('weave_update_entity', { entity: idOf(d.mcpWeave), values: { Points: 2 } });
    await d.http('PATCH', `/api/entities/${idOf(d.httpWeave)}`, { values: { Points: 2 } });
    const history = { cli: d.cli(['undo', '--list']), mcp: d.mcp('weave_undo', { list: true }), http: await d.http('GET', '/api/undo') };
    assert.ok(history.http.length >= 1);
    assert.deepEqual(hit(history.mcp.history), hit(history.http), 'weave_undo {list} and GET /api/undo answer alike');
    assert.deepEqual(hit(history.cli), hit(history.http), 'weave undo --list and GET /api/undo answer alike');
    assert.deepEqual(hit(d.cli(['undo', 'list'])), hit(history.http), 'weave undo list lists too');
    assert.equal((await d.http('GET', '/api/undo?limit=1')).length, 1);
    const undone = { cli: d.cli(['undo']), mcp: d.mcp('weave_undo', {}), http: await d.http('POST', '/api/undo', {}) };
    assert.deepEqual(hit(undone.mcp), hit(undone.http), 'weave_undo and POST /api/undo answer alike');
    assert.deepEqual(hit(undone.cli), hit(undone.http), 'weave undo and POST /api/undo answer alike');
    for (const [method, path, name] of [['GET', '/api/search', 'search'], ['GET', '/api/undo', 'undo.list'], ['POST', '/api/undo', 'undo.run']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('JSON export and import answer the same on CLI, MCP and HTTP, each door with its own blobs default (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-json-');
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  const dir = tempDir('weave-registry-json-file-');
  const file = join(dir, 'ws.json');
  const shape = (v) => Object.keys(v).sort();
  try {
    const fromHttp = await d.http('GET', '/api/export', undefined, auth);
    const fromMcp = d.mcp('weave_export_json', {});
    const printed = d.run(['export']);
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /^\{\n "/, 'weave export still prints the dump with a one-space indent');
    const fromCli = JSON.parse(printed.stdout);
    assert.deepEqual(shape(fromMcp), shape(fromHttp), 'weave_export_json and GET /api/export carry the same keys');
    assert.deepEqual(shape(fromCli), shape(fromHttp), 'weave export and GET /api/export carry the same keys');
    assert.deepEqual(d.cli(['export', '--out', file]), { ok: true, path: file }, 'weave export --out still answers the path');
    const missing = d.run(['import']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /import needs --file/);
    const state = d.httpWeave.exportJSON();
    const imported = { cli: d.cli(['import', '--file', file]), mcp: d.mcp('weave_import_json', { state: fromMcp }), http: await d.http('POST', '/api/import', state, auth) };
    assert.equal(imported.http.ok, true);
    assert.deepEqual(shape(imported.mcp), shape(imported.http), 'weave_import_json and POST /api/import answer alike');
    assert.deepEqual(shape(imported.cli), shape(imported.http), 'weave import and POST /api/import answer alike');
    const editor = d.httpWeave.createAccount({ name: 'ed', role: 'editor' }).token;
    const refused = await d.raw('POST', '/api/import', state, { authorization: `Bearer ${editor}` });
    assert.equal(refused.status, 403, 'an editor still cannot replace the workspace');
    for (const [method, path, name] of [['GET', '/api/export', 'json.export'], ['POST', '/api/import', 'json.import']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('the view family answers the same on CLI, MCP and HTTP, and sharing still takes an architect (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-views-');
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  const editor = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'ed', role: 'editor' }).token}` };
  const view = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['token', 'url', 'expiresAt', 'mintedAt', 'shareId', 'share', 'shares', 'createdBy', 'by', 'revision', 'ts', 'modifiedBy'].includes(k) ? undefined : x)));
  const blocks = [{ table: 'Task' }];
  try {
    const made = {
      cli: d.cli(['view', 'create', 'Board', '--blocks', JSON.stringify(blocks)]),
      mcp: d.mcp('weave_views', { action: 'create', name: 'Board', blocks }),
      http: await d.http('POST', '/api/views', { name: 'Board', blocks }, auth),
    };
    assert.deepEqual(view(made.mcp), view(made.http), 'weave_views create and POST /api/views answer alike');
    assert.deepEqual(view(made.cli), view(made.http), 'weave view create and POST /api/views answer alike');
    assert.equal((await d.raw('POST', '/api/views', { name: 'Other', blocks }, auth)).status, 201);
    d.mcp('weave_views', { action: 'create', name: 'Other', blocks });
    d.cli(['view', 'create', 'Other', '--blocks', JSON.stringify(blocks)]);
    const steps = [
      [['view', 'list'], ['list', {}, 'views'], ['GET', '/api/views']],
      [['view'], ['list', {}, 'views'], ['GET', '/api/views']],
      [['view', 'get', ':id'], ['get', {}], ['GET', '/api/views/:id']],
      [['view', 'share', ':id'], ['share', {}], ['POST', '/api/views/:id/share']],
      [['view', 'unshare', ':id'], ['unshare', {}], ['DELETE', '/api/views/:id/share']],
      [['view', 'delete', ':id'], ['delete', {}], ['DELETE', '/api/views/:id']],
      [['view', 'list', '--trash'], ['list', { trash: true }, 'views'], ['GET', '/api/views?trash=1']],
      [['view', 'restore', ':id'], ['restore', {}], ['POST', '/api/views/:id/restore']],
    ];
    for (const [c, [action, args, wrap], [method, path]] of steps) {
      const fromHttp = view(await d.http(method, path.replace(':id', made.http.id), method === 'POST' ? {} : undefined, auth));
      const fromMcp = d.mcp('weave_views', { action, view: made.mcp.id, ...args });
      assert.deepEqual(view(wrap ? fromMcp[wrap] : fromMcp), fromHttp, `weave_views ${action} and ${method} ${path} answer alike`);
      assert.deepEqual(view(d.cli(c.map((x) => (x === ':id' ? made.cli.id : x)))), fromHttp, `weave ${c.join(' ')} and ${method} ${path} answer alike`);
    }
    const refused = await d.raw('POST', `/api/views/${made.http.id}/share`, {}, editor);
    assert.equal(refused.status, 403, 'an editor still cannot share a view');
    assert.match((await refused.json()).error, /needs an architect/);
    assert.equal(d.call('weave_views', { action: 'zap' }).content[0].text, "Error: Unknown views action 'zap' (list, get, create, delete, restore, share, unshare)");
    const miss = d.run(['view', 'zap']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown view subcommand 'zap'\. Try: list, get, create, delete, restore, share, unshare/);
    for (const [method, path, name] of [['GET', '/api/views', 'view.list'], ['POST', '/api/views', 'view.create'], ['GET', '/api/views/x', 'view.get'], ['DELETE', '/api/views/x', 'view.delete'], ['POST', '/api/views/x/restore', 'view.restore'], ['POST', '/api/views/x/share', 'view.share'], ['DELETE', '/api/views/x/share', 'view.unshare']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('the share family answers the same on CLI, MCP and HTTP, and HTTP still adds the link (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-shares-');
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  const grant = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['token', 'url', 'expiresAt', 'mintedAt', 'renewedAt', 'revokedAt', 'by', 'createdBy', 'scope', 'tokenHint', 'hint', 'title', 'regeneratedAt'].includes(k) ? undefined : x)));
  try {
    const made = {
      cli: d.cli(['share', 'mint', 'workspace', '--label', 'Board']),
      mcp: d.mcp('weave_shares', { action: 'mint', kind: 'workspace', mode: 'read', visibility: 'public', label: 'Board' }),
      http: await d.http('POST', '/api/shares', { scope: { kind: 'workspace', id: null }, mode: 'read', visibility: 'public', label: 'Board' }, auth),
    };
    assert.match(made.http.url, /\/s\//, 'POST /api/shares still answers the link');
    assert.equal(made.mcp.url ?? null, made.mcp.url ?? null);
    assert.deepEqual(grant(made.mcp), grant(made.http), 'weave_shares mint and POST /api/shares answer alike');
    assert.deepEqual(grant(made.cli), grant(made.http), 'weave share mint and POST /api/shares answer alike');
    const steps = [
      [['share', 'list'], ['list', {}, 'shares'], ['GET', '/api/shares']],
      [['share'], ['list', {}, 'shares'], ['GET', '/api/shares']],
      [['share', 'update', ':id', '--label', 'Wall'], ['update', { label: 'Wall' }], ['PATCH', '/api/shares/:id', { label: 'Wall' }]],
      [['share', 'renew', ':id'], ['renew', {}], ['POST', '/api/shares/:id/renew', {}]],
      [['share', 'regenerate', ':id'], ['regenerate', {}], ['POST', '/api/shares/:id/regenerate', {}]],
      [['share', 'revoke', ':id'], ['revoke', {}], ['DELETE', '/api/shares/:id']],
    ];
    for (const [c, [action, args, wrap], [method, path, body]] of steps) {
      const raw = await d.http(method, path.replace(':id', made.http.id), body, auth);
      for (const g of [].concat(raw)) assert.match(g.url, /\/s\//, `${method} ${path} still adds the link`);
      const fromHttp = grant(raw);
      const fromMcp = d.mcp('weave_shares', { action, share: made.mcp.id, ...args });
      assert.deepEqual(grant(wrap ? fromMcp[wrap] : fromMcp), fromHttp, `weave_shares ${action} and ${method} ${path} answer alike`);
      assert.deepEqual(grant(d.cli(c.map((x) => (x === ':id' ? made.cli.id : x)))), fromHttp, `weave ${c.join(' ')} and ${method} ${path} answer alike`);
    }
    const editor = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'ed', role: 'editor' }).token}` };
    assert.equal((await d.raw('GET', '/api/shares', undefined, editor)).status, 403, 'only an architect still lists shares');
    assert.equal(d.call('weave_shares', { action: 'zap' }).content[0].text, "Error: Unknown shares action 'zap' (list, mint, renew, revoke, update, regenerate)");
    const miss = d.run(['share', 'zap']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown share subcommand 'zap'\. Try: list, mint, renew, revoke, update, regenerate/);
    for (const [method, path, name] of [['GET', '/api/shares', 'share.list'], ['POST', '/api/shares', 'share.mint'], ['POST', '/api/shares/x/renew', 'share.renew'], ['DELETE', '/api/shares/x', 'share.revoke'], ['PATCH', '/api/shares/x', 'share.update'], ['POST', '/api/shares/x/regenerate', 'share.regenerate']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); }
});

test('file attach, read and delete answer the same on CLI, MCP and HTTP, and each door keeps its own bytes (Feature #179)', async () => {
  const withFiles = (w) => { seed(w); w.addField('Task', { name: 'Papers', type: 'attachments' }); };
  const d = await threeDoors('weave-registry-files-', { seeded: withFiles });
  const dir = tempDir('weave-registry-files-src-');
  const src = join(dir, 'note.txt');
  writeFileSync(src, 'hello files');
  const b64 = Buffer.from('hello files').toString('base64');
  const file = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (['entity', 'path', 'hash', 'sha256', 'url'].includes(k) ? undefined : x)));
  try {
    const alpha = { cli: d.cli(['query', 'Task']).items[0].id, mcp: d.mcpWeave.query('Task').items[0].id, http: d.httpWeave.query('Task').items[0].id };
    for (const field of [null, 'Papers']) {
      const made = {
        cli: d.cli(['file', 'attach', alpha.cli, '--path', src, '--mime', 'text/plain', ...(field ? ['--field', field] : [])]),
        mcp: d.mcp('weave_attach_file', { entity: alpha.mcp, name: 'note.txt', mime: 'text/plain', contentBase64: b64, ...(field ? { field } : {}) }),
        http: await d.http('POST', `/api/entities/${alpha.http}${field ? `/fields/${field}` : ''}/files`, { name: 'note.txt', mime: 'text/plain', contentBase64: b64 }),
      };
      assert.deepEqual(file(made.mcp), file(made.http), `weave_attach_file and POST ${field ? 'the field' : 'the record'} files answer alike`);
      assert.deepEqual(file(made.cli), file(made.http), `weave file attach and POST ${field ? 'the field' : 'the record'} files answer alike`);
      const fromHttp = await d.raw('GET', `/api/files/${made.http.id}`);
      assert.equal(fromHttp.status, 200);
      assert.ok(fromHttp.headers.get('etag'), 'GET /api/files/:id still sends its ETag');
      assert.equal(await fromHttp.text(), 'hello files');
      assert.equal((await d.raw('GET', `/api/files/${made.http.id}`, undefined, { 'if-none-match': fromHttp.headers.get('etag') })).status, 304, 'GET /api/files/:id still answers 304');
      const read = d.mcp('weave_files', { action: 'read', file: made.mcp.id });
      assert.equal(Buffer.from(read.contentBase64, 'base64').toString(), 'hello files', 'weave_files read still answers base64');
      assert.equal(read.name, 'note.txt');
      const out = d.run(['file', 'read', made.cli.id]);
      assert.equal(out.stdout, 'hello files', 'weave file read still writes the bytes, no newline');
      const saved = join(dir, 'out.txt');
      const meta = d.cli(['file', 'read', made.cli.id, '--out', saved]);
      assert.equal(meta.path, saved);
      assert.equal(meta.name, 'note.txt');
      const gone = {
        cli: d.cli(['file', 'delete', alpha.cli, made.cli.id]),
        mcp: d.mcp('weave_files', { action: 'delete', entity: alpha.mcp, file: made.mcp.id }),
        http: await d.http('DELETE', `/api/entities/${alpha.http}/files/${made.http.id}`),
      };
      assert.deepEqual(file(gone.mcp), file(gone.http), 'weave_files delete and DELETE files answer alike');
      assert.deepEqual(file(gone.cli), file(gone.http), 'weave file delete and DELETE files answer alike');
    }
    const missing = await d.raw('DELETE', `/api/entities/${alpha.http}/files/00000000-0000-4000-8000-000000000000`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "No file '00000000-0000-4000-8000-000000000000' on this record", code: 'not-found' });
    assert.equal(d.call('weave_files', { action: 'zap', file: 'x' }).content[0].text, "Error: Unknown files action 'zap' (read, delete)");
    assert.match(d.call('weave_attach_file', { entity: alpha.mcp, name: 'x.txt' }).content[0].text, /Send contentBase64, or prepare:true and size/);
    assert.match(d.call('weave_attach_file', { entity: alpha.mcp, name: 'x.txt', prepare: true, size: 3 }).content[0].text, /Prepare uploads over the authenticated HTTP MCP endpoint/);
    const noPath = d.run(['file', 'attach', alpha.cli]);
    assert.notEqual(noPath.status, 0);
    assert.match(noPath.stderr, /file attach needs --path/);
    const miss = d.run(['file', 'zap']);
    assert.notEqual(miss.status, 0);
    assert.match(miss.stderr, /Unknown file subcommand 'zap'\. Try: attach, read, delete/);
    for (const [method, path, name] of [['POST', '/api/entities/x/files', 'file.attach'], ['POST', '/api/entities/x/fields/y/files', 'file.attach'], ['GET', '/api/files/x', 'file.read'], ['DELETE', '/api/entities/x/files/y', 'file.delete']]) {
      assert.equal(matchRoute(method, path)?.cmd.name, name);
    }
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('space list and members answer the same on CLI and HTTP, and a bare space still lists (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-space-members-', { seeded: (w) => { seed(w); w.createAccount({ name: 'ann', role: 'editor' }); } });
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  try {
    assert.deepEqual(bare(d.cli(['space', 'list'])), bare(await d.http('GET', '/api/spaces', undefined, auth)), 'space list and GET /api/spaces answer alike');
    assert.deepEqual(bare(d.cli(['space'])), bare(d.cli(['space', 'list'])), 'a bare weave space lists');
    assert.deepEqual(bare(d.cli(['space', 'members', 'Ops'])), bare(await d.http('GET', '/api/spaces/Ops/members', undefined, auth)), 'members read alike');
    assert.deepEqual(bare(d.cli(['space', 'members', 'Ops', 'ann', '--role', 'observer'])), bare(await d.http('PUT', '/api/spaces/Ops/members/ann', { role: 'observer' }, auth)), 'a member set answers alike');
    assert.equal(d.cli(['space', 'members', 'Ops']).find((m) => m.name === 'ann').role, 'observer');
    assert.deepEqual(bare(d.cli(['space', 'members', 'Ops', 'ann', '--remove'])), bare(await d.http('DELETE', '/api/spaces/Ops/members/ann', undefined, auth)), 'a member removal answers alike');
    assert.deepEqual(d.cli(['space', 'members', 'Ops']), []);
    const refused = d.run(['space', 'bogus']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Unknown space subcommand 'bogus'\. Try: create, list, update, members, delete, restore/);
  } finally { d.close(); }
});

test('table list and the view family answer the same on CLI, MCP and HTTP, each door with its own list (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-table-view-');
  const auth = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'root', role: 'architect' }).token}` };
  const named = (v) => bare(JSON.parse(JSON.stringify(v, (k, x) => (['createdAt', 'updatedAt'].includes(k) ? undefined : x))));
  try {
    const listed = await d.http('GET', '/api/tables', undefined, auth);
    assert.deepEqual(d.cli(['table', 'list']), listed.map((t) => t.qualified), 'the CLI lists qualified names, HTTP the rows');
    assert.deepEqual(d.cli(['db']), d.cli(['table', 'list']), 'a bare weave db still lists');
    assert.deepEqual(Object.keys(listed[0]), ['id', 'name', 'qualified', 'spaceId', 'position']);
    assert.deepEqual((await d.http('GET', '/api/tables?space=Ops', undefined, auth)).map((t) => t.qualified), ['Ops/Task', 'Ops/Person']);
    assert.deepEqual(named(d.cli(['table', 'view', 'Task'])), named(await d.http('GET', '/api/tables/Task/views', undefined, auth)), 'view list alike');
    assert.deepEqual(named(d.mcp('weave_table_view', { view: 'Task' })), named(await d.http('GET', '/api/tables/Task/views', undefined, auth)));
    assert.deepEqual(named(d.cli(['table', 'view', 'Task/blank'])), named(await d.http('GET', '/api/tables/Task/views/blank', undefined, auth)), 'one view alike');
    const made = [
      d.cli(['table', 'view', 'Task/Open', '--search', 'a', '--sort', '[{"field":"Name","dir":"asc"}]']),
      d.mcp('weave_table_view', { view: 'Task/Open', search: 'a', sort: [{ field: 'Name', dir: 'asc' }] }),
      await d.http('PATCH', '/api/tables/Task/views/Open', { search: 'a', sort: [{ field: 'Name', dir: 'asc' }] }, auth),
    ].map(named);
    assert.deepEqual(made[0], made[2], 'CLI and PATCH write alike');
    assert.deepEqual(made[1], made[2], 'MCP and PATCH write alike');
    const gone = [
      d.cli(['table', 'view', 'Task/Open', '--delete']),
      d.mcp('weave_table_view', { view: 'Task/Open', delete: true }),
      await d.http('DELETE', '/api/tables/Task/views/Open', undefined, auth),
    ].map(named);
    assert.deepEqual(gone[0], gone[2], 'CLI and DELETE remove alike');
    assert.deepEqual(gone[1], gone[2], 'MCP and DELETE remove alike');
    const editor = { authorization: `Bearer ${d.httpWeave.createAccount({ name: 'ed', role: 'editor' }).token}` };
    assert.equal((await d.raw('PATCH', '/api/tables/Task/views/Open', {}, editor)).status, 403, 'an editor still cannot write a table view');
    assert.equal((await d.raw('GET', '/api/tables/Task/views', undefined, editor)).status, 200, 'an editor still reads them');
  } finally { d.close(); }
});

test('vocabulary answers the same on CLI, MCP and HTTP, and an unknown section is refused on each (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-vocabulary-');
  try {
    const whole = await d.http('GET', '/api/vocabulary');
    assert.deepEqual(d.cli(['vocabulary']), whole, 'the whole vocabulary alike');
    assert.deepEqual(d.mcp('weave_vocabulary', {}), whole);
    const icons = await d.http('GET', '/api/vocabulary?section=icons&query=wallet');
    assert.deepEqual(d.cli(['vocabulary', 'icons', 'wallet']), icons, 'an icon search alike');
    assert.deepEqual(d.mcp('weave_vocabulary', { sections: ['icons'], query: 'wallet' }), icons);
    const several = await d.http('GET', '/api/vocabulary?section=icons,optionColors');
    assert.deepEqual(d.cli(['vocabulary', 'icons,optionColors']), several, 'several sections alike');
    const res = await d.raw('GET', '/api/vocabulary?section=nope');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'invalid');
    assert.match(body.error, /Unknown vocabulary section 'nope'/);
    const cli = d.run(['vocabulary', 'nope']);
    assert.equal(cli.status, 40);
    assert.match(cli.stderr, /error \[invalid\]: Unknown vocabulary section 'nope'/);
    const mcp = d.call('weave_vocabulary', { section: 'nope' });
    assert.equal(mcp.isError, true);
    assert.match(mcp.content[0].text, /Unknown vocabulary section 'nope'/);
  } finally { d.close(); }
});

test('GET /api/share is a registry route and still answers 404 without a share token (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-share-current-');
  try {
    assert.equal(matchRoute('GET', '/api/share').cmd.name, 'share.current');
    const res = await d.raw('GET', '/api/share');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'No share token on this request: send Authorization: Bearer wvs_…', code: 'not-found' });
  } finally { d.close(); }
});

test('template list and use answer on CLI, MCP and HTTP, each door with its own shape and refusals (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-templates-', { seeded: (w) => { seed(w); w.createSpace({ name: 'CRM', template: true }); } });
  try {
    const listed = await d.http('GET', '/api/templates');
    assert.deepEqual(bare(d.cli(['template', 'list'])), bare(listed), 'template list and GET /api/templates answer alike');
    assert.deepEqual(d.cli(['template']), d.cli(['template', 'list']), 'a bare weave template lists');
    const viaMcp = d.mcp('weave_template_list', {});
    assert.deepEqual(bare(viaMcp.templates), bare(listed), 'MCP answers the templates inside its envelope');
    assert.ok(Array.isArray(viaMcp.starters), 'and the starter catalog beside them');
    const other = join(tempDir('weave-registry-templates-into-'), 'other.db');
    const made = d.cli(['template', 'use', 'CRM', '--into', other, '--name', 'Sales']);
    assert.equal(made.space.name, 'Sales');
    assert.match(d.run(['template', 'use', 'CRM']).stderr, /template use needs --into/);
    assert.match(d.run(['template', 'use']).stderr, /Usage: weave template use <space>/);
    assert.match(d.call('weave_template_use', { space: 'CRM', workspace: 'x' }).content[0].text, /this stdio server holds one workspace/);
    const res = await d.raw('POST', '/api/spaces/CRM/use', {});
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Name the workspace to build in/);
  } finally { d.close(); }
});

test('schema describe, apply and build answer on CLI, MCP and HTTP, each door with its own shape (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-schema-');
  const plain = (v) => JSON.parse(JSON.stringify(bare(v), (k, x) => (k === 'url' ? undefined : x)));
  try {
    assert.equal(matchRoute('GET', '/api/schema').cmd.name, 'schema.describe');
    assert.equal(matchRoute('PUT', '/api/schema').cmd.name, 'schema.apply');
    assert.equal(matchRoute('POST', '/api/build').cmd.name, 'build');
    const described = await d.http('GET', '/api/schema');
    assert.deepEqual(plain(d.cli(['schema'])), plain(described), 'weave schema and GET /api/schema answer alike');
    assert.deepEqual(plain(d.cli(['schema', 'export'])), plain(described), 'weave schema export prints the same document');
    assert.deepEqual(plain(d.cli(['schema', 'anything'])), plain(described), 'an unknown subcommand still describes');
    assert.deepEqual(plain(d.mcp('weave_schema', {})), plain(described), 'weave_schema answers the document');
    const file = join(tempDir('weave-registry-schema-file-'), 'schema.json');
    assert.deepEqual(d.cli(['schema', 'export', '--out', file]), { ok: true, out: file });

    const doc = JSON.parse(JSON.stringify(described));
    doc.push({ space: 'Ledger', tables: [{ name: 'Entry', fields: [] }] });
    writeFileSync(file, JSON.stringify(doc));
    const planned = await d.http('PUT', '/api/schema', { schema: doc, dryRun: true });
    assert.deepEqual(plain(d.cli(['schema', 'apply', '--file', file, '--dry-run'])), plain(planned), 'schema apply and PUT /api/schema plan alike');
    assert.deepEqual(plain(d.mcp('weave_apply_schema', { document: doc, dryRun: true }).plan), plain(planned), 'weave_apply_schema wraps the plan');
    assert.equal(d.httpWeave.describeSchema().some((s) => s.space === 'Ledger'), false, 'a dry run writes nothing');
    await d.http('PUT', '/api/schema', doc);
    assert.equal(d.httpWeave.describeSchema().some((s) => s.space === 'Ledger'), true, 'a bare document body applies');

    const spec = { spaces: [{ name: 'Budget', tables: [{ name: 'Account', records: [{ Name: 'Amex' }] }] }] };
    const built = await d.http('POST', '/api/build', spec);
    assert.equal(built.ok, true);
    const specFile = join(tempDir('weave-registry-build-file-'), 'spec.json');
    writeFileSync(specFile, JSON.stringify(spec));
    assert.deepEqual(d.cli(['build', specFile, '--dry-run']).ok, true, 'weave build prints one JSON line');
    assert.equal(d.run(['build', specFile]).stdout.trim().startsWith('{'), true);
    assert.equal(d.mcp('weave_build', { spec, dryRun: true }).ok, true, 'weave_build answers a JSON line');
    assert.equal(d.mcp('weave_build', spec).ok, true, 'a bare spec builds');
    const bad = { spaces: [{ tables: [] }] };
    const refused = await d.raw('POST', '/api/build', bad);
    assert.equal(refused.status, 400, 'a spec with errors answers 400');
    assert.equal((await refused.json()).ok, false);
    writeFileSync(specFile, JSON.stringify(bad));
    const failed = d.run(['build', specFile]);
    assert.equal(failed.status, 1, 'the CLI exits 1 on a refused spec');
    assert.equal(JSON.parse(failed.stdout).ok, false);
  } finally { d.close(); }
});

test('the workspace record, logo and order answer on CLI, MCP and HTTP, each door with its own shape (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-workspace-');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  try {
    assert.equal(matchRoute('PUT', '/api/workspace/logo').cmd.name, 'workspace.logo.set');
    assert.equal(matchRoute('POST', '/api/workspace/logo').cmd.name, 'workspace.logo.set');
    assert.equal(matchRoute('GET', '/api/workspaces').cmd.name, 'workspace.order');
    const record = await d.http('GET', '/api/workspace');
    assert.match(record.url, /^\/w\//);
    assert.equal(typeof record.schemaVersion, 'string');
    const cliGet = d.cli(['workspace', 'get']);
    assert.deepEqual(Object.keys(cliGet), ['id', 'name', 'title', 'description', 'logo', 'requireAuth', 'linkPreview']);
    assert.deepEqual(d.cli(['workspace']), cliGet, 'a bare weave workspace reads');
    assert.deepEqual(d.mcp('weave_workspace', {}), d.mcp('weave_workspace', { action: 'get' }), 'no action reads');
    assert.deepEqual(Object.keys(d.mcp('weave_workspace', {})), Object.keys(cliGet));
    const unknown = d.call('weave_workspace', { action: 'nope' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /Unknown workspace action 'nope' \(get, update, logo, clear-logo, order, move\)/);

    const patched = await d.http('PATCH', '/api/workspace', { description: 'Over http' });
    assert.deepEqual(Object.keys(patched), ['id', 'url', 'name', 'title', 'description', 'linkPreview']);
    assert.equal(d.cli(['workspace', 'set', '--description', 'Over cli']).description, 'Over cli');
    assert.equal(d.cli(['workspace', 'update', '--description', 'Alias']).description, 'Alias');
    assert.equal(d.mcp('weave_workspace', { action: 'update', description: 'Over mcp' }).description, 'Over mcp');
    assert.deepEqual(await d.http('PATCH', '/api/workspace', { requireAuth: false }), { requireAuth: false }, 'a lone requireAuth answers alone');

    const file = join(tempDir('weave-registry-logo-'), 'logo.svg');
    writeFileSync(file, svg);
    assert.equal(d.cli(['workspace', 'logo', '--path', file, '--mime', 'image/svg+xml']).mime, 'image/svg+xml');
    const out = join(dirname(file), 'got.svg');
    const read = d.cli(['workspace', 'logo', '--out', out]);
    assert.equal(read.ok, true);
    assert.deepEqual(d.cli(['workspace', 'logo', '--clear']), { logo: false });
    assert.match(d.run(['workspace', 'logo']).stderr, /workspace logo needs --path, --out or --clear/);
    const put = await d.http('PUT', '/api/workspace/logo', { name: 'a.svg', contentBase64: svg.toString('base64') });
    assert.equal(put.mime, 'image/svg+xml');
    const got = await d.raw('GET', '/api/workspace/logo');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(got.headers.get('content-type'), 'image/svg+xml');
    assert.deepEqual(await d.http('DELETE', '/api/workspace/logo'), { ok: true });
    assert.equal((await d.raw('GET', '/api/workspace/logo')).status, 404);
    assert.equal(d.mcp('weave_workspace', { action: 'logo', contentBase64: svg.toString('base64') }).name, 'logo.png');
    assert.deepEqual(d.mcp('weave_workspace', { action: 'clear-logo' }), { logo: false });

    const names = (list) => list.map((x) => x.name);
    assert.deepEqual(names(d.mcp('weave_workspace', { action: 'order' }).workspaces).sort(), names(await d.http('GET', '/api/workspaces')).sort().filter((n) => names(d.mcp('weave_workspace', { action: 'order' }).workspaces).includes(n)));
    const none = await d.raw('PATCH', `/api/workspaces/${record.name}`, {});
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /position is required/);
    assert.deepEqual(d.cli(['workspace', 'link-preview']).linkPreview, true, 'the hand-written subcommands still answer');
  } finally { d.close(); }
});

test('accounts, identity links and invites answer on CLI, MCP and HTTP, each door with its own shape (Feature #179)', async () => {
  const d = await threeDoors('weave-registry-accounts-', { env: { WEAVE_OIDC_ISSUER: 'https://idp.example.test' } });
  process.env.WEAVE_OIDC_ISSUER = 'https://idp.example.test';
  try {
    assert.equal(matchRoute('DELETE', '/api/accounts/a/identities').cmd.name, 'account.unlink');
    assert.equal(matchRoute('DELETE', '/api/accounts/a').cmd.name, 'account.delete');
    const made = await d.http('POST', '/api/accounts', { name: 'http-bot', role: 'architect' });
    assert.equal(made.account.name, 'http-bot');
    const arch = { authorization: `Bearer ${made.token}` };
    const http = (method, path, payload) => d.http(method, path, payload, arch);
    assert.equal(d.cli(['account', 'create', 'cli-bot']).account.name, 'cli-bot');
    assert.equal(d.mcp('weave_accounts', { action: 'create', name: 'mcp-bot' }).account.name, 'mcp-bot');
    const listed = await http('GET', '/api/accounts');
    assert.ok(Array.isArray(listed) && listed.some((a) => a.name === 'http-bot'));
    assert.ok(Array.isArray(d.cli(['account'])), 'a bare weave account lists');
    assert.ok(Array.isArray(d.mcp('weave_accounts', { action: 'list' }).accounts), 'MCP wraps the list');
    await http('POST', '/api/accounts', { name: 'peer', role: 'editor' });
    assert.equal((await http('PATCH', '/api/accounts/peer', { role: 'observer' })).role, 'observer');
    assert.equal(d.cli(['account', 'set', 'cli-bot', '--role', 'observer']).role, 'observer');
    const unknown = d.call('weave_accounts', { action: 'nope' });
    assert.match(unknown.content[0].text, /Unknown accounts action 'nope' \(list, create, set, delete, require-auth, sessions, revoke-session, link-identity, unlink-identity, invite, invites, revoke-invite\)/);

    const link = await http('POST', '/api/accounts/http-bot/identities', { issuer: 'https://idp.example.test' });
    assert.match(link.url, /\/api\/auth\/oidc\/start\?invite=/);
    assert.match(d.cli(['account', 'link', 'cli-bot', '--issuer', 'https://idp.example.test']).url, /invite=/);
    assert.match(d.mcp('weave_accounts', { action: 'link-identity', account: 'mcp-bot' }).url, /invite=/);
    assert.match(d.run(['account', 'link', 'cli-bot', '--email', 'a@b.c']).stderr, /weave no longer links by email/);
    assert.match(d.run(['account', 'unlink', 'cli-bot']).stderr, /account unlink needs --subject/);

    const invited = await http('POST', '/api/invites', { email: 'pat@example.test', role: 'editor', issuer: 'https://idp.example.test' });
    assert.equal(invited.mailed, false);
    assert.match(invited.url, /invite=/);
    assert.match(d.cli(['invite', 'sam@example.test', '--issuer', 'https://idp.example.test']).url, /invite=/);
    assert.match(d.mcp('weave_accounts', { action: 'invite', email: 'lee@example.test' }).url, /invite=/);
    const pending = await http('GET', '/api/invites');
    assert.equal(pending.length >= 1, true);
    assert.deepEqual(d.cli(['invite', 'list']).map((i) => i.email), ['sam@example.test'], 'invite list answers the bare list');
    assert.ok(Array.isArray(d.mcp('weave_accounts', { action: 'invites' }).invites));
    assert.ok((await http('DELETE', `/api/invites/${encodeURIComponent(invited.id)}`)).revoked);

    assert.deepEqual(d.mcp('weave_accounts', { action: 'sessions', account: 'mcp-bot' }), { sessions: [] });
    assert.deepEqual(d.cli(['account', 'sessions', 'cli-bot']), []);
    assert.match(d.run(['account', 'revoke-session', 'cli-bot']).stderr, /account revoke-session needs --all or --id/);
    assert.equal(await http('DELETE', '/api/accounts/peer').then((r) => typeof r), 'object');
    assert.equal(d.cli(['workspace', 'require-auth', '--off']), false, 'require-auth off answers false');
    assert.equal(d.mcp('weave_accounts', { action: 'require-auth', on: false }), false);
    assert.equal(d.cli(['workspace', 'link-preview']).linkPreview, true);
    assert.equal(d.cli(['workspace']).name.length > 0, true, 'a bare weave workspace reads');
    assert.match(d.run(['workspace', 'nope']).stderr, /Unknown workspace subcommand 'nope'/);
  } finally { delete process.env.WEAVE_OIDC_ISSUER; d.close(); }
});

test('the role gate reads writes from the registry and keeps only the routes the registry does not serve (Feature #179)', async () => {
  const { readFileSync } = await import('node:fs');
  const gate = readFileSync(join(ROOT, 'src/routes.js'), 'utf8').match(/const hit = matchRoute\(m2, path\);[\s\S]*?const sysM/)[0];
  const paths = [...gate.matchAll(/path === '([^']+)'/g)].map((m) => m[1]).filter((p) => p.startsWith('/api/') && p !== '/api/auth/');
  assert.deepEqual(paths.sort(), ['/api/markdown', '/api/mcp', '/api/onboarding']);
  for (const p of paths) assert.equal(COMMANDS.some((c) => httpPaths(c).includes(p)), false, `${p} is not a registry route`);
  assert.doesNotMatch(gate, /\/api\\\/(spaces|tables)/);
});
