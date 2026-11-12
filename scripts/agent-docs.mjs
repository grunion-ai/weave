#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS, CORE_TOOLS, SUMMARY, primer } from '../src/mcp.js';
import { COMMANDS } from '../src/commands.js';
import { VOCABULARY } from '../src/vocabulary.js';
import { readLock } from './vendor-lock.mjs';

export const FILES = ['AGENTS.md', 'README.md'];

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
  ['Fields and formulas', ['weave_rollback_field', 'weave_delete_field', 'weave_restore_field', 'weave_check_formula']],
  ['Whole schema', ['weave_apply_schema', 'weave_registry', 'weave_relation_map']],
  ['Templates', ['weave_template_list', 'weave_template_use']],
  ['Figures', ['weave_stats']],
  ['Import and export', ['weave_export_csv', 'weave_export_json', 'weave_import_json']],
  ['Files', ['weave_attach_file', 'weave_files']],
  ['Automations', ['weave_create_automation', 'weave_automations', 'weave_runs']],
  ['Share pages and forms', ['weave_views', 'weave_shares', 'weave_forms']],
  ['History', ['weave_activity', 'weave_audit']],
  ['Accounts and secrets', ['weave_accounts', 'weave_keys']],
];

export const LIBRARIES = {
  mermaid: { title: 'mermaid', url: 'https://github.com/mermaid-js/mermaid', license: 'MIT © Knut Sveidqvist & contributors' },
  dompurify: { title: 'DOMPurify', url: 'https://github.com/cure53/DOMPurify', about: 'bundled inside mermaid', license: 'Apache-2.0 and MPL-2.0 © Cure53 and other contributors' },
  vditor: { title: 'Vditor', url: 'https://github.com/Vanessa219/vditor', about: 'pruned: only the assets weave loads', license: 'MIT © B3log' },
  katex: { title: 'KaTeX', url: 'https://github.com/KaTeX/KaTeX', about: 'js + css + woff2 fonts + mhchem, inside Vditor', license: 'MIT © Khan Academy & contributors' },
  'highlight.js': { title: 'highlight.js', url: 'https://github.com/highlightjs/highlight.js', about: 'inside Vditor', license: 'BSD-3-Clause © Ivan Sagalaev & contributors' },
  tabler: { title: '@tabler/core', url: 'https://github.com/tabler/tabler', license: 'MIT © Paweł Kuna & The Tabler Authors' },
  lucide: { title: 'Lucide', url: 'https://github.com/lucide-icons/lucide', about: 'icon shapes, with motion CSS from movingicons.dev under MIT', license: 'ISC © Lucide Contributors' },
  'dejavu-fonts': { title: 'DejaVu Sans', url: 'https://dejavu-fonts.github.io/', about: '`DejaVuSans.ttf`, PDF export Unicode fallback', license: 'Bitstream Vera license © Bitstream, Inc.; DejaVu changes public domain; Arev glyphs © Tavmjong Bah' },
  decklet: { title: 'decklet', url: 'https://github.com/grunion-ai/decklet', about: 'the slide engine, pinned by commit', license: 'MIT' },
  'lobehub-icons': { title: 'Lobe Icons', url: 'https://github.com/lobehub/lobe-icons', about: 'brand marks', license: 'MIT © LobeHub' },
};

const code = (v) => `\`${v}\``;
const codes = (values) => values.map(code).join(', ');

const VOCABULARY_ROWS = {
  icons: (v) => `${v.names.length} names, stored as ${code(v.form)} and searched with \`query\` by name, category and synonym; ${Object.keys(v.aliases).length} legacy \`iconly:<name>\` aliases; ${v.marks.length} mark characters that are their own value`,
  dateStyleNeeds: (v) => Object.entries(v).map(([format, parts]) => `${code(format)} needs ${codes(parts)}`).join('; '),
  columnWidth: (v) => `${v.min}px floor, ${v.unsetCap}px cap when unset; a set width is a floor as well as a ceiling`,
  fieldDescription: (v) => `${code(`config.${v.key}`)} on every field type but view: plain text the schema emits as the field's ${code(v.key)}`,
};

function vocabularyRow(key, value) {
  if (VOCABULARY_ROWS[key]) return VOCABULARY_ROWS[key](value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return codes(value.map((x) => (typeof x === 'string' ? x : x.type ?? x.name)));
  if (Object.values(value).every(Array.isArray)) return Object.entries(value).map(([k, v]) => `${code(k)}: ${codes(v)}`).join('; ');
  throw new Error(`scripts/agent-docs.mjs has no row for the vocabulary section ${key} in src/vocabulary.js`);
}

function check(groups, want, what, source = 'src/mcp.js') {
  const placed = groups.flatMap(([, names]) => names);
  const missing = want.filter((n) => !placed.includes(n));
  const extra = placed.filter((n) => !want.includes(n));
  const twice = placed.filter((n, i) => placed.indexOf(n) !== i);
  if (missing.length || extra.length || twice.length) {
    throw new Error(`scripts/agent-docs.mjs ${what} is out of step with ${source}: missing ${missing.join(', ') || 'none'}; unknown ${extra.join(', ') || 'none'}; twice ${twice.join(', ') || 'none'}`);
  }
}

function toolMap(names, core, rest) {
  const line = (n) => {
    if (!SUMMARY[n]) throw new Error(`src/mcp.js SUMMARY has no line for ${n}`);
    return SUMMARY[n];
  };
  return [
    `MCP server: ${names.length} tools, ${core.length} listed by default. \`weave mcp --tools all\` or \`WEAVE_MCP_TOOLS=all\` lists every one.`,
    '',
    '| Job | Tool | What it does |',
    '| --- | --- | --- |',
    ...JOBS.flatMap(([job, tools]) => tools.map((n, i) => `| ${i ? '' : job} | \`${n}\` | ${line(n)} |`)),
    '',
    `The other ${rest.length}, through \`weave_call {name, args}\`:`,
    '',
    '| Area | Tools |',
    '| --- | --- |',
    ...AREAS.map(([area, tools]) => `| ${area} | ${tools.map(code).join(', ')} |`),
    '',
  ].join('\n');
}

function cliMap(names) {
  const verbs = COMMANDS.filter((c) => c.cli && !c.cli.swap);
  const toolOf = (c) => c.tool?.name ?? c.via?.tool;
  const loose = verbs.filter((c) => !names.includes(toolOf(c)));
  if (loose.length) throw new Error(`src/commands.js CLI entries run no tool src/mcp.js lists: ${loose.map((c) => c.name).join(', ')}`);
  const verb = (c) => code(`weave ${c.cli.command}${c.cli.sub ? ` ${c.cli.sub}` : ''}`);
  const rows = [...JOBS, ...AREAS]
    .map(([area, tools]) => [area, tools.flatMap((t) => verbs.filter((c) => toolOf(c) === t).map(verb))])
    .filter(([, list]) => list.length);
  return ['| Area | Commands |', '| --- | --- |', ...rows.map(([area, list]) => `| ${area} | ${list.join(', ')} |`), ''].join('\n');
}

function vocabularyTable() {
  return ['| Section | Values |', '| --- | --- |', ...Object.entries(VOCABULARY).map(([key, value]) => `| ${code(key)} | ${vocabularyRow(key, value)} |`), ''].join('\n');
}

function thirdParty() {
  const { libraries } = readLock();
  check([['lock', Object.keys(LIBRARIES)]], libraries.map((l) => l.name), 'LIBRARIES', 'security/vendor.lock.json');
  return libraries.map((lib) => {
    const { title, url, about, license } = LIBRARIES[lib.name];
    const text = lib.files.find((f) => /LICEN[CS]E/i.test(f.path.split('/').pop()))?.path;
    const notes = [lib.version ? null : 'no version recorded', about].filter(Boolean).join('; ');
    return `- [${title}](${url})${lib.version ? ` ${lib.version}` : ''}${notes ? ` (${notes})` : ''}, ${license}${text ? ` (full text in \`${text}\`)` : ''}`;
  }).join('\n') + '\n';
}

export function renderBlocks(file = 'AGENTS.md') {
  if (file === 'README.md') return { 'third-party': thirdParty() };
  if (file !== 'AGENTS.md') throw new Error(`scripts/agent-docs.mjs writes ${FILES.join(' and ')}, not ${file}`);
  const names = TOOLS.map((t) => t.name);
  const core = names.filter((n) => CORE_TOOLS.has(n));
  const rest = names.filter((n) => !CORE_TOOLS.has(n));
  check(JOBS, core, 'JOBS');
  check(AREAS, rest, 'AREAS');
  const text = primer();
  if (!text) throw new Error('src/mcp-primer.md is missing');
  return {
    primer: '```text\n' + text.trimEnd() + '\n```\n',
    'tool-map': toolMap(names, core, rest),
    vocabulary: vocabularyTable(),
    'cli-map': cliMap(names),
  };
}

export function applyBlocks(doc, blocks = renderBlocks(), file = 'AGENTS.md') {
  let out = doc;
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- ${name}:start[^>]*-->\\n)[\\s\\S]*?(<!-- ${name}:end -->)`);
    if (!re.test(out)) throw new Error(`${file} has no <!-- ${name}:start --> / <!-- ${name}:end --> markers`);
    out = out.replace(re, (_, start, end) => start + body + end);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let stale = false;
  for (const file of FILES) {
    const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
    const doc = readFileSync(path, 'utf8');
    const next = applyBlocks(doc, renderBlocks(file), file);
    if (process.argv.includes('--check')) {
      if (next !== doc) { console.error(`${file} is stale: run node scripts/agent-docs.mjs`); stale = true; } else console.log(`${file} is current`);
    } else if (next !== doc) {
      writeFileSync(path, next);
      console.log(`${file} updated`);
    } else {
      console.log(`${file} already current`);
    }
  }
  if (stale) process.exit(1);
}
