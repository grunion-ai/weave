import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { TOOLS, listTools, handleMcpMessage } from '../src/mcp.js';
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

const SURFACE = [
  ['schema.describe', ['describeSchema'], 'weave_schema', 'schema', ['GET /api/schema']],
  ['schema.apply', ['applySchema'], 'weave_apply_schema', 'schema apply', ['PUT /api/schema']],
  ['schema.ontology', ['ontology', 'spaceVersions'], 'weave_ontology', 'ontology', ['GET /api/ontology']],
  ['build', ['build'], 'weave_build', 'build', ['POST /api/build']],
  ['vocabulary', [], 'weave_vocabulary', 'vocabulary', ['GET /api/vocabulary']],
  ['space.create', ['createSpace'], 'weave_create_space', 'space create', ['POST /api/spaces']],
  ['space.list', ['listSpaces'], 'weave_schema', 'space', ['GET /api/spaces']],
  ['space.update', ['updateSpace'], 'weave_update_space', 'space update', ['PATCH /api/spaces/:ref']],
  ['space.delete', ['deleteSpace'], 'weave_delete_space', 'space delete', ['DELETE /api/spaces/:ref']],
  ['space.restore', ['restoreSpace'], 'weave_restore_space', 'space restore', ['POST /api/spaces/:ref/restore']],
  ['template.list', ['listTemplates'], 'weave_template_list', 'template list', ['GET /api/templates']],
  ['template.use', ['useTemplate'], 'weave_template_use', 'template use', ['POST /api/spaces/:ref/use']],
  ['table.create', ['createTable'], 'weave_create_table', 'table create', ['POST /api/tables']],
  ['table.list', ['listTables'], 'weave_schema', 'table', ['GET /api/tables']],
  ['table.update', ['updateTable'], 'weave_update_table', 'table update', ['PATCH /api/tables/:ref']],
  ['table.move', ['moveTable'], 'weave_move_table', 'table move', ['POST /api/tables/:ref/move']],
  ['table.duplicate', ['duplicateTable'], 'weave_duplicate_table', 'table duplicate', ['POST /api/tables/:ref/duplicate']],
  ['table.delete', ['deleteTable'], 'weave_delete_table', 'table delete', ['DELETE /api/tables/:ref']],
  ['table.restore', ['restoreTable'], 'weave_restore_table', 'table restore', ['POST /api/tables/:ref/restore']],
  ['table.view', ['tableView'], 'weave_table_view', 'table view', ['GET /api/tables/:ref/views', 'GET /api/tables/:ref/views/:ref', 'PATCH /api/tables/:ref/views/:ref', 'DELETE /api/tables/:ref/views/:ref']],
  ['field.add', ['addField', 'materializeField'], 'weave_add_field', 'field add', ['POST /api/tables/:ref/fields']],
  ['field.update', ['updateField'], 'weave_update_field', 'field update', ['PATCH /api/tables/:ref/fields/:ref']],
  ['field.delete', ['deleteField'], 'weave_delete_field', 'field delete', ['DELETE /api/tables/:ref/fields/:ref']],
  ['field.restore', ['restoreField'], 'weave_restore_field', 'field restore', ['POST /api/tables/:ref/fields/:ref/restore']],
  ['field.rollback', ['rollbackFieldConfig'], 'weave_rollback_field', 'field rollback', ['POST /api/tables/:ref/fields/:ref/rollback']],
  ['relation.add', ['addRelation'], 'weave_add_relation', 'relation add', ['POST /api/tables/:ref/relations']],
  ['formula.check', ['checkFormula'], 'weave_check_formula', 'formula check', ['POST /api/tables/:ref/formula-check']],
  ['entity.create', ['createEntity'], 'weave_create_entity', 'create', ['POST /api/tables/:ref/entities']],
  ['entity.read', ['readEntity', 'getEntity', 'query', 'listEntities'], 'weave_get_entity', 'get', ['GET /api/entities/:ref']],
  ['entity.query', ['query'], 'weave_query', 'query', ['POST /api/tables/:ref/query']],
  ['entity.update', ['updateEntity'], 'weave_update_entity', 'update', ['PATCH /api/entities/:ref']],
  ['entity.delete', ['deleteEntity'], 'weave_delete_entity', 'delete', ['DELETE /api/entities/:ref']],
  ['entity.restore', ['restoreEntity'], 'weave_restore_entity', 'restore', ['POST /api/entities/:ref/restore']],
  ['entity.trash', ['listTrash'], 'weave_trash', 'trash', ['GET /api/tables/:ref/trash', 'GET /api/trash']],
  ['table.stats', ['tableStats', 'tableRollups'], 'weave_stats', 'stats', ['GET /api/tables/:ref/stats']],
  ['entity.link', ['link'], 'weave_link', 'link', ['POST /api/entities/:ref/link']],
  ['entity.unlink', ['unlink'], 'weave_unlink', 'unlink', ['POST /api/entities/:ref/unlink']],
  ['entity.state', ['setState'], 'weave_set_state', 'state', ['POST /api/entities/:ref/state']],
  ['entity.bulk', ['bulk'], 'weave_bulk', 'bulk', ['POST /api/bulk']],
  ['doc.read', ['getDoc'], 'weave_get_doc', 'doc', ['GET /api/entities/:ref/doc']],
  ['doc.write', ['setDoc', 'appendDoc'], 'weave_set_doc', 'doc', ['PUT /api/entities/:ref/doc', 'POST /api/entities/:ref/doc']],
  ['doc.revisions', ['listDocRevisions', 'getDocRevision'], 'weave_doc_revisions', 'doc-revisions', ['GET /api/entities/:ref/doc/revisions', 'GET /api/entities/:ref/doc/revisions/:ref']],
  ['doc.restore', ['restoreDocRevision'], 'weave_doc_restore', 'doc-restore', ['POST /api/entities/:ref/doc/revisions/:ref/restore']],
  ['comment.add', ['addComment'], 'weave_add_comment', 'comment', ['POST /api/entities/:ref/comments']],
  ['comment.delete', ['deleteComment'], 'weave_delete_comment', 'comment delete', ['DELETE /api/entities/:ref/comments/:ref']],
  ['search', ['search', 'universalSearch'], 'weave_search', 'search', ['GET /api/search']],
  ['undo', ['undo', 'listUndo'], 'weave_undo', 'undo', ['GET /api/undo', 'POST /api/undo']],
  ['csv.export', ['exportCSV'], 'weave_export_csv', 'csv', ['GET /api/tables/:ref/export.csv']],
  ['csv.import', ['importCSV'], 'weave_import_csv', 'csv import', ['POST /api/tables/:ref/import.csv']],
  ['json.export', ['exportJSON'], 'weave_export_json', 'export', ['GET /api/export']],
  ['json.import', ['importJSON'], 'weave_import_json', 'import', ['POST /api/import']],
  ['file.attach', ['attachFile', 'attachToField'], 'weave_attach_file', 'file attach', ['POST /api/entities/:ref/files', 'POST /api/entities/:ref/fields/:ref/files']],
  ['file.read', ['readFile'], 'weave_files', 'file read', ['GET /api/files/:ref']],
  ['file.delete', ['deleteFile'], 'weave_files', 'file delete', ['DELETE /api/entities/:ref/files/:ref']],
  ['view', ['createView', 'listViews', 'getView', 'deleteView', 'restoreView', 'shareView', 'unshareView', 'resolveView'], 'weave_views', 'view', ['GET /api/views', 'POST /api/views', 'GET /api/views/:ref', 'DELETE /api/views/:ref', 'POST /api/views/:ref/restore', 'POST /api/views/:ref/share', 'DELETE /api/views/:ref/share']],
  ['share', ['mintShare', 'listShares', 'renewShare', 'revokeShare', 'updateShare', 'regenerateShare'], 'weave_shares', 'share', ['GET /api/shares', 'POST /api/shares', 'POST /api/shares/:ref/renew', 'PATCH /api/shares/:ref', 'POST /api/shares/:ref/regenerate', 'DELETE /api/shares/:ref', 'GET /api/share']],
  ['automation.create', ['createAutomation'], 'weave_create_automation', 'automation create', ['POST /api/automations']],
  ['automation.manage', ['listAutomations', 'describeAutomations', 'updateAutomation', 'deleteAutomation'], 'weave_automations', 'automation', ['GET /api/automations', 'PATCH /api/automations/:ref', 'DELETE /api/automations/:ref']],
  ['activity', ['activityFeed', 'getActivity'], 'weave_activity', 'activity', ['GET /api/activity', 'GET /api/activity/:rest']],
  ['audit', ['listAudit'], 'weave_audit', 'audit', ['GET /api/audit']],
  ['workspace.record', ['getWorkspace', 'updateWorkspace'], 'weave_workspace', 'workspace', ['GET /api/workspace', 'PATCH /api/workspace']],
  ['workspace.logo', ['setWorkspaceLogo', 'getWorkspaceLogo', 'deleteWorkspaceLogo'], 'weave_workspace', 'workspace logo', ['GET /api/workspace/logo', 'PUT /api/workspace/logo', 'DELETE /api/workspace/logo']],
  ['workspace.order', ['workspaceOrder', 'moveWorkspace'], 'weave_workspace', 'workspace order', ['GET /api/workspaces', 'PATCH /api/workspaces/:ref']],
  ['accounts', ['createAccount', 'listAccounts', 'setAccountRole', 'deleteAccount', 'setRequireAuth'], 'weave_accounts', 'account', ['GET /api/accounts', 'POST /api/accounts', 'PATCH /api/accounts/:ref', 'DELETE /api/accounts/:rest']],
  ['auth.identities', ['linkIdentity', 'identityInvite', 'redeemIdentityInvite', 'unlinkIdentity', 'accountForIdentity'], 'weave_accounts', 'account link', ['GET /api/auth/oidc/start', 'GET /api/auth/oidc/callback']],
  ['auth.invites', ['inviteMember', 'listInvites', 'revokeInvite'], 'weave_accounts', 'invite', ['GET /api/invites', 'POST /api/invites', 'DELETE /api/invites/:ref']],
  ['auth.sessions', ['createSession', 'listSessions', 'revokeSession'], 'weave_accounts', 'account sessions', ['GET /api/auth/oidc/callback', 'POST /api/auth/logout', 'GET /api/auth/me', 'DELETE /api/auth/sessions/:ref']],
  ['keys', ['setKey', 'listKeys', 'deleteKey'], 'weave_keys', 'key', ['GET /api/keys', 'POST /api/keys', 'DELETE /api/keys/:rest']],
  ['keys.reveal', ['revealKey', 'grantKey', 'revokeKey'], null, 'key reveal', ['POST /api/keys/:ref/reveal', 'POST /api/keys/:ref/share', 'DELETE /api/keys/:ref/share']],
  ['registry', ['registryReport', 'rebuildRegistry'], 'weave_registry', 'registry', ['GET /api/registry', 'POST /api/registry/rebuild']],
  ['relation.map', ['relationMapMmd'], 'weave_relation_map', 'map', ['GET /api/relation-map.mmd']],
];

const INTERNAL = {
  actorName: 'read helper (Issue #699): every read path renders a stored account:<id> actor as the account\'s current name before it answers, so an agent only ever sees names',
  isActor: 'permission helper (Issue #699): the comment check asks whether a stored actor, id or legacy name, is the caller; an agent never asks it',
  save: 'persistence', maybeRefresh: 'cross-process refresh',
  billing: 'read helper (Feature #256): the workspace\'s name, creation date and Clerk organization for src/billing.js; GET /api/billing is the door',
  linkBillingOrg: 'billing plumbing (Feature #256): POST /api/billing/team links the Clerk organization it creates; an agent never links one by hand',
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
  shareByToken: 'auth path (Feature #194): a /s/<token> link and an Authorization: Bearer wvs_ header ARE this call; GET /api/share answers what the token reaches',
  verifySession: 'auth path — the wv_session cookie IS this call (Feature #222 part 2)',
  removedSession: 'auth path (Feature #280) — the access-removed page reads it from a browser cookie; an agent holds no browser session',
  hasKey: 'keystore predicate', resolveKey: 'returns a secret — never leaves the process',
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
  affectedBy: 'read helper (Issue #257) — the rows a client must re-read after writing one; PATCH /api/entities/:ref ships it as `affected`',
  invitesForEmail: 'auth path (Feature #290) — the pending invites sent to the signed-in person\'s verified address; GET /api/start lists them as rows of kind "invite", and an agent holds no browser session',
  acceptInvite: 'auth path (Feature #290) — accepts one of those invites by its id through the same path as the link; POST /api/start/invites/:slug/:ref is the door',
  renameAccount: 'Users row door (Feature #318) — editing a Users row\'s Name renames the account; weave_update_entity is the tool',
  viewQuery: 'read helper (Issue #839): the where, sort and search one saved view applies; weave_query {view}, CLI query --view and POST /tables/:id/query {view} run it',
  permalink: 'link formatter (Feature #203): the one /w/<ws>/e/<uuid> path every door emits as `url`; the permalink gate below holds every emitter to it',
  takeOneTime: 'write plumbing (Feature #318) — the invite link or token a Users row create hands back once; every create door ships it beside the row',
  readFileStorage: 'browser bridge (Issue #1176): the app reads an HTML file\'s page storage over GET /api/files/:id/storage and seeds it into the ?view page; an agent reads the file itself with weave_files',
  writeFileStorage: 'browser bridge (Issue #1176): the app saves what a sandboxed HTML page wrote to localStorage over PUT /api/files/:id/storage; no agent writes a page\'s storage',
  runSchedules: 'process plumbing (Feature #312): the server\'s minute ticker fires every due schedule rule on each hub workspace; an agent writes the rule as a Workflows row and the clock does the rest',
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
    assert.match(MCP, new RegExp(`case '${tool}'`), `${tool} is listed but never dispatched`);
  }
});

test('every capability has a CLI command that exists', () => {
  for (const [capability, , , cli] of SURFACE) {
    const [command, sub] = cli.split(' ');
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
      const sigs = routeSignatures(entry);
      assert.ok(sigs.some((sig) => ROUTES.includes(sig)), `${capability}: routes.js has no ${entry} (looked for ${sigs.join(' or ')})`);
    }
  }
});

test('the key actions MCP offers are the CLI\'s minus reveal, and nothing else has drifted', () => {
  const cliList = CLI.match(/Unknown key subcommand '\$\{sub\}'\. Try: ([a-z, ]+)`/)[1].split(', ');
  const mcpList = MCP.match(/Unknown keys action '\$\{args\.action\}' \(([a-z, ]+)\)/)[1].split(', ');
  assert.deepEqual(new Set(mcpList), new Set(cliList.filter((a) => a !== 'reveal')),
    'the two advertised lists are hand-typed in two files; reveal is the only sanctioned difference (Feature #143)');
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
  const block = (cmd) => {
    const i = CLI.indexOf(`case '${cmd}'`);
    return CLI.slice(i, i + 2600);
  };
  assert.match(block('space'), /createSpace\(\{[^}]*icon/, 'weave space create passes --icon through');
  assert.match(block('table'), /createTable\(\{[^}]*icon/, 'weave table create passes --icon through');
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
  const commands = [...new Set(SURFACE.map(([, , , cli]) => cli))];
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
  const cliBlock = CLI.slice(CLI.indexOf("case 'formula'"), CLI.indexOf("case 'formula'") + 1200);
  const routeBlock = ROUTES.slice(ROUTES.indexOf('formula-check'), ROUTES.indexOf('formula-check') + 600);
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  for (const k of options) {
    assert.ok(tool.inputSchema.properties[k], `weave_check_formula schema lacks ${k}`);
    assert.ok(cliBlock.includes(`'${kebab(k)}'`) || cliBlock.includes(`flags.${k}`), `weave formula check lacks --${kebab(k)}`);
    assert.ok(routeBlock.includes(`body?.${k}`), `POST /api/tables/:ref/formula-check drops ${k}`);
  }
  assert.match(AGENTS, /scan/, 'AGENTS.md must say what scan returns');
});

test('every query option reaches every door', () => {
  const ENGINE = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  const sig = ENGINE.match(/\n  #queryIn\(dbRef, \{([^}]*)\}/)?.[1] ?? '';
  const options = sig.split(',').map((p) => p.trim().split(/[=\s]/)[0]).filter(Boolean);
  assert.ok(options.includes('fields') && options.includes('relations'), `the engine takes fields and relations: ${options.join(', ')}`);
  const tool = TOOLS.find((t) => t.name === 'weave_query');
  const mcpBlock = MCP.slice(MCP.indexOf("case 'weave_query'"), MCP.indexOf("case 'weave_query'") + 600);
  const cliBlock = CLI.slice(CLI.indexOf("case 'query'"), CLI.indexOf("case 'query'") + 900);
  const CLI_EXEMPT = { includeDeleted: 'weave trash', trashCount: 'weave trash' };
  for (const k of options) {
    assert.ok(tool.inputSchema.properties[k], `weave_query schema lacks ${k}`);
    assert.ok(mcpBlock.includes(`args.${k}`), `weave_query drops ${k}`);
    if (!CLI_EXEMPT[k]) assert.ok(cliBlock.includes(`${k}:`), `weave query lacks --${k}`);
  }
  assert.match(CLI, /--fields 'A,B'\] \[--relations chip\]/, 'the usage names the two flags');
  assert.match(ROUTES, /weave\.query\(m\[1\], \{ \.\.\.body, limit, viewerZone, workspace: member\.state\.meta\.id \}\)/, 'POST /api/tables/:ref/query passes its body through, scoped to the asking workspace (Issue #875)');
  assert.match(ROUTES, /const limit = body\?\.limit == null \? QUERY_PAGE : boundedLimit\(body\.limit\);/, 'a query body that names no limit gets the default page, not the whole table (Issue #1267)');
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
      'GET /api/search?all': (await http('GET', '/api/search?all=1&q=zebrafinch')).find((h) => h.kind === 'entity').url,
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
