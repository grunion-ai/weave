import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_KEYSTORE = join(tempDir('weave-roles-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { COMMANDS, toolCommand } = await import('../src/commands.js');
const { TOOLS } = await import('../src/mcp.js');
const { client, unwrapData } = await import('./lib/fixtures.mjs');

const ROLES = ['observer', 'editor', 'architect'];
const RANK = { observer: 0, editor: 1, architect: 2 };
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
const ISSUER = 'https://idp.example.test';
const CALLERS = ['owner', 'architect', 'editor', 'observer', 'anonymous', 'share', 'token'];
const SECRET = 'k9-secret-of-the-architect';

test('every registry row declares the least role that runs it and its four hints (Feature #363)', () => {
  for (const c of COMMANDS) {
    assert.ok(ROLES.includes(c.minRole), `${c.name} declares minRole, one of ${ROLES.join(', ')}`);
    assert.deepEqual(Object.keys(c.annotations ?? {}).sort(), [...HINTS].sort(), `${c.name} declares its four hints`);
    for (const k of HINTS) assert.equal(typeof c.annotations[k], 'boolean', `${c.name}.${k} is a boolean`);
    if (c.annotations.readOnlyHint) assert.equal(c.annotations.destructiveHint, false, `${c.name} reads and destroys`);
    if (c.writes === 'schema') assert.equal(c.minRole, 'architect', `${c.name} changes structure, so it takes an architect`);
  }
});

test('a tool carries what its rows declare: read-only and idempotent when every row is, destructive and open-world when any is (Feature #363)', () => {
  for (const t of TOOLS) {
    const rows = COMMANDS.filter((c) => c.tool?.name === t.name && !c.toolRefusal);
    if (!rows.length) continue;
    const every = (k) => rows.every((c) => c.annotations[k]);
    const some = (k) => rows.some((c) => c.annotations[k]);
    const { title, ...hints } = t.annotations;
    assert.deepEqual(hints, { readOnlyHint: every('readOnlyHint'), destructiveHint: some('destructiveHint'), idempotentHint: every('idempotentHint'), openWorldHint: some('openWorldHint') }, t.name);
  }
});

let keys = 0;
function world({ accounts = true } = {}) {
  const w = new Weave();
  w.updateWorkspace({ name: accounts ? 'roles' : 'solo' });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.createTable({ space: 'Ops', name: 'Person' });
  w.addField('Task', { name: 'Points', type: 'number' });
  w.addRelation('Task', { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-many' });
  w.addField('Task', { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }] } });
  w.createEntity('Person', { Name: 'Pat' });
  const alpha = w.createEntity('Task', { Name: 'Alpha' }).id;
  const gone = w.createEntity('Task', { Name: 'Gone' }).id;
  w.deleteEntity(gone);
  w.setDoc(alpha, 'first');
  const sample = {
    db: 'Task', table: 'Task', field: 'Points', space: 'Ops', entity: alpha, gone, id: alpha, seq: 1, delivery: 'nope', hook: 'nope', account: 'spare', rest: 'spare', ref: 'spare', key: `gate-${++keys}`,
    comment: w.addComment(alpha, { author: 'pat', text: 'hi' }).id,
    view: w.createView({ name: 'Seen', blocks: [{ table: 'Task' }] }).id,
    file: w.attachFile(alpha, { name: 'gate.txt', mime: 'text/plain', bytes: Buffer.from('gate').toString('base64') }).id,
    run: w.startRun({ name: 'Gate run' }).id,
    automation: w.createAutomation('Task', { name: 'Auto', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Points', value: 1 }] }).id,
  };
  const grant = w.mintShare({ scope: { kind: 'table', id: w.getTable('Task').id } });
  sample.share = grant.id;
  const tokens = {};
  if (accounts) {
    const arch = w.createAccount({ name: 'arch', role: 'architect' });
    tokens.architect = arch.token;
    tokens.editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
    tokens.observer = w.createAccount({ name: 'ob', role: 'observer' }).token;
    tokens.token = w.createAccount({ name: 'bot', role: 'architect', space: 'Ops' }).token;
    tokens.share = grant.token;
    w.createAccount({ name: 'spare', role: 'editor' });
    w.asAccount(arch.account, () => w.setKey(sample.key, SECRET));
  }
  return { w, sample, tokens, call: client(createWorkspaceHub(w)) };
}

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const BODIES = (s) => ({
  'field.add': { name: 'Due', type: 'date' },
  'field.update': { name: 'Score' },
  'field.rollback': { activity: 'nope' },
  'formula.check': { expression: 'Points * 2' },
  'relation.add': { name: 'Helper', targetDb: 'Person' },
  'space.create': { name: 'Sales' },
  'space.update': { description: 'ops' },
  'space.member.set': { role: 'editor' },
  'table.create': { space: 'Ops', name: 'Note' },
  'table.update': { description: 'tasks' },
  'table.view.set': { hide: ['Points'] },
  'table.move': { space: 'Ops' },
  'run.start': { name: 'Gate start' },
  'run.update': { status: 'running' },
  'automation.create': { db: 'Task', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Points', value: 2 }] },
  'automation.update': { name: 'Auto 2' },
  'key.set': { name: s.key, value: 'two' },
  'key.share': { account: 'ed' },
  'key.unshare': { account: 'ed' },
  'csv.import': { csv: 'Name\nBeta' },
  'entity.state': { field: 'Stage', state: 'Doing' },
  'entity.link': { field: 'Owner', targets: ['Pat'] },
  'entity.unlink': { field: 'Owner', targets: ['Pat'] },
  'entity.create': { Name: 'Beta' },
  'entity.update': { values: { Points: 1 } },
  'doc.set': { doc: 'second' },
  'doc.append': { doc: 'third' },
  'comment.add': { text: 'more' },
  'view.create': { name: 'Gate', blocks: [{ table: 'Task' }] },
  'share.mint': { kind: 'table', id: 'Task' },
  'share.update': { label: 'gate' },
  'file.attach': { name: 'more.txt', mime: 'text/plain', contentBase64: Buffer.from('more').toString('base64') },
  'template.use': { workspace: 'roles' },
  'workspace.update': { description: 'gate' },
  'workspace.logo.set': { name: 'gate.svg', contentBase64: svg },
  'workspace.move': { position: 0 },
  'account.create': { name: 'newbie', role: 'observer' },
  'account.set': { role: 'observer' },
  'account.require': { on: false },
  'account.sessions': { account: 'spare' },
  'account.revoke': { account: 'spare', all: true },
  'account.link': { issuer: ISSUER },
  'account.unlink': { subject: 'nobody', issuer: ISSUER },
  'invite.create': { email: 'new@example.test', role: 'editor', issuer: ISSUER },
  'entity.bulk': { ids: [s.entity], op: 'set', values: { Points: 1 } },
});
const PARAMS = {
  'table.view': { name: 'Standard' }, 'table.view.set': { name: 'Standard' }, 'table.view.delete': { name: 'Standard' },
  'key.reveal': { name: 'key' }, 'key.share': { name: 'key' }, 'key.unshare': { name: 'key' }, 'key.delete': { name: 'key' },
  'entity.restore': { entity: 'gone' }, 'workspace.move': { ref: 'roles' }, 'invite.revoke': { ref: 'nope' },
};
const TOOL_ARGS = {
  'table.view': { view: 'Task' },
  'table.view.set': { view: 'Task/Standard', hide: ['Points'] },
  'entity.create': { db: 'Task', name: 'Beta' },
  'doc.set': { markdown: 'second' },
  'doc.append': { markdown: 'third' },
  'json.import': { state: null },
  'workspace.move': { name: 'roles', position: 0 },
};

const params = (c, s) => ({ ...s, ...Object.fromEntries(Object.entries(PARAMS[c.name] ?? {}).map(([k, v]) => [k, s[v] ?? v])) });
const fill = (path, p) => path.replace(/:([a-z]+)\*?\??/gi, (_, k) => encodeURIComponent(p[k] ?? 'x'));
const spaceBound = (c) => c.name === 'entity.bulk' || /^\/api\/(?:tables|spaces|entities)\/:/.test(c.http?.path ?? '');
const keyed = (c) => c.name.startsWith('key.');
const via = (c) => (c.tool ? c.tool.name : COMMANDS.find((x) => x.tool && x.toolUse?.(TOOL_ARGS[c.name] ?? {}) === c.name)?.tool.name);

const EXCEPT = {
  'template.use': { why: 'the template lands in the workspace the body names, which needs an architect there', passes: ['owner', 'architect'], status: { anonymous: 403 } },
  'key.reveal': { why: 'any account passes the role gate, then the key\'s own access list decides', passes: ['architect'] },
  'run.start': { why: 'runs need a workspace account: the engine refuses a space-scoped token, and MCP over HTTP an owner with no account', passes: ['owner', 'architect', 'editor'], mcp: ['architect', 'editor'] },
  'run.update': { why: 'runs need a workspace account: the engine refuses a space-scoped token, and MCP over HTTP an owner with no account', passes: ['owner', 'architect', 'editor'], mcp: ['architect', 'editor'] },
  'run.list': { why: 'runs need a workspace account, and the engine refuses a space-scoped token', passes: ['owner', 'architect', 'editor', 'observer', 'anonymous'] },
};

function passes(caller, c, door = 'http') {
  const except = EXCEPT[c.name];
  if (except) return (door === 'mcp' ? except.mcp ?? except.passes : except.passes).includes(caller);
  if (caller === 'owner') return !keyed(c);
  if (caller === 'anonymous') return c.minRole === 'observer' && !keyed(c);
  if (caller === 'share') return false;
  const role = caller === 'token' ? (spaceBound(c) ? 'architect' : 'editor') : caller;
  return RANK[role] >= RANK[c.minRole];
}

const refusedOverMcp = (res) => res.isError === true && (/^Error: Unknown tool: /.test(res.content[0].text) || ['forbidden', 'unauthorized'].includes(res.structuredContent?.code));

function worldsFor(c) {
  let refused = null;
  return (caller) => (caller === 'owner' ? world({ accounts: false }) : passes(caller, c) ? world() : (refused ??= world()));
}

function overHttp(c, caller, { w, sample, tokens, call }) {
  const p = params(c, sample);
  const body = c.name === 'json.import' ? w.exportJSON() : BODIES(p)[c.name] ?? {};
  return call(c.http.method, fill(c.http.path, p), { body, token: tokens[caller] });
}

function overMcp(c, caller, { sample, tokens, call }) {
  const p = params(c, sample);
  const keys = [...(c.http?.path.matchAll(/:([a-z]+)/gi) ?? [])].map((m) => m[1]);
  const action = c.action !== undefined ? { [c.actionArg ?? 'action']: c.action } : {};
  const args = { ...action, ...(TOOL_ARGS[c.name] ?? { ...Object.fromEntries(keys.map((k) => [k, p[k]])), ...BODIES(p)[c.name] }) };
  return call('POST', '/api/mcp', { token: tokens[caller], body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: via(c), arguments: args } } });
}

test('every registry row answers owner, architect, editor, observer, anonymous, share and token callers on HTTP as its minRole says (Feature #363)', async () => {
  const seen = [];
  for (const c of COMMANDS.filter((x) => x.http && !x.http.door)) {
    const worlds = worldsFor(c);
    for (const caller of CALLERS) {
      const res = await overHttp(c, caller, worlds(caller));
      const label = `${caller} ${c.http.method} ${c.http.path} (${c.name}, minRole ${c.minRole}): ${res.status} ${JSON.stringify(res.json)?.slice(0, 160)}`;
      assert.ok(res.status < 500, label);
      if (caller === 'share') {
        if (RANK[c.minRole] > RANK.observer) assert.ok([401, 403, 404, 405].includes(res.status), `a read-only share runs nothing past a read: ${label}`);
        continue;
      }
      if (passes(caller, c)) assert.ok(![401, 403].includes(res.status), `passes: ${label}`);
      else assert.equal(res.status, EXCEPT[c.name]?.status?.[caller] ?? (caller === 'anonymous' || (caller === 'owner' && keyed(c)) ? 401 : 403), `refused: ${label}`);
      seen.push(`${c.name}:${caller}`);
    }
  }
  assert.ok(seen.length > 500, `the matrix ran ${seen.length} cells`);
});

test('every registry row a tool reaches answers the same callers over MCP as its minRole says, and as HTTP does (Feature #363)', async () => {
  let cells = 0;
  for (const c of COMMANDS.filter((x) => via(x) && !x.toolRefusal)) {
    const worlds = worldsFor(c);
    for (const caller of CALLERS) {
      const res = await overMcp(c, caller, worlds(caller));
      if (caller === 'anonymous' || caller === 'share') {
        assert.ok([401, 403].includes(res.status), `${caller} reaches no tool over /api/mcp: ${c.name} ${res.status}`);
        continue;
      }
      assert.equal(res.status, 200, `${caller} ${c.name}`);
      const reply = res.json.result;
      const label = `${caller} ${via(c)} for ${c.name} (minRole ${c.minRole}): ${reply.content[0].text.slice(0, 200)}`;
      assert.equal(refusedOverMcp(reply), !passes(caller, c, 'mcp'), label);
      cells++;
    }
  }
  assert.ok(cells > 400, `the MCP matrix ran ${cells} cells`);
});

const ADMIN = /^(?:account|invite|share|key|registry)\.|^(?:json\.import|workspace\.(?:update|move|preview)|view\.(?:share|unshare)|automation\.(?:create|update|delete|secret))$/;
const HELD = COMMANDS.filter((c) => c.writes === 'schema' || (ADMIN.test(c.name) && !['key.reveal', 'registry.report', 'share.current'].includes(c.name)));

test('every admin and schema row stays at architect on both doors, and key reveal answers no agent and no one the key was not shared with (Feature #363)', async () => {
  assert.ok(HELD.length >= 50, `${HELD.length} rows are held at architect`);
  for (const c of HELD) assert.equal(c.minRole, 'architect', `${c.name} keeps its architect gate`);
  for (const c of HELD) {
    const worlds = worldsFor(c);
    for (const caller of ['editor', 'observer', 'anonymous']) {
      if (c.http && !c.http.door) assert.ok([401, 403].includes((await overHttp(c, caller, worlds(caller))).status), `${caller} ${c.http.method} ${c.http.path} is refused over HTTP`);
      if (via(c) && !c.toolRefusal && caller !== 'anonymous') assert.equal(refusedOverMcp((await overMcp(c, caller, worlds(caller))).json.result), true, `${caller} ${via(c)} for ${c.name} is refused over MCP`);
    }
  }
  const reveal = COMMANDS.find((c) => c.name === 'key.reveal');
  for (const caller of CALLERS) {
    const answer = await overHttp(reveal, caller, world({ accounts: caller !== 'owner' }));
    assert.equal(answer.status === 200, caller === 'architect', `${caller} reveals the architect's key over HTTP: ${answer.status}`);
    if (caller !== 'architect') assert.ok(!JSON.stringify(answer.json).includes(SECRET), `${caller} reads no secret over HTTP`);
    if (caller === 'anonymous' || caller === 'share') continue;
    const { sample, tokens, call } = world({ accounts: caller !== 'owner' });
    const res = (await call('POST', '/api/mcp', { token: tokens[caller], body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_keys', arguments: { action: 'reveal', name: sample.key } } } })).json.result;
    assert.equal(res.isError, true, `${caller} reveals no key over MCP`);
    assert.ok(!res.content[0].text.includes(SECRET), `${caller} reads no secret over MCP`);
  }
});

test('HTTP and MCP agree on view management and undo: observers read them, editors run them, sharing a view takes an architect (Issue #1573)', async () => {
  const { w, sample, tokens, call } = world();
  const rpc = async (who, name, args) => (await call('POST', '/api/mcp', { token: tokens[who], body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).json.result;
  const data = (r) => JSON.parse(unwrapData(r.content[0].text));
  for (const who of ['observer', 'editor']) {
    assert.equal((await call('GET', '/api/views', { token: tokens[who] })).status, 200, `${who} lists views over HTTP`);
    assert.notEqual((await rpc(who, 'weave_views', { action: 'list' })).isError, true, `${who} lists views over MCP`);
    assert.equal((await call('GET', '/api/undo', { token: tokens[who] })).status, 200, `${who} previews undo over HTTP`);
    assert.notEqual((await rpc(who, 'weave_undo', { list: true })).isError, true, `${who} previews undo over MCP`);
  }
  assert.equal((await call('POST', '/api/views', { token: tokens.observer, body: { name: 'No', blocks: [{ table: 'Task' }] } })).status, 403);
  assert.equal(refusedOverMcp(await rpc('observer', 'weave_views', { action: 'create', name: 'No', blocks: [{ table: 'Task' }] })), true);
  assert.equal((await call('POST', '/api/undo', { token: tokens.observer, body: {} })).status, 403);
  assert.equal(refusedOverMcp(await rpc('observer', 'weave_undo', {})), true);
  const overHttpMade = await call('POST', '/api/views', { token: tokens.editor, body: { name: 'By HTTP', blocks: [{ table: 'Task' }] } });
  assert.equal(overHttpMade.status, 201);
  const overMcpMade = await rpc('editor', 'weave_views', { action: 'create', name: 'By MCP', blocks: [{ table: 'Task' }] });
  assert.notEqual(overMcpMade.isError, true, overMcpMade.content[0].text);
  const made = data(overMcpMade).id;
  assert.notEqual((await rpc('editor', 'weave_views', { action: 'delete', view: made })).isError, true);
  assert.notEqual((await rpc('editor', 'weave_views', { action: 'restore', view: made })).isError, true);
  assert.equal((await call('DELETE', `/api/views/${overHttpMade.json.id}`, { token: tokens.editor })).status, 200);
  assert.equal((await call('POST', `/api/views/${sample.view}/share`, { token: tokens.editor, body: {} })).status, 403);
  const shared = await rpc('editor', 'weave_views', { action: 'share', view: sample.view });
  assert.equal(refusedOverMcp(shared), true);
  assert.match(shared.content[0].text, /needs an architect/);
  await call('PATCH', `/api/entities/${sample.entity}`, { token: tokens.architect, body: { values: { Points: 7 } } });
  assert.notEqual((await rpc('editor', 'weave_update_entity', { entity: sample.entity, values: { Points: 3 } })).isError, true);
  const undone = await rpc('editor', 'weave_undo', {});
  assert.notEqual(undone.isError, true, undone.content[0].text);
  const read = w.readEntity(sample.entity);
  assert.equal((read.values ?? read.fields).Points, 7, 'the editor undid its own edit, never the architect\'s');
  assert.equal((await call('POST', '/api/undo', { token: tokens.editor, body: {} })).status, 200);
});

test('an editor writes no record of a system table through any tool it now holds, as over HTTP (Issue #1573)', async () => {
  const { w, tokens, call } = world();
  const spaces = w.listTables().find((t) => t.system === 'spaces');
  const row = w.listEntities(spaces.id)[0];
  const rpc = async (name, args) => (await call('POST', '/api/mcp', { token: tokens.editor, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).json.result;
  const before = JSON.stringify(w.readEntity(row.id));
  for (const [name, args] of [
    ['weave_bulk', { ids: [row.id], op: 'set', values: { Description: 'sneaked' } }],
    ['weave_set_doc', { entity: row.id, markdown: 'sneaked' }],
    ['weave_attach_file', { entity: row.id, name: 'x.txt', mime: 'text/plain', contentBase64: Buffer.from('x').toString('base64') }],
    ['weave_import_csv', { db: spaces.id, csv: 'Name\nSneaked' }],
    ['weave_delete_entity', { entity: row.id }],
  ]) {
    const res = await rpc(name, args);
    assert.equal(res.isError, true, `${name} on a System/Spaces row is refused to an editor: ${res.content[0].text}`);
  }
  for (const [method, path, body] of [
    ['POST', '/api/bulk', { ids: [row.id], op: 'set', values: { Description: 'sneaked' } }],
    ['PUT', `/api/entities/${row.id}/doc`, { doc: 'sneaked' }],
    ['POST', `/api/tables/${spaces.id}/import.csv`, { csv: 'Name\nSneaked' }],
  ]) assert.equal((await call(method, path, { token: tokens.editor, body })).status, 403, `${method} ${path}`);
  assert.equal(JSON.stringify(w.readEntity(row.id)), before, 'the Spaces row did not move');
});

test('a call that writes a table view runs as table.view.set, which takes an architect; reading one is the observer\'s (Feature #363)', () => {
  assert.equal(toolCommand('weave_table_view', { view: 'Task' }).name, 'table.view');
  assert.equal(toolCommand('weave_table_view', { view: 'Task/Standard', hide: ['Points'] }).name, 'table.view.set');
  assert.equal(toolCommand('weave_table_view', { view: 'Task/Old', delete: true }).name, 'table.view.set');
});

test('an observer deletes its own comment on either door, and nobody else\'s (Feature #363)', async () => {
  const { w, sample, tokens, call } = world();
  const rpc = async (name, args) => (await call('POST', '/api/mcp', { token: tokens.observer, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).json.result;
  const mine = (await call('POST', `/api/entities/${sample.entity}/comments`, { token: tokens.observer, body: { text: 'mine over HTTP' } })).json.id;
  const said = await rpc('weave_add_comment', { entity: sample.entity, text: 'mine over MCP' });
  const viaMcp = w.getEntity(sample.entity).comments.find((c) => c.text === 'mine over MCP').id;
  assert.notEqual(said.isError, true);
  assert.notEqual((await rpc('weave_delete_comment', { entity: sample.entity, comment: viaMcp })).isError, true, 'its own comment, over MCP');
  assert.equal((await call('DELETE', `/api/entities/${sample.entity}/comments/${mine}`, { token: tokens.observer })).status, 200, 'its own comment, over HTTP');
  const theirs = await rpc('weave_delete_comment', { entity: sample.entity, comment: sample.comment });
  assert.equal(refusedOverMcp(theirs), true, 'another\'s comment, over MCP');
  assert.match(theirs.content[0].text, /needs an editor/);
  assert.equal((await call('DELETE', `/api/entities/${sample.entity}/comments/${sample.comment}`, { token: tokens.observer })).status, 403, 'another\'s comment, over HTTP');
  assert.ok(w.getEntity(sample.entity).comments.some((c) => c.id === sample.comment));
});

test('a tool the caller\'s role may not call answers which role it needs, and tools/list still leaves it out (Issue #1560)', async () => {
  const { tokens, call } = world();
  const rpc = async (who, method, params) => (await call('POST', '/api/mcp', { token: tokens[who], body: { jsonrpc: '2.0', id: 1, method, params } })).json.result;
  const text = (r) => r.content[0].text;
  const refused = await rpc('editor', 'tools/call', { name: 'weave_add_field', arguments: { db: 'Task', name: 'Due', type: 'date' } });
  assert.equal(text(refused), 'Error: weave_add_field needs an architect token on this workspace; this token is editor');
  assert.equal(refused.structuredContent.code, 'forbidden');
  assert.equal(text(await rpc('observer', 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Task', name: 'x' } })), 'Error: weave_create_entity needs an editor token on this workspace; this token is observer');
  assert.equal(text(await rpc('editor', 'tools/call', { name: 'weave_call', arguments: { name: 'weave_add_field', args: { db: 'Task', name: 'Due', type: 'date' } } })), 'Error: weave_add_field needs an architect token on this workspace; this token is editor', 'the hatch answers alike');
  assert.equal(text(await rpc('editor', 'tools/call', { name: 'weave_call', arguments: { name: 'help', args: { tool: 'weave_add_field' } } })), 'Error: weave_add_field needs an architect token on this workspace; this token is editor', 'help names the role too');
  assert.equal(text(await rpc('editor', 'tools/call', { name: 'weave_views', arguments: { action: 'share', view: 'x' } })), 'Error: weave_views share needs an architect token on this workspace; this token is editor');
  assert.equal(text(await rpc('editor', 'tools/call', { name: 'weave_nope', arguments: {} })), 'Error: Unknown tool: weave_nope', 'a name that is no tool stays unknown');
  assert.equal((await rpc('editor', 'tools/list', {})).tools.some((t) => t.name === 'weave_add_field'), false, 'tools/list stays filtered by role');
});

test('an HTTP refusal names the route and the role that passes it, never the schema for an account write (Issue #1582)', async () => {
  const { sample, tokens, call } = world();
  for (const [who, method, path, body, status, error] of [
    ['editor', 'POST', '/api/accounts', { name: 'x', role: 'observer' }, 403, 'POST /api/accounts needs an architect on this workspace; your role here is editor'],
    ['editor', 'POST', '/api/invites', { email: 'x@example.test' }, 403, 'POST /api/invites needs an architect on this workspace; your role here is editor'],
    ['observer', 'GET', '/api/accounts', undefined, 403, 'GET /api/accounts needs an architect on this workspace; your role here is observer'],
    ['anonymous', 'GET', '/api/accounts', undefined, 401, 'GET /api/accounts needs an architect on this workspace: send a token or sign in'],
    ['editor', 'POST', '/api/tables/Task/fields', { name: 'Due', type: 'date' }, 403, 'POST /api/tables/Task/fields needs an architect on this workspace; your role here is editor'],
    ['observer', 'PATCH', `/api/entities/${sample.entity}`, { values: { Points: 1 } }, 403, `PATCH /api/entities/${sample.entity} needs an editor on this workspace; your role here is observer`],
    ['editor', 'GET', '/api/shares', undefined, 403, 'GET /api/shares needs an architect on this workspace; your role here is editor'],
    ['editor', 'GET', '/api/keys', undefined, 403, 'GET /api/keys needs an architect on this workspace; your role here is editor'],
  ]) {
    const res = await call(method, path, { token: tokens[who], body });
    assert.deepEqual([res.status, res.json?.error], [status, error], `${who} ${method} ${path}`);
  }
});
