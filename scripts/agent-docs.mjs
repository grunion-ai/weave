#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS, CORE_TOOLS, SUMMARY, primer } from '../src/mcp.js';

const AGENTS = fileURLToPath(new URL('../AGENTS.md', import.meta.url));

const JOBS = [
  ['Build', ['weave_build']],
  ['Read and search', ['weave_ontology', 'weave_schema', 'weave_query', 'weave_get_entity', 'weave_search']],
  ['Write rows', ['weave_create_entity', 'weave_update_entity', 'weave_import_csv']],
  ['Change schema', ['weave_create_space', 'weave_create_table', 'weave_add_field', 'weave_update_field', 'weave_add_relation', 'weave_workspace']],
  ['Look up allowed values', ['weave_vocabulary']],
  ['Everything else', ['weave_call']],
];

const AREAS = [
  ['Rows', ['weave_delete_entity', 'weave_restore_entity', 'weave_trash', 'weave_undo', 'weave_bulk', 'weave_set_state', 'weave_link', 'weave_unlink', 'weave_form_submit']],
  ['Documents and comments', ['weave_get_doc', 'weave_set_doc', 'weave_doc_revisions', 'weave_doc_restore', 'weave_add_comment', 'weave_delete_comment']],
  ['Spaces and tables', ['weave_update_space', 'weave_delete_space', 'weave_restore_space', 'weave_update_table', 'weave_move_table', 'weave_duplicate_table', 'weave_delete_table', 'weave_restore_table', 'weave_table_view']],
  ['Fields and formulas', ['weave_rollback_field', 'weave_delete_field', 'weave_check_formula']],
  ['Whole schema', ['weave_apply_schema', 'weave_registry', 'weave_relation_map']],
  ['Templates', ['weave_template_list', 'weave_template_use']],
  ['Figures', ['weave_stats']],
  ['Import and export', ['weave_export_csv', 'weave_export_json', 'weave_import_json']],
  ['Files', ['weave_attach_file', 'weave_files']],
  ['Automations', ['weave_create_automation', 'weave_automations']],
  ['Share pages', ['weave_views']],
  ['History', ['weave_activity', 'weave_audit']],
  ['Accounts and secrets', ['weave_accounts', 'weave_keys']],
];

function check(groups, want, what) {
  const placed = groups.flatMap(([, names]) => names);
  const missing = want.filter((n) => !placed.includes(n));
  const extra = placed.filter((n) => !want.includes(n));
  const twice = placed.filter((n, i) => placed.indexOf(n) !== i);
  if (missing.length || extra.length || twice.length) {
    throw new Error(`scripts/agent-docs.mjs ${what} is out of step with src/mcp.js: missing ${missing.join(', ') || 'none'}; unknown ${extra.join(', ') || 'none'}; twice ${twice.join(', ') || 'none'}`);
  }
}

export function renderBlocks() {
  const names = TOOLS.map((t) => t.name);
  const core = names.filter((n) => CORE_TOOLS.has(n));
  const rest = names.filter((n) => !CORE_TOOLS.has(n));
  check(JOBS, core, 'JOBS');
  check(AREAS, rest, 'AREAS');
  const line = (n) => {
    if (!SUMMARY[n]) throw new Error(`src/mcp.js SUMMARY has no line for ${n}`);
    return SUMMARY[n];
  };
  const text = primer();
  if (!text) throw new Error('src/mcp-primer.md is missing');
  const map = [
    `${core.length} listed by default, out of ${names.length}. \`weave mcp --tools all\` or \`WEAVE_MCP_TOOLS=all\` lists every one.`,
    '',
    '| Job | Tool | What it does |',
    '| --- | --- | --- |',
    ...JOBS.flatMap(([job, tools]) => tools.map((n, i) => `| ${i ? '' : job} | \`${n}\` | ${line(n)} |`)),
    '',
    `The other ${rest.length}, through \`weave_call {name, args}\`:`,
    '',
    '| Area | Tools |',
    '| --- | --- |',
    ...AREAS.map(([area, tools]) => `| ${area} | ${tools.map((n) => `\`${n}\``).join(', ')} |`),
    '',
  ].join('\n');
  return { primer: '```text\n' + text.trimEnd() + '\n```\n', 'tool-map': map };
}

export function applyBlocks(doc, blocks = renderBlocks()) {
  let out = doc;
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- ${name}:start[^>]*-->\\n)[\\s\\S]*?(<!-- ${name}:end -->)`);
    if (!re.test(out)) throw new Error(`AGENTS.md has no <!-- ${name}:start --> / <!-- ${name}:end --> markers`);
    out = out.replace(re, (_, start, end) => start + body + end);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = readFileSync(AGENTS, 'utf8');
  const next = applyBlocks(doc);
  if (process.argv.includes('--check')) {
    if (next !== doc) { console.error('AGENTS.md is stale: run node scripts/agent-docs.mjs'); process.exit(1); }
    console.log('AGENTS.md is current');
  } else if (next !== doc) {
    writeFileSync(AGENTS, next);
    console.log('AGENTS.md updated');
  } else {
    console.log('AGENTS.md already current');
  }
}
