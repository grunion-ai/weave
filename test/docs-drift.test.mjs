import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOOLS, listTools, primer } from '../src/mcp.js';
import { VOCABULARY } from '../src/vocabulary.js';
import { GUIDES, FIELD_DOCS } from '../src/handbook.js';
import { Weave, FIELD_TYPES } from '../src/engine.js';
import { renderBlocks, applyBlocks, FILES, LIBRARIES } from '../scripts/agent-docs.mjs';
import { readLock } from '../scripts/vendor-lock.mjs';

await import('../public/starter-core.js');
const STARTERS = globalThis.WeaveStarters;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const DOCS = ['README.md', 'AGENTS.md', 'llms.txt', 'src/mcp-primer.md',
  ...readdirSync(join(ROOT, 'docs'), { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
const ALL_DOCS = [...DOCS, 'CLAUDE.md', 'DEVELOPMENT.md', 'CONTRIBUTING.md', 'SECURITY.md'];
const HELP = execFileSync(process.execPath, [join(ROOT, 'bin/weave.js'), 'help'], { encoding: 'utf8' });

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const WORDS = new Map(UNITS.map((w, i) => [w, i]));
TENS.forEach((t, i) => t && [t, ...UNITS.slice(1, 10).map((u) => `${t}-${u}`)].forEach((w, u) => WORDS.set(w, i * 10 + u)));
const number = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS.get(s.toLowerCase()));

const TOTAL = TOOLS.length;
const CORE = listTools('core').length;
const sectionWords = (key) => key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
  .replace(/colors$/, 'colou?rs').replace(/ies$/, '(?:y|ies)').replace(/s$/, 's?');
const CLAIMS = [
  [/(?<!about )\b([\w-]+) (?:MCP )?tools\b(?! by default)/gi, TOTAL, 'src/mcp.js tools'],
  [/\b([\w-]+) (?:MCP )?tools by default/gi, CORE, 'src/mcp.js tools listed by default'],
  [/\b([\w-]+) listed by default/gi, CORE, 'src/mcp.js tools listed by default'],
  [/\blists ([\w-]+) by default/gi, CORE, 'src/mcp.js tools listed by default'],
  [/\blists? all ([\w-]+)/gi, TOTAL, 'src/mcp.js tools'],
  [/\b(?:reaches|runs) the other ([\w-]+)/gi, TOTAL - CORE, 'src/mcp.js tools outside the default list'],
  [/\b([\w-]+) field types\b/gi, FIELD_TYPES.length, 'src/engine.js FIELD_TYPES'],
  ...Object.entries(VOCABULARY).filter(([key, value]) => Array.isArray(value) && key !== 'fieldTypes')
    .map(([key, value]) => [new RegExp(`\\b([\\w-]+) ${sectionWords(key)}\\b`, 'gi'), value.length, `src/vocabulary.js ${key}`]),
  [/\b([\w-]+) icons\b/gi, VOCABULARY.icons.names.length, 'src/vocabulary.js icons.names'],
  [/\b([\w-]+) starter templates?\b/gi, STARTERS.TEMPLATES.length, 'public/starter-core.js TEMPLATES'],
  [/\btemplates? in ([\w-]+) categories\b/gi, STARTERS.CATEGORIES.length, 'public/starter-core.js CATEGORIES'],
];
function countClaims(text) {
  const flat = text.replace(/\s+/g, ' ');
  return CLAIMS.flatMap(([re, want, what]) => [...flat.matchAll(re)]
    .map((m) => ({ phrase: m[0], said: number(m[1]), want, what }))
    .filter((c) => c.said !== undefined));
}
const codeHas = (c) => `${c.what} has ${c.want}`;

test('a vocabulary count the docs state is read back and checked (Issue #1257)', () => {
  const kinds = countClaims(`weave_vocabulary returns the ${UNITS[VOCABULARY.viewKinds.length + 1]} view kinds`);
  assert.deepEqual(kinds.map((c) => [c.said, c.want]), [[VOCABULARY.viewKinds.length + 1, VOCABULARY.viewKinds.length]],
    'a wrong view-kind count in the docs passes the gate');
  const colors = countClaims(`the ${UNITS[VOCABULARY.optionColors.length - 1]} option colors`);
  assert.deepEqual(colors.map((c) => [c.said, c.want]), [[VOCABULARY.optionColors.length - 1, VOCABULARY.optionColors.length]],
    'a wrong option-color count in the docs passes the gate');
  assert.deepEqual(countClaims('the view kinds and the option colors'), [],
    'naming the sets without a number is read as a count claim');
});

test('a count of any closed set is read back from the code: every vocabulary section, the starter templates and their categories (Issue #1591)', () => {
  for (const [key, value] of Object.entries(VOCABULARY).filter(([, v]) => Array.isArray(v))) {
    const phrase = key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
    assert.deepEqual(countClaims(`weave has ${value.length + 1} ${phrase}`).map((c) => [c.said, c.want]), [[value.length + 1, value.length]],
      `a wrong count of the ${key} section passes the gate`);
  }
  assert.deepEqual(countClaims('Forty starter templates in twelve categories').map((c) => [c.said, c.want]),
    [[40, STARTERS.TEMPLATES.length], [12, STARTERS.CATEGORIES.length]], 'a wrong starter or category count passes the gate');
  assert.deepEqual(countClaims('It lists 18 by default and runs the other 50').map((c) => [c.said, c.want]),
    [[18, CORE], [50, TOTAL - CORE]], 'the README FAQ counts pass the gate unread');
});

test('every count the docs state is the count the code has', () => {
  let seen = 0;
  for (const file of DOCS) {
    for (const c of countClaims(read(file))) {
      seen++;
      assert.equal(c.said, c.want, `${file} says "${c.phrase}"; ${codeHas(c)}`);
    }
  }
  assert.ok(seen >= 5, `only ${seen} counts found: the patterns no longer match the docs`);
});

test('every count the Handbook states is the count the code has (Issue #1246)', () => {
  for (const page of [...GUIDES, ...FIELD_DOCS]) {
    for (const c of countClaims(page.doc)) assert.equal(c.said, c.want, `Handbook "${page.name}" says "${c.phrase}"; ${codeHas(c)}`);
  }
});

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const unknownTools = (text) => [...text.matchAll(/(?<!<)\bweave_[a-z_]+/g)].map(([name]) => name)
  .filter((name) => !TOOL_NAMES.has(name) && name !== 'weave_data');

const VERBS = new Map([['help', new Set()]]);
for (const [, command, rest] of HELP.split('\n').map((line) => line.match(/^ {2}([a-z][\w-]*)(.*)$/)).filter(Boolean)) {
  const subs = VERBS.get(command) ?? new Set();
  VERBS.set(command, subs);
  for (const token of rest.trim().split(/\s{2,}/)[0].split(/\s+/).filter(Boolean)) {
    if (/^\[?--/.test(token)) break;
    for (const word of token.replace(/[[\]]/g, '').split('|')) if (/^[a-z][a-z-]*$/.test(word)) subs.add(word);
  }
}
const unknownVerbs = (text) => [...text.matchAll(/`(?:node bin\/weave\.js|weave) ([a-z][\w-]*)(?=[\s`])(?: ([^`\s]+))?[^`]*`/g)]
  .filter(([, command, next]) => {
    const subs = VERBS.get(command);
    return !subs || Boolean(next && /^[a-z][a-z-]*$/.test(next) && subs.size && !subs.has(next));
  })
  .map(([span]) => span);

const LOCKED = readLock().libraries.filter((lib) => lib.version);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
function staleVersions(text) {
  const flat = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return LOCKED.flatMap((lib) => {
    const names = [...new Set([lib.name, lib.npm, LIBRARIES[lib.name]?.title].filter(Boolean))];
    const re = new RegExp(`(?<![\\w@/.-])(?:${names.map(escapeRe).join('|')})\\s+v?(\\d+(?:\\.\\d+)+(?:\\+[0-9a-f]+)?)`, 'gi');
    return [...flat.matchAll(re)]
      .filter(([, said]) => said !== lib.version && !lib.version.startsWith(`${said}+`))
      .map(([phrase]) => `"${phrase}" (security/vendor.lock.json pins ${lib.name} ${lib.version})`);
  });
}

const blockOf = (doc, name) => doc.match(new RegExp(`<!-- ${name}:start[^>]*-->\\n?([\\s\\S]*?)<!-- ${name}:end -->`))?.[1];

test('every block scripts/agent-docs.mjs generates is current in the doc that carries it (run node scripts/agent-docs.mjs)', () => {
  assert.ok(FILES.includes('AGENTS.md') && FILES.includes('README.md'), `scripts/agent-docs.mjs writes ${FILES.join(', ')}`);
  for (const file of FILES) {
    const doc = read(file);
    for (const name of Object.keys(renderBlocks(file))) assert.ok(blockOf(doc, name) !== undefined, `${file} has no ${name} block`);
    assert.equal(applyBlocks(doc, renderBlocks(file), file), doc, `${file} is stale: run node scripts/agent-docs.mjs`);
  }
  for (const name of ['tool-map', 'cli-map', 'vocabulary']) assert.ok(name in renderBlocks('AGENTS.md'), `AGENTS.md has no generated ${name}`);
  assert.ok('third-party' in renderBlocks('README.md'), 'README.md has no generated third-party list');
});

test('the drift gate fails when a doc names a tool, CLI verb, view kind, option colour, template count or vendored version the code does not have (Issues #1563, #1586, #1591)', () => {
  const doctored = [
    ['AGENTS.md', 'tool-map', '`weave_add_field`', '`weave_add_column`', 'a renamed tool'],
    ['AGENTS.md', 'cli-map', '`weave space create`', '`weave space make`', 'a renamed CLI verb'],
    ['AGENTS.md', 'vocabulary', '`viewKinds` | `table`', '`viewKinds` | `table`, `board`', 'a view kind the code lacks'],
    ['AGENTS.md', 'vocabulary', '`slate`, ', '', 'a missing option colour'],
    ['README.md', 'third-party', LOCKED.find((l) => l.name === 'mermaid').version, '11.4.1', 'a stale mermaid version'],
  ];
  for (const [file, name, from, to, what] of doctored) {
    const doc = read(file);
    const body = blockOf(doc, name);
    assert.ok(body?.includes(from), `${file} ${name} block no longer carries ${from}`);
    const edited = doc.replace(body, body.replace(from, to));
    assert.notEqual(applyBlocks(edited, renderBlocks(file), file), edited, `${what} in ${file} passes the gate`);
    assert.equal(applyBlocks(edited, renderBlocks(file), file), doc, `the generator does not restore ${file} after ${what}`);
  }
  assert.deepEqual(unknownTools('then call `weave_add_column`; replies come inside <weave_data>'), ['weave_add_column']);
  assert.deepEqual(unknownVerbs('run `weave space make Ops`, `weave frobnicate`, `weave space create Ops` and `weave restore <archive>`'),
    ['`weave space make Ops`', '`weave frobnicate`']);
  assert.deepEqual(staleVersions('[mermaid](https://github.com/mermaid-js/mermaid) 11.4.1 and KaTeX 0.18.11, Vditor 3.x'),
    [`"mermaid 11.4.1" (security/vendor.lock.json pins mermaid ${LOCKED.find((l) => l.name === 'mermaid').version})`]);
  assert.equal(countClaims('the two view kinds').length, 1, 'a view-kind count is not read');
});

test('every tool, CLI verb and vendored version a doc names outside the generated blocks is one the code has (Issues #1563, #1586)', () => {
  for (const file of ALL_DOCS) {
    const text = read(file);
    assert.deepEqual(unknownTools(text), [], `${file} names tools src/mcp.js does not register`);
    assert.deepEqual(unknownVerbs(text), [], `${file} names CLI verbs weave help does not list`);
    assert.deepEqual(staleVersions(text), [], `${file} names a vendored version security/vendor.lock.json does not pin`);
  }
  for (const page of [...GUIDES, ...FIELD_DOCS]) assert.deepEqual(unknownTools(page.doc), [], `Handbook "${page.name}" names tools src/mcp.js does not register`);
});

const PROBES = {
  "Icon 'lucide:dolar' is not in the inventory; nearest: lucide:dollar-sign (money)": (w) => w.createSpace({ name: 'Money', icon: 'lucide:dolar' }),
  'grain is a list of parts, e.g. ["year","month"] for a month or ["year"] for a year': (w) => w.addField('Deal', { name: 'Closed', type: 'date', config: { grain: 'month' } }),
  'Workspace names use lowercase letters, numbers and hyphens': (w) => w.updateWorkspace({ name: '!!!' }),
  "Field 'Stage' not found in table 'Deal'": (w) => w.createEntity('Deal', { Name: 'Acme renewal', Stage: 'Won' }),
  "Invalid number format 'currencyy' (number, currency, percent, compact)": (w) => w.addField('Deal', { name: 'Value', type: 'number', config: { format: 'currencyy' } }),
  "Field 'When' not found in table 'Transaction'. Sort reads 'Field asc|desc, Field2 asc|desc', e.g. 'Date desc'": (w) => {
    const [row] = w.query('System/Tables', { where: [['Name', '=', 'Transaction']] }).items;
    return w.updateEntity(row.id, { Sort: 'When desc' });
  },
  "Table 'Deals' not found": (w) => w.query('Deals'),
};

test('every error the AGENTS.md Pitfalls table quotes is the text the engine answers today (Issue #1563)', () => {
  const agents = read('AGENTS.md');
  const pitfalls = agents.slice(agents.indexOf('\n### Pitfalls\n'), agents.indexOf('\n## Reference\n'));
  const quoted = pitfalls.split('\n').map((line) => line.match(/^\| `([^`]+)`/)?.[1]).filter(Boolean).map((s) => s.replace(/\\\|/g, '|'));
  assert.ok(quoted.length >= 5, `only ${quoted.length} Pitfalls rows found: the table no longer parses`);
  assert.deepEqual(quoted.filter((error) => !PROBES[error]), [], 'a Pitfalls row has no probe here: add one that provokes the error it quotes');
  for (const error of quoted) {
    const w = new Weave();
    w.createSpace({ name: 'Pipeline' });
    w.createTable({ space: 'Pipeline', name: 'Deal' });
    w.createSpace({ name: 'Budget' });
    w.createTable({ space: 'Budget', name: 'Transaction' });
    assert.throws(() => PROBES[error](w), (err) => err.message.startsWith(error), `the engine no longer answers "${error}"`);
  }
});

test('a relation target takes every ref form the Refs note names, with no exception (Issue #1563)', () => {
  const note = read('AGENTS.md').split('**Refs are flexible.**')[1]?.split('\n- **')[0];
  assert.ok(note, 'AGENTS.md has no Refs are flexible note');
  assert.doesNotMatch(note, /exception/i, 'the note carves relation targets out again');
  const w = new Weave();
  w.createSpace({ name: 'Pipeline' });
  w.createTable({ space: 'Pipeline', name: 'Company' });
  w.createTable({ space: 'Pipeline', name: 'Deal' });
  w.addRelation('Deal', { name: 'Company', targetDb: 'Company', cardinality: 'many-to-one' });
  w.createEntity('Company', { Name: 'Initech' });
  const acme = w.createEntity('Company', { Name: 'Acme' });
  const forms = { UUID: acme.id, '`#12`': `#${acme.publicId}`, '`Table#12`': `Company#${acme.publicId}`, '`Space/Table#12`': `Pipeline/Company#${acme.publicId}` };
  for (const [form, ref] of Object.entries(forms)) {
    assert.ok(note.includes(form), `the note no longer names ${form}`);
    const made = w.createEntity('Deal', { Name: `made with ${form}`, Company: ref });
    assert.equal(w.readEntity(made.id).fields.Company?.id, acme.id, `a relation value written as ${form} does not link`);
    const linked = w.createEntity('Deal', { Name: `linked with ${form}` });
    w.link(linked.id, 'Company', [ref]);
    assert.equal(w.readEntity(linked.id).fields.Company?.id, acme.id, `link with a ${form} target does not link`);
  }
});

test('the Agent access guide walks the MCP primer path with the counts the code has (Issue #1246)', () => {
  const guide = GUIDES.find((g) => g.name === 'Agent access (MCP)');
  assert.ok(guide, 'GUIDES has no "Agent access (MCP)" page, so a Handbook sync never corrects the live row');
  assert.equal(guide.audience, 'Agent');
  const doc = guide.doc;
  const claims = countClaims(doc);
  assert.ok(claims.some((c) => c.want === CORE), 'the guide says how many tools are listed by default');
  assert.ok(claims.some((c) => c.want === FIELD_TYPES.length), 'the guide says how many field types there are');
  const path = ['weave_ontology', 'weave_build', 'weave_query', 'weave_search', 'weave_call'];
  const at = path.map((name) => doc.indexOf(`\`${name}\``));
  for (const [i, name] of path.entries()) assert.ok(at[i] >= 0, `the guide never names ${name}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, `the guide names ${path.join(', ')} out of the primer's order`);
  for (const step of ['dryRun', '{name: "help", args: {tool}}', 'lucide:<name>']) assert.ok(doc.includes(step), `the guide never says ${step}`);
  for (const name of ['weave_restore_field', 'weave_restore_table', 'weave_restore_space']) assert.ok(doc.includes(name), `the guide never names ${name}`);
  assert.doesNotMatch(doc, /not recoverable|stored as `iconly:/i);
  const tools = new Set(TOOLS.map((t) => t.name));
  for (const [name] of doc.matchAll(/(?<!<)\bweave_[a-z_]+/g)) assert.ok(tools.has(name), `the guide names ${name}, which src/mcp.js does not register`);
});

test('the docs state the auth model that ships', () => {
  for (const file of DOCS) {
    assert.doesNotMatch(read(file), /no (?:built-in )?authentication|absence of authentication|\bno accounts\b|admin of every workspace|Users & permissions \| \*\*None\*\*/i, `${file} says weave has no authentication or accounts`);
  }
  const readme = read('README.md');
  for (const word of ['require-auth', 'wv_', 'architect', 'editor', 'observer', 'OpenID Connect']) {
    assert.ok(readme.includes(word), `the README never names ${word}`);
  }
});

test('PARITY.md scores its own table and the build that ships', () => {
  const parity = read('docs/PARITY.md');
  const rows = [...parity.matchAll(/^\| (\d+) \| ([^|]+) \| (✅|🟡|❌) \|/gm)].map(([, n, name, status]) => ({ n: Number(n), name: name.trim(), status }));
  assert.deepEqual(rows.map((r) => r.n), rows.map((_, i) => i + 1), 'rows are numbered 1..n with no gaps');
  const full = rows.filter((r) => r.status === '✅').length;
  const partial = rows.filter((r) => r.status === '🟡').length;
  const pct = (((full + partial / 2) / rows.length) * 100).toFixed(1);
  assert.match(parity, new RegExp(`✅ full: \\*\\*${full}\\*\\*`), `the score names ${full} full rows`);
  assert.match(parity, new RegExp(`🟡 partial \\(×0\\.5\\): \\*\\*${partial}\\*\\*`), `the score names ${partial} partial rows`);
  assert.match(parity, new RegExp(`Total counted features: \\*\\*${rows.length}\\*\\*`), `the score counts ${rows.length} rows`);
  assert.ok(parity.includes(`= ${pct}%`), `the parity score is ${pct}%`);
  assert.ok(read('docs/comparison/fibery.md').includes(`**${pct}%**`), `docs/comparison/fibery.md quotes the ${pct}% score`);
  for (const shipped of ['Board / kanban', 'Forms', 'Avatars/icons on entities']) {
    assert.equal(rows.find((r) => r.name === shipped)?.status, '✅', `${shipped} ships and must score ✅`);
  }
  for (const file of ['docs/PARITY.md', 'docs/comparison/fibery.md', 'docs/comparison/airtable.md']) {
    assert.doesNotMatch(read(file), /removed in Issue #75|board and list views were removed|list view was removed/i, `${file} calls a shipped layout removed`);
  }
  assert.doesNotMatch(parity, /JSON file per workspace|\b23 tools/, 'PARITY.md describes the v0.1 build');
});

const BOARD_LAYOUT = [
  'Board layout',
  'layout: table|board; a board takes groups: stacked|side, picture: off|small|medium|large (gallery: stacked + picture, kanban: side)',
  '[--layout table|board]',
  '`layout` is `table` or `board`',
  '`public/board-core.js`',
  '`public/board-view.js`',
];
const offersBoard = /\bboards?\b/i;
const bare = (text) => BOARD_LAYOUT.reduce((t, ok) => t.split(ok).join(''), text);
test('no agent-facing string offers a board view kind; Board is only a table layout (Issue #75, Issue #438; Net Task #122)', () => {
  assert.deepEqual(VOCABULARY.viewKinds, ['table']);
  assert.match(bare('view: board'), offersBoard);
  assert.match(bare('kind: board'), offersBoard);
  assert.doesNotMatch(bare('Board layout'), offersBoard);
  const { icons, ...vocabulary } = VOCABULARY;
  assert.doesNotMatch(bare(JSON.stringify(vocabulary)), offersBoard, 'weave_vocabulary offers a board');
  for (const tool of TOOLS) assert.doesNotMatch(bare(JSON.stringify(tool)), offersBoard, `${tool.name} offers a board`);
  for (const g of [...GUIDES, ...FIELD_DOCS]) assert.doesNotMatch(bare(g.doc), offersBoard, `Handbook "${g.name}" offers a board`);
  assert.doesNotMatch(bare(primer()), offersBoard, 'the MCP primer offers a board');
  assert.doesNotMatch(bare(HELP), offersBoard, 'weave help offers a board');
  for (const file of ['AGENTS.md', 'llms.txt']) assert.doesNotMatch(bare(read(file)), offersBoard, `${file} offers a board`);
});

test('a saved view refuses a view kind the UI does not draw', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  assert.throws(() => w.createView({ name: 'Monday', blocks: [{ table: 'Task', view: 'board' }] }), /board.*table/);
  assert.equal(w.createView({ name: 'Monday', blocks: [{ table: 'Task' }] }).blocks[0].view, 'table');
});

test('every refusal SOUL.md quotes from the README is still a line the README carries (Issue #1145)', () => {
  const soul = read('SOUL.md');
  const refusals = soul.split('## Refusals')[1];
  assert.ok(refusals, 'SOUL.md has no Refusals section');
  const product = refusals.split('Refused in copy:')[0];
  assert.match(product, /from `README\.md` "What weave is not"/, 'the block still says where its quotes come from');
  const readme = read('README.md').replace(/\s+/g, ' ');
  let checked = 0;
  for (const line of product.split('\n').filter((l) => l.startsWith('- '))) {
    const elsewhere = [...line.matchAll(/`([A-Za-z0-9_/.-]+\.md)`/g)].map((m) => m[1]).filter((f) => f !== 'README.md');
    if (elsewhere.length) continue;
    for (const [, quote] of line.matchAll(/"([^"]{10,})"/g)) {
      checked++;
      assert.ok(readme.includes(quote.replace(/\s+/g, ' ')),
        `SOUL.md quotes "${quote}" as a product refusal, and README.md no longer says it`);
    }
  }
  assert.ok(checked >= 4, `only ${checked} refusal quotes found: the Refusals block no longer parses`);
});

test('SOUL.md does not refuse the marketplace weave ships through (Issue #1145)', () => {
  const soul = read('SOUL.md');
  assert.doesNotMatch(soul, /No marketplace\b/, 'SOUL.md still states a blanket no-marketplace refusal');
  assert.match(read('README.md'), /Claude Code plugin marketplace/, 'the README does distribute through one');
});

const SOURCED = /`([A-Za-z0-9_/.-]+\.(?:md|json))`/g;
const SOUL_QUOTE = /"([^"]{12,})"/g;
const plain = (text) => text.replace(/[`*]/g, '').replace(/\s+/g, ' ');

test("every quote in SOUL.md's sourced sections is a line the file it names carries (Issue #1350)", () => {
  const soul = read('SOUL.md');
  let checked = 0;
  for (const name of ['Purpose', 'Audience', 'Voice', 'Positioning']) {
    const body = soul.split(`## ${name}`)[1]?.split('\n## ')[0];
    assert.ok(body, `SOUL.md has no ${name} section`);
    for (const line of body.split('\n')) {
      const refs = [...line.matchAll(SOURCED)].map((m) => ({ at: m.index, file: m[1] }));
      if (!refs.length) continue;
      for (const match of line.matchAll(SOUL_QUOTE)) {
        const { file } = refs.find((r) => r.at > match.index) ?? refs[refs.length - 1];
        checked++;
        assert.ok(plain(read(file)).includes(plain(match[1])),
          `SOUL.md's ${name} section quotes "${match[1]}" from ${file}, and ${file} no longer says it`);
      }
    }
  }
  assert.ok(checked >= 17, `only ${checked} quotes found: SOUL.md's sourced sections no longer parse`);
});
