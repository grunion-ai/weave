/* The agent surface contract: every capability the engine has is reachable
   from MCP and from the CLI, and named in the agent-facing docs.

   Kyle, 2026-08-24: "we need 100 percent cli mcp and documentation coverage
   with no human gates whatsoever." A gate is any capability an agent can only
   reach by driving the browser — or by knowing something no document says.
   The matrix below is the enforcement: a new engine method fails this suite
   until it is either surfaced on both doors and documented, or named internal
   with a reason. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { TOOLS } from '../src/mcp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = readFileSync(join(ROOT, 'bin/weave.js'), 'utf8');
const MCP = readFileSync(join(ROOT, 'src/mcp.js'), 'utf8');
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

/* capability: engine methods → the MCP tool that reaches them → the CLI
   command that reaches them. A CLI entry is "<command>" or "<command> <sub>". */
const SURFACE = [
  ['schema.describe', ['describeSchema'], 'weave_schema', 'schema'],
  ['schema.apply', ['applySchema'], 'weave_apply_schema', 'schema apply'],
  ['vocabulary', [], 'weave_vocabulary', 'vocabulary'],
  ['space.create', ['createSpace'], 'weave_create_space', 'space create'],
  ['space.list', ['listSpaces'], 'weave_schema', 'space'],
  ['space.update', ['updateSpace'], 'weave_update_space', 'space update'],
  ['space.delete', ['deleteSpace'], 'weave_delete_space', 'space delete'],
  ['space.restore', ['restoreSpace'], 'weave_restore_space', 'space restore'],
  ['table.create', ['createTable'], 'weave_create_table', 'table create'],
  ['table.list', ['listTables'], 'weave_schema', 'table'],
  ['table.update', ['updateTable'], 'weave_update_table', 'table update'],
  ['table.move', ['moveTable'], 'weave_move_table', 'table move'],
  ['table.duplicate', ['duplicateTable'], 'weave_duplicate_table', 'table duplicate'],
  ['table.delete', ['deleteTable'], 'weave_delete_table', 'table delete'],
  ['table.restore', ['restoreTable'], 'weave_restore_table', 'table restore'],
  ['field.add', ['addField', 'materializeField'], 'weave_add_field', 'field add'],
  ['field.update', ['updateField'], 'weave_update_field', 'field update'],
  ['field.delete', ['deleteField'], 'weave_delete_field', 'field delete'],
  ['relation.add', ['addRelation'], 'weave_add_relation', 'relation add'],
  ['formula.check', ['checkFormula'], 'weave_check_formula', 'formula check'],
  ['entity.create', ['createEntity'], 'weave_create_entity', 'create'],
  ['entity.read', ['readEntity', 'getEntity', 'query', 'listEntities'], 'weave_get_entity', 'get'],
  ['entity.query', ['query'], 'weave_query', 'query'],
  ['entity.update', ['updateEntity'], 'weave_update_entity', 'update'],
  ['entity.delete', ['deleteEntity'], 'weave_delete_entity', 'delete'],
  ['entity.restore', ['restoreEntity'], 'weave_restore_entity', 'restore'],
  ['entity.trash', ['listTrash'], 'weave_trash', 'trash'],
  ['entity.link', ['link'], 'weave_link', 'link'],
  ['entity.unlink', ['unlink'], 'weave_unlink', 'unlink'],
  ['entity.state', ['setState'], 'weave_set_state', 'state'],
  ['doc.read', ['getDoc'], 'weave_get_doc', 'doc'],
  ['doc.write', ['setDoc', 'appendDoc'], 'weave_set_doc', 'doc'],
  ['comment.add', ['addComment'], 'weave_add_comment', 'comment'],
  ['comment.delete', ['deleteComment'], 'weave_delete_comment', 'comment delete'],
  ['search', ['search', 'universalSearch'], 'weave_search', 'search'],
  ['undo', ['undo', 'listUndo'], 'weave_undo', 'undo'],
  ['csv.export', ['exportCSV'], 'weave_export_csv', 'csv'],
  ['csv.import', ['importCSV'], 'weave_import_csv', 'csv import'],
  ['json.export', ['exportJSON'], 'weave_export_json', 'export'],
  ['json.import', ['importJSON'], 'weave_import_json', 'import'],
  ['file.attach', ['attachFile', 'attachToField'], 'weave_attach_file', 'file attach'],
  ['file.read', ['readFile'], 'weave_files', 'file read'],
  ['file.delete', ['deleteFile'], 'weave_files', 'file delete'],
  ['view', ['createView', 'listViews', 'getView', 'deleteView', 'shareView', 'unshareView', 'resolveView'], 'weave_views', 'view'],
  ['automation.create', ['createAutomation'], 'weave_create_automation', 'automation create'],
  ['automation.manage', ['listAutomations', 'describeAutomations', 'updateAutomation', 'deleteAutomation'], 'weave_automations', 'automation'],
  ['activity', ['activityFeed', 'getActivity'], 'weave_activity', 'activity'],
  ['audit', ['listAudit'], 'weave_audit', 'audit'],
  ['workspace.record', ['getWorkspace', 'updateWorkspace'], 'weave_workspace', 'workspace'],
  ['workspace.logo', ['setWorkspaceLogo', 'getWorkspaceLogo', 'deleteWorkspaceLogo'], 'weave_workspace', 'workspace logo'],
  ['accounts', ['createAccount', 'listAccounts', 'deleteAccount', 'setRequireAuth'], 'weave_accounts', 'account'],
  ['keys', ['setKey', 'listKeys', 'deleteKey'], 'weave_keys', 'key'],
  /* Reveal has no MCP tool ON PURPOSE (Feature #143). A human asking for their
     own credential is the use case; an agent holding a token that can drain
     the keystore is the threat. The CLI and the HTTP surface carry it, both
     behind the credential's own access list, and both audited. */
  ['keys.reveal', ['revealKey', 'grantKey', 'revokeKey'], null, 'key reveal'],
  ['registry', ['registryReport', 'rebuildRegistry'], 'weave_registry', 'registry'],
  ['relation.map', ['relationMapMmd'], 'weave_relation_map', 'map'],
];

/* Methods that are not capabilities: resolvers an argument already covers,
   persistence, and the two that must never leave the process. */
const INTERNAL = {
  save: 'persistence', maybeRefresh: 'cross-process refresh',
  now: 'the engine clock — the short and relative date costumes and today()/now() defaults read it; a test pins it',
  findSpace: 'ref resolver', getSpace: 'ref resolver', findTable: 'ref resolver', getTable: 'ref resolver',
  findField: 'ref resolver', getField: 'ref resolver', findEntity: 'ref resolver', qualifiedName: 'ref formatter',
  entityName: 'ref formatter', documentFields: 'ref helper', resolveField: 'read helper',
  descriptionField: 'ref helper — which document a table calls its description, by role rather than by name',
  credentialConfig: 'read helper — a key field\'s config with the #143 defaults filled in',
  credentialLink: 'read helper — where a remote keystore keeps the credential',
  bodyBlocks: 'read helper — the resolved body order already ships inside the schema payload',
  viewByShareToken: 'the share link IS this call', verifyToken: 'auth path',
  hasKey: 'keystore predicate', resolveKey: 'returns a secret — never leaves the process',
  storageStats: 'read helper — /api/health already ships it for the nav stats strip',
  relationTargetDbIds: 'read helper — the tables a relation may point at; describeSchema already ships them',
  previewFields: 'read helper — the chip preview; /api/markdown ships it inside resolved mentions',
  viewField: 'ref helper — which field is a table\'s chip or card, by role rather than by name',
  renderView: 'read helper — one row as its chip or card; readEntity ships both under their field names and every relation summary carries the chip',
  referencesTo: 'read helper — GET /api/entities/:ref/references already serves the backlinks',
  referencesFrom: 'read helper — GET /api/entities/:ref/references-from serves the outbound mirror',
  termOf: 'read helper — what one row is called; describeSchema ships it as term on every table, and updateTable {noun} / the Name field\'s config.term set it',
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

/* Presence is not parity: a tool can name a capability and still leave half
   its arguments on the floor. `weave_create_table` took space, name and
   description while the engine's createTable also took an icon, so an agent
   creating a table could not give it one without a second call — a small gate,
   but a gate. The creates are checked against the engine's own signatures. */
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
  // The create call itself, not a neighbouring subcommand that happens to
  // mention an icon.
  assert.match(block('space'), /createSpace\(\{[^}]*icon/, 'weave space create passes --icon through');
  assert.match(block('table'), /createTable\(\{[^}]*icon/, 'weave table create passes --icon through');
});

test('every MCP tool is documented in AGENTS.md', () => {
  const undocumented = [...toolNames].filter((n) => !AGENTS.includes(n));
  assert.deepEqual(undocumented, [], `tools missing from AGENTS.md: ${undocumented.join(', ')}`);
});

test('every CLI command is documented in AGENTS.md', () => {
  const commands = [...new Set(SURFACE.map(([, , , cli]) => cli))];
  const undocumented = commands.filter((c) => !AGENTS.includes(`weave ${c}`));
  assert.deepEqual(undocumented, [], `CLI commands missing from AGENTS.md: ${undocumented.join(', ')}`);
});

test('the docs say the registry rows are schema writes', () => {
  // The gate that cost the most: an agent cannot discover this by reading the
  // tool list, because it is entity CRUD standing in for a schema verb.
  for (const [doc, name] of [[AGENTS, 'AGENTS.md'], [README, 'README.md']]) {
    assert.match(doc, /Workspace\/Fields/, `${name} must name the field registry`);
  }
  assert.match(AGENTS, /Definition/, 'AGENTS.md must name the Definition write');
  assert.match(AGENTS, /Field Order/, 'AGENTS.md must name the column-order write');
});

test('the one boundary an agent will hit is named, not left to be discovered', () => {
  // An MCP server is bound to one workspace file, so "make me another
  // workspace" has no tool. Saying how, in the document agents read first,
  // is the difference between a boundary and a gate.
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
  // It named 13 of 18 for months, so `document`, `field`, `key` and
  // `attachments` were invisible to every agent that read only the tools.
  const addField = TOOLS.find((t) => t.name === 'weave_add_field');
  assert.match(addField.description, /weave_vocabulary/,
    'the tool that takes a type must point at the list of types');
});
