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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const DOCS = ['README.md', 'AGENTS.md', 'llms.txt', 'src/mcp-primer.md',
  ...readdirSync(join(ROOT, 'docs'), { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const WORDS = new Map(UNITS.map((w, i) => [w, i]));
TENS.forEach((t, i) => t && [t, ...UNITS.slice(1, 10).map((u) => `${t}-${u}`)].forEach((w, u) => WORDS.set(w, i * 10 + u)));
const number = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS.get(s.toLowerCase()));

const TOTAL = TOOLS.length;
const CORE = listTools('core').length;
const CLAIMS = [
  [/(?<!about )\b([\w-]+) (?:MCP )?tools\b(?! by default)/gi, TOTAL],
  [/\b([\w-]+) (?:MCP )?tools by default/gi, CORE],
  [/\b([\w-]+) listed by default/gi, CORE],
  [/\blists? all ([\w-]+)/gi, TOTAL],
  [/\breaches the other ([\w-]+)/gi, TOTAL - CORE],
  [/\b([\w-]+) field types\b/gi, FIELD_TYPES.length],
];
function countClaims(text) {
  const flat = text.replace(/\s+/g, ' ');
  return CLAIMS.flatMap(([re, want]) => [...flat.matchAll(re)]
    .map((m) => ({ phrase: m[0], said: number(m[1]), want }))
    .filter((c) => c.said !== undefined));
}
const codeHas = `src/mcp.js has ${TOTAL} tools, ${CORE} listed by default; src/engine.js has ${FIELD_TYPES.length} field types`;

test('every tool and field-type count in the docs is the count the code has', () => {
  let seen = 0;
  for (const file of DOCS) {
    for (const c of countClaims(read(file))) {
      seen++;
      assert.equal(c.said, c.want, `${file} says "${c.phrase}"; ${codeHas}`);
    }
  }
  assert.ok(seen >= 5, `only ${seen} counts found: the patterns no longer match the docs`);
});

test('every tool and field-type count in the Handbook is the count the code has (Issue #1246)', () => {
  for (const page of [...GUIDES, ...FIELD_DOCS]) {
    for (const c of countClaims(page.doc)) assert.equal(c.said, c.want, `Handbook "${page.name}" says "${c.phrase}"; ${codeHas}`);
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
  for (const shipped of ['Board / kanban', 'List view', 'Forms', 'Avatars/icons on entities']) {
    assert.equal(rows.find((r) => r.name === shipped)?.status, '✅', `${shipped} ships and must score ✅`);
  }
  for (const file of ['docs/PARITY.md', 'docs/comparison/fibery.md', 'docs/comparison/airtable.md']) {
    assert.doesNotMatch(read(file), /removed in Issue #75|board and list views were removed|list view was removed/i, `${file} calls a shipped layout removed`);
  }
  assert.doesNotMatch(parity, /JSON file per workspace|\b23 tools/, 'PARITY.md describes the v0.1 build');
});

const BOARD_LAYOUT = [
  'Board layout',
  'layout: table|list|board; a board takes groups: stacked|side, picture: off|small|medium|large (gallery: stacked + picture, kanban: side)',
  '[--layout table|list|board]',
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
  const help = execFileSync(process.execPath, [join(ROOT, 'bin/weave.js'), 'help'], { encoding: 'utf8' });
  assert.doesNotMatch(bare(help), offersBoard, 'weave help offers a board');
  for (const file of ['AGENTS.md', 'llms.txt']) assert.doesNotMatch(bare(read(file)), offersBoard, `${file} offers a board`);
});

test('a saved view refuses a view kind the UI does not draw', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  assert.throws(() => w.createView({ name: 'Monday', blocks: [{ table: 'Task', view: 'board' }] }), /board.*table/);
  assert.equal(w.createView({ name: 'Monday', blocks: [{ table: 'Task' }] }).blocks[0].view, 'table');
});
