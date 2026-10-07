import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { TOOLS, listTools } from '../src/mcp.js';

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
  ['view', ['createView', 'listViews', 'getView', 'deleteView', 'shareView', 'unshareView', 'resolveView'], 'weave_views', 'view', ['GET /api/views', 'POST /api/views', 'GET /api/views/:ref', 'DELETE /api/views/:ref', 'POST /api/views/:ref/share', 'DELETE /api/views/:ref/share']],
  ['automation.create', ['createAutomation'], 'weave_create_automation', 'automation create', ['POST /api/automations']],
  ['automation.manage', ['listAutomations', 'describeAutomations', 'updateAutomation', 'deleteAutomation'], 'weave_automations', 'automation', ['GET /api/automations', 'PATCH /api/automations/:ref', 'DELETE /api/automations/:ref']],
  ['activity', ['activityFeed', 'getActivity'], 'weave_activity', 'activity', ['GET /api/activity', 'GET /api/activity/:rest']],
  ['audit', ['listAudit'], 'weave_audit', 'audit', ['GET /api/audit']],
  ['workspace.record', ['getWorkspace', 'updateWorkspace'], 'weave_workspace', 'workspace', ['GET /api/workspace', 'PATCH /api/workspace']],
  ['workspace.logo', ['setWorkspaceLogo', 'getWorkspaceLogo', 'deleteWorkspaceLogo'], 'weave_workspace', 'workspace logo', ['GET /api/workspace/logo', 'PUT /api/workspace/logo', 'DELETE /api/workspace/logo']],
  ['accounts', ['createAccount', 'listAccounts', 'deleteAccount', 'setRequireAuth'], 'weave_accounts', 'account', ['GET /api/accounts', 'POST /api/accounts', 'DELETE /api/accounts/:rest']],
  ['auth.identities', ['linkIdentity', 'identityInvite', 'redeemIdentityInvite', 'unlinkIdentity', 'accountForIdentity'], 'weave_accounts', 'account link', ['GET /api/auth/oidc/start', 'GET /api/auth/oidc/callback']],
  ['auth.invites', ['inviteMember', 'listInvites', 'revokeInvite'], 'weave_accounts', 'invite', ['GET /api/invites', 'POST /api/invites', 'DELETE /api/invites/:ref']],
  ['auth.sessions', ['createSession', 'listSessions', 'revokeSession'], 'weave_accounts', 'account sessions', ['GET /api/auth/oidc/callback', 'POST /api/auth/logout', 'GET /api/auth/me', 'DELETE /api/auth/sessions/:ref']],
  ['keys', ['setKey', 'listKeys', 'deleteKey'], 'weave_keys', 'key', ['GET /api/keys', 'POST /api/keys', 'DELETE /api/keys/:rest']],
  ['keys.reveal', ['revealKey', 'grantKey', 'revokeKey'], null, 'key reveal', ['POST /api/keys/:ref/reveal', 'POST /api/keys/:ref/share', 'DELETE /api/keys/:ref/share']],
  ['registry', ['registryReport', 'rebuildRegistry'], 'weave_registry', 'registry', ['GET /api/registry', 'POST /api/registry/rebuild']],
  ['relation.map', ['relationMapMmd'], 'weave_relation_map', 'map', ['GET /api/relation-map.mmd']],
];

const INTERNAL = {
  save: 'persistence', maybeRefresh: 'cross-process refresh',
  settleDeferred: 'process plumbing (Feature #250): runDeferredMigrations settles each workspace a supervised worker opened while the old worker still served; an agent never calls it',
  userTables: 'read helper (Issue #386) — the tables a person made, registry excluded; the hub list\'s `tables` count reads it, and describeSchema already carries the `system` flag an agent filters on',
  schemaVersion: 'read helper (Issue #274) — the structure\'s fingerprint; every API response stamps it as X-Weave-Schema-Version and GET /api/workspace ships it in the body, so an agent reads it without a verb of its own',
  joinRegistry: 'hub plumbing (Feature #219) — the hub joins every member to the root registry on adoption',
  hostRegistry: 'hub plumbing (Feature #219) — the engine the hub stands on hosts the registry',
  syncRegistry: 'hub plumbing (Feature #219) — re-asserts a workspace\'s rows after a soft delete or restore; rebuildRegistry is the surfaced verb',
  dropWorkspace: 'hub plumbing (Feature #219) — a hard workspace delete drops its rows; DELETE /api/workspaces/:id is the door',
  now: 'the engine clock — the short and relative date costumes and today()/now() defaults read it; a test pins it',
  findSpace: 'ref resolver', getSpace: 'ref resolver', findTable: 'ref resolver', getTable: 'ref resolver',
  findField: 'ref resolver', getField: 'ref resolver', findEntity: 'ref resolver', qualifiedName: 'ref formatter',
  entityName: 'ref formatter', documentFields: 'ref helper', resolveField: 'read helper',
  descriptionField: 'ref helper — which document a table calls its description, by role rather than by name',
  credentialConfig: 'read helper — a key field\'s config with the #143 defaults filled in',
  credentialLink: 'read helper — where a remote keystore keeps the credential',
  bodyBlocks: 'read helper — the resolved body order already ships inside the schema payload',
  viewByShareToken: 'the share link IS this call', verifyToken: 'auth path',
  verifySession: 'auth path — the wv_session cookie IS this call (Feature #222 part 2)',
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
  affectedBy: 'read helper (Issue #257) — the rows a client must re-read after writing one; PATCH /api/entities/:ref ships it as `affected`',
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
      const block = CLI.slice(start, start + 2600);
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
    assert.match(doc, /Workspace\/Fields/, `${name} must name the field registry`);
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
  assert.match(ROUTES, /weave\.query\(m\[1\], \{ \.\.\.body, viewerZone \}\)/, 'POST /api/tables/:ref/query passes its body through');
});
