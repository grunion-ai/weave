/* The prose a reader meets before the code. Issue #593: the README gave three
   MCP tool counts and said weave had no authentication while Door C, wv_
   tokens and three roles shipped; PARITY.md still scored the v0.1 build.
   Issue #438: the board view went in Issue #75, but the vocabulary, the MCP
   description, the CLI help and the Handbook kept offering it. Each claim is
   held against the code here, so the next drift fails the suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOOLS, listTools, primer } from '../src/mcp.js';
import { VOCABULARY } from '../src/vocabulary.js';
import { GUIDES, FIELD_DOCS } from '../src/handbook.js';
import { Weave } from '../src/engine.js';

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

test('every tool count in the docs is the count src/mcp.js registers', () => {
  const total = TOOLS.length;
  const core = listTools('core').length;
  let seen = 0;
  for (const file of DOCS) {
    const text = read(file).replace(/\s+/g, ' ');
    const claims = [
      // "58 tools", "58 MCP tools"; "about twelve tools" is how many a build uses, not a count
      [/(?<!about )\b([\w-]+) (?:MCP )?tools\b(?! by default)/gi, total],
      [/\b([\w-]+) (?:MCP )?tools by default/gi, core],
      [/\b([\w-]+) listed by default/gi, core],
      [/\blists? all ([\w-]+)/gi, total],
      [/\breaches the other ([\w-]+)/gi, total - core],
    ];
    for (const [re, want] of claims) {
      for (const m of text.matchAll(re)) {
        const n = number(m[1]);
        if (n === undefined) continue;
        seen++;
        assert.equal(n, want, `${file} says "${m[0]}"; src/mcp.js has ${total} tools, ${core} listed by default`);
      }
    }
  }
  assert.ok(seen >= 5, `only ${seen} tool counts found: the patterns no longer match the docs`);
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
  for (const gone of ['Board / kanban', 'List view']) {
    assert.equal(rows.find((r) => r.name === gone)?.status, '❌', `${gone} was removed and must score ❌`);
  }
  assert.doesNotMatch(parity, /JSON file per workspace|\b23 tools/, 'PARITY.md describes the v0.1 build');
});

/* Every string an agent reads to decide what to build. */
const offersBoard = /\bboards?\b/i;
test('no agent-facing string offers the board view', () => {
  assert.deepEqual(VOCABULARY.viewKinds, ['table']);
  const { icons, ...vocabulary } = VOCABULARY;
  assert.doesNotMatch(JSON.stringify(vocabulary), offersBoard, 'weave_vocabulary offers a board');
  for (const tool of TOOLS) assert.doesNotMatch(JSON.stringify(tool), offersBoard, `${tool.name} offers a board`);
  for (const g of [...GUIDES, ...FIELD_DOCS]) assert.doesNotMatch(g.doc, offersBoard, `Handbook "${g.name}" offers a board`);
  assert.doesNotMatch(primer(), offersBoard, 'the MCP primer offers a board');
  const help = execFileSync(process.execPath, [join(ROOT, 'bin/weave.js'), 'help'], { encoding: 'utf8' });
  assert.doesNotMatch(help, offersBoard, 'weave help offers a board');
  for (const file of ['AGENTS.md', 'llms.txt']) assert.doesNotMatch(read(file), offersBoard, `${file} offers a board`);
});

test('a saved view refuses a view kind the UI does not draw', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  assert.throws(() => w.createView({ name: 'Monday', blocks: [{ table: 'Task', view: 'board' }] }), /board.*table/);
  assert.equal(w.createView({ name: 'Monday', blocks: [{ table: 'Task' }] }).blocks[0].view, 'table');
});
