import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { TOOLS, listTools, handleMcpMessage } from '../src/mcp.js';
import { COMMANDS, BY_TOOL, cliCommand, matchRoute, registeredTool, httpPaths } from '../src/commands.js';
import { startServer } from '../src/server.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { unwrapData } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = readFileSync(join(ROOT, 'bin/weave.js'), 'utf8');
const MCP = readFileSync(join(ROOT, 'src/mcp.js'), 'utf8');
const ROUTES = readFileSync(join(ROOT, 'src/routes.js'), 'utf8');
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

const REGISTERED = COMMANDS.map((c) => [c.name, c.engine, c.tool?.name ?? null, c.cli ? `${c.cli.command}${c.cli.sub ? ` ${c.cli.sub}` : ''}` : null, c.http ? httpPaths(c).map((p) => `${c.http.method} ${p}`) : []]);

const HAND_WRITTEN = [
  ['schema.describe', ['describeSchema'], 'weave_schema', 'schema', ['GET /api/schema']],
  ['schema.apply', ['applySchema'], 'weave_apply_schema', 'schema apply', ['PUT /api/schema']],
  ['build', ['build'], 'weave_build', 'build', ['POST /api/build']],
  ['workspace.record', ['getWorkspace', 'updateWorkspace'], 'weave_workspace', 'workspace', ['GET /api/workspace', 'PATCH /api/workspace']],
  ['workspace.logo', ['setWorkspaceLogo', 'getWorkspaceLogo', 'deleteWorkspaceLogo'], 'weave_workspace', 'workspace logo', ['GET /api/workspace/logo', 'PUT /api/workspace/logo', 'DELETE /api/workspace/logo']],
  ['workspace.order', ['workspaceOrder', 'moveWorkspace'], 'weave_workspace', 'workspace order', ['GET /api/workspaces', 'PATCH /api/workspaces/:ref']],
  ['accounts', ['createAccount', 'listAccounts', 'setAccountRole', 'deleteAccount', 'setRequireAuth'], 'weave_accounts', 'account', ['GET /api/accounts', 'POST /api/accounts', 'PATCH /api/accounts/:ref', 'DELETE /api/accounts/:rest']],
  ['auth.identities', ['linkIdentity', 'identityInvite', 'redeemIdentityInvite', 'unlinkIdentity', 'accountForIdentity'], 'weave_accounts', 'account link', ['GET /api/auth/oidc/start', 'GET /api/auth/oidc/callback']],
  ['auth.invites', ['inviteMember', 'listInvites', 'revokeInvite'], 'weave_accounts', 'invite', ['GET /api/invites', 'POST /api/invites', 'DELETE /api/invites/:ref']],
  ['auth.sessions', ['createSession', 'listSessions', 'revokeSession'], 'weave_accounts', 'account sessions', ['GET /api/auth/oidc/callback', 'POST /api/auth/logout', 'GET /api/auth/me', 'DELETE /api/auth/sessions/:ref']],
];

const SURFACE = [...HAND_WRITTEN, ...REGISTERED];

const INTERNAL = {
  actorName: 'read helper (Issue #699): every read path renders a stored account:<id> actor as the account\'s current name before it answers, so an agent only ever sees names',
  isActor: 'permission helper (Issue #699): the comment check asks whether a stored actor, id or legacy name, is the caller; an agent never asks it',
  readFileMeta: 'revalidation helper (Issue #1430): the file route checks the row is visible and answers 304 before readFile loads any bytes; an agent reads files through readFile',
  save: 'persistence', maybeRefresh: 'cross-process refresh',
  filesOnDisk: 'storage predicate (Issue #1428): the upload route asks whether this workspace keeps file bytes beside the database before it streams a body to disk',
  stageBlob: 'upload plumbing (Issue #1428): names a staging file in files/ for a body the server has not read yet; an agent attaches bytes through attachFile',
  streamBlob: 'upload plumbing (Issue #1428): writes a request body to that staging file chunk by chunk and fsyncs it, so PUT /api/uploads never holds the whole file; an agent prepares the upload and sends the body',
  dropStagedBlob: 'upload plumbing (Issue #1428): removes a staging file a refused upload left behind; nothing an agent decides',
  billing: 'read helper (Feature #256): the workspace\'s name, creation date and Clerk organization for src/billing.js; GET /api/billing is the door',
  linkBillingOrg: 'billing plumbing (Feature #256): POST /api/billing/organization links the Clerk organization it creates; an agent never links one by hand',
  fieldChangeSince: 'read helper (Feature #241): the field-config Activity entry a field update just wrote; PATCH /api/tables/:id/fields/:id, weave field update and weave_update_field answer with its activity and the formulas a repoint breaks',
  entityRevision: 'read helper (Issue #902): entity reads carry the opaque stored-row revision',
  conditionalWrite: 'HTTP concurrency boundary (Issue #902): POST /api/entities/:id/conditional applies the existing append or state verb, or both together as close, under an observed-revision write lock; the CLI and MCP doors keep the plain doc and state verbs, since a revision a caller never observed is not a conditional write',
  settleDeferred: 'process plumbing (Feature #250): runDeferredMigrations settles each workspace a supervised worker opened while the old worker still served; an agent never calls it',
  userTables: 'read helper (Issue #386) — the tables a person made, registry excluded; the hub list\'s `tables` count reads it, and describeSchema already carries the `system` flag an agent filters on',
  schemaVersion: 'read helper (Issue #274) — the structure\'s fingerprint; every API response stamps it as X-Weave-Schema-Version and GET /api/workspace ships it in the body, so an agent reads it without a verb of its own',
  workflowWorkspace: 'hub plumbing (Issue #875): the member route asks which workspace a Workflows row belongs to before it lets a member read it by id; an agent reads the row\'s Workspace column',
  detachHubRegistry: 'migration plumbing (Issue #979): validates and copies legacy hub registry records into independent workspaces before serving requests; never an agent action',
  joinRegistry: 'legacy registry enrollment retained for migration fixtures and compatibility; the current hub keeps workspaces independent',
  hostRegistry: 'legacy local registry restoration for migration and recovery plumbing; never an agent action',
  syncRegistry: 'hub plumbing (Feature #219) — re-asserts a workspace\'s rows after a soft delete or restore; rebuildRegistry is the surfaced verb',
  dropWorkspace: 'hub plumbing (Feature #219) — a hard workspace delete drops its rows; DELETE /api/workspaces/:id is the door',
  ownsKey: 'permission helper (Issue #497): the key routes ask whether the caller\'s account owns a credential before letting a non-architect rotate or delete it; weave_keys list shows the owner',
  auditWorkspace: 'audit plumbing (Issue #495): the hub writes one audit entry on the root for each workspace create, trash, restore and delete; GET /api/audit and weave_audit read them',
  now: 'the engine clock — the short and relative date costumes and today()/now() defaults read it; a test pins it',
  findSpace: 'ref resolver', getSpace: 'ref resolver', findTable: 'ref resolver', getTable: 'ref resolver',
  findField: 'ref resolver', getField: 'ref resolver', findEntity: 'ref resolver', qualifiedName: 'ref formatter',
  entityName: 'ref formatter', documentFields: 'ref helper', resolveField: 'read helper',
  descriptionField: 'ref helper — which document a table calls its description, by role rather than by name',
  credentialConfig: 'read helper — a key field\'s config with the #143 defaults filled in',
  credentialLink: 'read helper — where a remote keystore keeps the credential',
  bodyBlocks: 'read helper — the resolved body order already ships inside the schema payload',
  viewByShareToken: 'the share link IS this call', verifyToken: 'auth path',
  canSee: 'access helper (Feature #141): the router asks whether a mention or path target sits in a space the caller sees', hidesAnySpace: 'access helper (Feature #141): true when the caller cannot see every space', asAccount: 'test and CLI helper (Feature #141): runs a block as one account, the way a request does', noteTokenWrite: 'audit hook (Feature #141): the router records each write a space-scoped token makes',
  shareByToken: 'auth path (Feature #194): a /s/<token> link and an Authorization: Bearer wvs_ header ARE this call; GET /api/share answers what the token reaches',
  verifySession: 'auth path — the wv_session cookie IS this call (Feature #222 part 2)',
  removedSession: 'auth path (Feature #280) — the access-removed page reads it from a browser cookie; an agent holds no browser session',
  hasKey: 'keystore predicate', resolveKey: 'returns a secret — never leaves the process',
  integrationFetch: 'uses a secret on the wire: only engine code such as the http-request action calls it, so the key never reaches an agent (Feature #339)',
  setIntegrationCredential: 'takes a secret: an agent never holds an integration key, so a person pastes it through PUT /api/integrations/:id/credential (Feature #339)',
  storageStats: 'read helper — /api/health already ships it for the nav stats strip',
  relationTargetDbIds: 'read helper — the tables a relation may point at; describeSchema already ships them',
  previewFields: 'read helper — the chip preview; /api/markdown ships it inside resolved mentions',
  viewField: 'ref helper — which field is a table\'s chip or card, by role rather than by name',
  renderView: 'read helper — one row as its chip or card; readEntity ships both under their field names and every relation summary carries the chip',
  referencesTo: 'read helper — GET /api/entities/:ref/references already serves the backlinks',
  referencesFrom: 'read helper — GET /api/entities/:ref/references-from serves the outbound mirror',
  termOf: 'read helper — what one row is called; describeSchema ships it as term on every table, and updateTable {noun} / the Name field\'s config.term set it',
  touching: 'write plumbing (Issue #257) — collects the ids one write marked, so a caller can say what went stale; the PATCH route\'s `affected` is the door',
  onboardedAt: 'first-run state (Feature #248) — a person\'s welcome mark; GET /api/onboarding is the door, and an agent never onboards',
  markOnboarded: 'first-run state (Feature #248) — POST /api/onboarding sets it as the welcome finishes; nothing for an agent to do',
  agentSeen: 'setup state (Feature #326) — the setup page polls GET /api/start/workspaces/:slug/agent to learn an AI app connected; the agent is the thing being watched',
  noteAgent: 'auth path (Feature #326, Issue #915) — the /mcp door stamps an account\'s first answered agent call itself; an agent never calls it',
  startTrial: 'billing state (Feature #329) — POST /api/start/workspaces starts the free trial of the workspace it makes; nothing for an agent to do',
  markTrialMail: 'billing state (Issue #1298) — the hourly trial sweep stamps which trial-end mail went out; nothing for an agent to do',
  affectedBy: 'read helper (Issue #257) — the rows a client must re-read after writing one; PATCH /api/entities/:ref ships it as `affected`',
  invitesForEmail: 'auth path (Feature #290) — the pending invites sent to the signed-in person\'s verified address; GET /api/start lists them as rows of kind "invite", and an agent holds no browser session',
  acceptInvite: 'auth path (Feature #290) — accepts one of those invites by its id through the same path as the link; POST /api/start/invites/:slug/:ref is the door',
  renameAccount: 'Users row door (Feature #318) — editing a Users row\'s Name renames the account; weave_update_entity is the tool',
  viewQuery: 'read helper (Issue #839): the where, sort and search one saved view applies; weave_query {view}, CLI query --view and POST /tables/:id/query {view} run it',
  permalink: 'link formatter (Feature #203): the one /w/<ws>/e/<uuid> path every door emits as `url`; the permalink gate below holds every emitter to it',
  takeOneTime: 'write plumbing (Feature #318) — the invite link or token a Users row create hands back once; every create door ships it beside the row',
  readFileStorage: 'browser bridge (Issue #1176): the app reads an HTML file\'s page storage over GET /api/files/:id/storage and seeds it into the ?view page; an agent reads the file itself with weave_files',
  writeFileStorage: 'browser bridge (Issue #1176): the app saves what a sandboxed HTML page wrote to localStorage over PUT /api/files/:id/storage; no agent writes a page\'s storage',
  spaceHome: 'browser read (Feature #344): the space home page and phone launcher draw GET /api/spaces/:id/home; an agent reads the same tables with weave_schema and the same runs from a row\'s activity',
  workspaceHome: 'browser read (Feature #355): the phone workspace launcher draws GET /api/workspace/home; an agent reads the same spaces and tables with weave_schema and the same runs from a row\'s activity',
  automationsSettled: 'test and shutdown plumbing (Feature #310): waits for http-request runs still waiting on an answer; an agent reads the outcome from the record\'s automation-ran activity and the rule\'s Health',
  runSchedules: 'process plumbing (Feature #312): the server\'s minute ticker fires every due schedule rule on each hub workspace; an agent writes the rule as a Workflows row and the clock does the rest',
  runDeliveries: 'process plumbing (Feature #311): the minute ticker, through runSchedules, sends every failed delivery whose retry is due; an agent reads the wait from the rule\'s Health and Health Reason',
  pendingDeliveries: 'test plumbing (Feature #311): the deliveries waiting to be sent again; an agent reads the same wait from the rule\'s Health Reason',
  claimInbound: 'engine plumbing (Feature #311, wired by Feature #227): the inbound webhook endpoint acknowledges a delivery key it already ran instead of running it again',
  isEcho: 'engine plumbing (Feature #311, wired by Feature #227): the inbound webhook endpoint drops a change that repeats a write weave just sent to that source',
};

const toolNames = new Set(TOOLS.map((t) => t.name));

test('every engine capability is a decision: surfaced, or internal with a reason', () => {
  const mapped = new Set(SURFACE.flatMap(([, methods]) => methods));
  const missing = Object.getOwnPropertyNames(Weave.prototype)
    .filter((n) => n !== 'constructor' && typeof Weave.prototype[n] === 'function')
    .filter((n) => !mapped.has(n) && !(n in INTERNAL));
  assert.deepEqual(missing, [], `unsurfaced engine methods — add them to SURFACE or INTERNAL: ${missing.join(', ')}`);
});

test('every capability has an MCP tool that exists and dispatches', () => {
  for (const [capability, , tool] of SURFACE) {
    if (!tool) continue;
    assert.ok(toolNames.has(tool), `${capability} names a tool that is not in TOOLS: ${tool}`);
    if (!registeredTool(tool)) assert.match(MCP, new RegExp(`case '${tool}'`), `${tool} is listed but never dispatched`);
  }
});

test('every capability has a CLI command that exists', () => {
  for (const [capability, , , cli] of SURFACE) {
    if (!cli) continue;
    const [command, sub] = cli.split(' ');
    if (cliCommand(command, sub)) continue;
    assert.match(CLI, new RegExp(`case '${command}'`), `${capability}: no CLI command '${command}'`);
    if (sub) {
      const start = CLI.indexOf(`case '${command}'`);
      const block = CLI.slice(start, start + 3200);
      assert.ok(block.includes(`'${sub}'`), `${capability}: '${command}' has no '${sub}' subcommand`);
    }
  }
});

function routeSignatures(entry) {
  const [method, path] = entry.split(' ');
  if (!path.includes(':')) return [`'${method} ${path}'`, `path === '${path}'`];
  const src = path.replace(/\//g, '\\/').replace(/\./g, '\\.')
    .replace(/:ref/g, '([^/]+)').replace(/:rest/g, '(.+)');
  return [`/^${src}$/`];
}

test('every capability has an HTTP route that exists', () => {
  for (const [capability, , , , http] of SURFACE) {
    for (const entry of http) {
      const [method, path] = entry.split(' ');
      if (matchRoute(method, path.replace(/:[a-z]+/gi, 'x'))) continue;
      const sigs = routeSignatures(entry);
      assert.ok(sigs.some((sig) => ROUTES.includes(sig)), `${capability}: routes.js has no ${entry} (looked for ${sigs.join(' or ')})`);
    }
  }
});

test('the key actions MCP offers are the CLI\'s minus reveal, and nothing else has drifted', () => {
  const keys = COMMANDS.filter((c) => c.cli?.command === 'key');
  const offered = keys.filter((c) => !c.toolRefusal).map((c) => c.action);
  assert.deepEqual(offered, keys.map((c) => c.cli.sub).filter((a) => a !== 'reveal' && a !== 'migrate'), 'reveal (Feature #143) and migrate (Feature #213) are the only sanctioned differences');
  assert.match(keys.find((c) => c.action === 'migrate').toolRefusal, /not an agent action/);
  assert.match(keys.find((c) => c.action === 'reveal').toolRefusal, /not an agent action/);
});

test('a create tool takes every option the engine create takes', () => {
  const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  const optionsOf = (method) => {
    const sig = ENGINE.match(new RegExp(`\\n  ${method}\\(\\{([^}]*)\\}`))?.[1] ?? '';
    return sig.split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
  };
  for (const [method, tool] of [['createSpace', 'weave_create_space'], ['createTable', 'weave_create_table']]) {
    const wanted = optionsOf(method);
    assert.ok(wanted.length, `could not read ${method}'s signature`);
    const props = Object.keys(TOOLS.find((t) => t.name === tool).inputSchema.properties);
    const missing = wanted.filter((k) => !props.includes(k));
    assert.deepEqual(missing, [], `${tool} is missing ${missing.join(', ')} — the engine takes it`);
  }
});

test('the CLI creates take the same options', () => {
  assert.ok(cliCommand('space', 'create').cli.flags.includes('icon'), 'weave space create passes --icon through');
  assert.ok(cliCommand('table', 'create').cli.flags.includes('icon'), 'weave table create passes --icon through');
});

test('every MCP tool is documented in AGENTS.md', () => {
  const undocumented = [...toolNames].filter((n) => !AGENTS.includes(n));
  assert.deepEqual(undocumented, [], `tools missing from AGENTS.md: ${undocumented.join(', ')}`);
});

test('the docs that count the MCP tools count them right', () => {
  const LLMS = readFileSync(join(ROOT, 'llms.txt'), 'utf8');
  for (const [doc, name, re] of [
    [AGENTS, 'AGENTS.md', /MCP server: (\d+) tools/],
    [LLMS, 'llms.txt', /the (\d+) MCP tools/],
    [README, 'README.md', /MCP server exposes (\d+) tools/],
  ]) {
    const n = doc.match(re)?.[1];
    assert.equal(Number(n), TOOLS.length, `${name} says ${n} tools; TOOLS has ${TOOLS.length}`);
  }
  const core = listTools('core').length;
  for (const [doc, name, re] of [[AGENTS, 'AGENTS.md', /(\d+) listed by default/], [LLMS, 'llms.txt', /\((\d+) listed by default/]]) {
    assert.equal(Number(doc.match(re)?.[1]), core, `${name} miscounts the default list; it has ${core}`);
  }
});

test('every CLI command is documented in AGENTS.md', () => {
  const commands = [...new Set(SURFACE.map(([, , , cli]) => cli).filter(Boolean))];
  const undocumented = commands.filter((c) => !AGENTS.includes(`weave ${c}`));
  assert.deepEqual(undocumented, [], `CLI commands missing from AGENTS.md: ${undocumented.join(', ')}`);
});

test('the docs say the registry rows are schema writes', () => {
  for (const [doc, name] of [[AGENTS, 'AGENTS.md'], [README, 'README.md']]) {
    assert.match(doc, /System\/Fields/, `${name} must name the field registry`);
  }
  assert.match(AGENTS, /Definition/, 'AGENTS.md must name the Definition write');
  assert.match(AGENTS, /Field Order/, 'AGENTS.md must name the column-order write');
});

test('the one boundary an agent will hit is named, not left to be discovered', () => {
  assert.match(AGENTS, /workspace is a second file/i);
  assert.match(AGENTS, /POST \/api\/workspaces/);
});

test('every tool description carries enough to use it without asking a human', () => {
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length >= 40, `${t.name} needs a description that says what it does`);
    assert.equal(t.inputSchema?.type, 'object', `${t.name} needs an input schema`);
  }
});

test('the field-type list in the tool descriptions is the whole list', () => {
  const addField = TOOLS.find((t) => t.name === 'weave_add_field');
  assert.match(addField.description, /weave_vocabulary/,
    'the tool that takes a type must point at the list of types');
});

test('every checkFormula option reaches every door', () => {
  const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  const sig = ENGINE.match(/\n  checkFormula\(dbRef, expression, \{([^}]*)\}/)?.[1] ?? '';
  const options = sig.split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
  assert.ok(options.includes('scan'), 'the engine takes scan');
  const tool = TOOLS.find((t) => t.name === 'weave_check_formula');
  const cmd = BY_TOOL.get('weave_check_formula');
  assert.equal(cliCommand('formula', 'check'), cmd, 'weave formula check runs the registry entry');
  assert.equal(matchRoute('POST', '/api/tables/x/formula-check').cmd, cmd, 'POST /api/tables/:ref/formula-check runs the registry entry');
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  for (const k of options) {
    assert.ok(tool.inputSchema.properties[k], `weave_check_formula schema lacks ${k}`);
    assert.ok(cmd.cli.flags.includes(kebab(k)), `weave formula check lacks --${kebab(k)}`);
  }
  assert.match(AGENTS, /scan/, 'AGENTS.md must say what scan returns');
});

test('every query option reaches every door', () => {
  const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  const sig = ENGINE.match(/\n  #queryIn\(dbRef, \{([^}]*)\}/)?.[1] ?? '';
  const options = sig.split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
  assert.ok(options.includes('fields') && options.includes('relations'), `the engine takes fields and relations: ${options.join(', ')}`);
  const tool = TOOLS.find((t) => t.name === 'weave_query');
  const REG = readFileSync(join(ROOT, 'src/commands.js'), 'utf8');
  const mcpBlock = REG.slice(REG.indexOf('const queryOptions'), REG.indexOf('const queryOptions') + 600);
  const cmd = COMMANDS.find((c) => c.name === 'entity.query');
  const cliBlock = String(cmd.cli.args);
  const CLI_EXEMPT = { includeDeleted: 'weave trash', trashCount: 'weave trash' };
  for (const k of options) {
    assert.ok(tool.inputSchema.properties[k], `weave_query schema lacks ${k}`);
    assert.ok(mcpBlock.includes(`a.${k}`), `weave_query drops ${k}`);
    if (!CLI_EXEMPT[k]) assert.ok(cliBlock.includes(`${k}:`), `weave query lacks --${k}`);
  }
  assert.match(CLI, /--fields 'A,B'\] \[--relations chip\]/, 'the usage names the two flags');
  assert.match(String(cmd.http.args), /options: \{ \.\.\.body, limit:/, 'POST /api/tables/:ref/query passes its body through');
  assert.match(String(cmd.run), /viewerZone: ctx\?\.viewerZone, workspace: ctx\?\.workspace/, 'the query runs in the caller\'s zone, scoped to the asking workspace (Issue #875)');
  assert.match(ROUTES, /workspace: member\.state\.meta\.id/, 'the HTTP door names the asking workspace (Issue #875)');
  assert.match(String(cmd.http.args), /body\?\.limit == null \? QUERY_PAGE : boundedLimit\(body\.limit\)/, 'a query body that names no limit gets the default page, not the whole table (Issue #1267)');
});

test('every door emits the one permalink a row has, and no door builds its own (Feature #203)', async () => {
  const dir = tempDir('weave-permalink-');
  const data = join(dir, 'uno.db');
  const w = new Weave({ path: data, name: 'uno' });
  w.createSpace({ name: 'Ops' });
  const table = w.createTable({ space: 'Ops', name: 'Task' });
  const row = w.createEntity('Task', { Name: 'ship the zebrafinch' });
  const link = w.permalink('entity', row.id);
  assert.equal(link, `/e/${row.id}`);
  assert.equal(w.permalink('table', table.id), `/t/${table.id}`);
  const space = w.getSpace('Ops');
  assert.equal(w.permalink('space', space.id), `/s/${space.id}`);

  const rpc = (name, args) => {
    const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const text = unwrapData(res.result.content[0].text);
    assert.ok(!res.result.isError, `${name}: ${text}`);
    return JSON.parse(text);
  };
  const docs = new Weave({ name: 'weave' });
  seedWeaver(docs);
  const { server } = await startServer(new Weave({ name: 'main' }), { port: 0, workspaces: { uno: w, weave: docs } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (method, path, body) => (await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  try {
    const schema = w.describeSchema().find((x) => x.spaceId === space.id);
    const emitted = {
      'engine readEntity': w.readEntity(row.id).url,
      'engine query row': w.query('Task', {}).items[0].url,
      'engine query picked row': w.query('Task', { fields: ['Name'] }).items[0].url,
      'chip': w.renderView(row.id, 'chip').url,
      'card': w.renderView(row.id, 'card').url,
      'engine search': w.search('zebrafinch')[0].url,
      'universal search': w.universalSearch('zebrafinch').find((h) => h.kind === 'entity').url,
      'scoped search': w.universalSearch('', { tables: ['Task'] })[0].url,
      'GET /api/entities/:id': (await http('GET', `/w/uno/api/entities/${row.id}`)).url,
      'GET /api/search': (await http('GET', '/w/uno/api/search?q=zebrafinch')).find((h) => h.kind === 'entity').url,
      'GET /api/search?all (the parameter is ignored, Issue #1308)': (await http('GET', '/w/uno/api/search?all=1&q=zebrafinch')).find((h) => h.kind === 'entity').url,
      'MCP weave_get_entity': rpc('weave_get_entity', { entity: row.id }).url,
      'MCP weave_update_entity': rpc('weave_update_entity', { entity: row.id, values: { Name: 'ship the zebrafinch' }, verbose: true }).url,
      'MCP weave_search': rpc('weave_search', { query: 'zebrafinch' }).find((h) => h.kind === 'entity').url,
    };
    for (const [door, url] of Object.entries(emitted)) assert.equal(url, link, `${door} emits the row permalink`);

    const posted = await http('POST', '/w/uno/api/tables/Task/entities', { name: 'posted' });
    assert.equal(posted.url, w.permalink('entity', posted.id), 'POST /api/tables/:t/entities');
    const made = rpc('weave_create_entity', { db: 'Task', name: 'made', verbose: true });
    assert.equal(made.url, w.permalink('entity', made.id), 'MCP weave_create_entity');
    const filed = await http('POST', '/api/bug-report', { categories: ['slow'], note: 'permalink door', events: [], client: { url: '/', route: '/', viewport: '1x1', ua: 'test' } });
    assert.equal(filed.url, docs.permalink('entity', filed.id), 'bug reporter');

    assert.equal(w.universalSearch('Task').find((h) => h.kind === 'table').url, w.permalink('table', table.id));
    assert.equal(w.universalSearch('Ops').find((h) => h.kind === 'space').url, w.permalink('space', space.id));
    assert.equal(schema.url, w.permalink('space', space.id), 'describeSchema space');
    assert.equal(schema.tables.find((t) => t.id === table.id).url, w.permalink('table', table.id), 'describeSchema table');
  } finally {
    server.close();
  }
  try {
    const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', join(ROOT, 'bin/weave.js'), ...args, '--data', data], { encoding: 'utf8' }));
    assert.equal(cli('get', row.id).url, link, 'CLI get');
    assert.equal(cli('get', link).url, link, 'CLI get takes the permalink it printed');
    assert.equal(cli('update', row.id, '--values', '{"Name":"ship the zebrafinch"}').url, link, 'CLI update');
    assert.equal(cli('search', 'zebrafinch')[0].url, link, 'CLI search');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const emitterSources = ['src/engine.js', 'src/forms.js', 'src/mcp.js', 'bin/weave.js'];
  for (const file of emitterSources) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.doesNotMatch(src, /url:\s*`[^`]*\/(?:e|t|s|#\/entity|#\/table|#\/space|#\/view)\/\$\{/, `${file} builds a row, table, space or view url by hand; emit permalink(kind, id)`);
  }
});
