/* An icon an agent guesses outside the inventory (Issue #591). The 2026-10-02
   agent eval had 17 refused writes for real Lucide names the curated set
   lacks (building-2, handshake, tags, repeat). The refusal said only "use
   lucide:<name> from the vocabulary", so the agent pulled the 4.4k-token
   list or dropped the icon. The refusal now names the nearest inventory
   icons, and the vocabulary searches icons on every door: MCP
   {section:"icons", query}, REST ?section=icons&query=, CLI `vocabulary
   icons <query>`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';
import { startServer } from '../src/server.js';
import { VOCABULARY, ICONS, nearestIcons, searchIcons } from '../src/vocabulary.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const category = (name) => globalThis.fieldDialogCore.categoryOf(`lucide:${name}`);
const call = (w, name, args) => dispatchTool(w, name, args ?? {});
const refusal = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected a refusal'); };

function workspace() {
  const w = new Weave();
  call(w, 'weave_create_space', { name: 'Ops' });
  call(w, 'weave_create_table', { space: 'Ops', name: 'Deal' });
  return w;
}

test('a guessed icon is refused with the nearest inventory names and their categories', () => {
  const w = workspace();
  // lucide:message is real Lucide; the inventory has message-circle and message-square.
  const e = refusal(() => call(w, 'weave_update_table', { db: 'Deal', icon: 'lucide:message' }));
  assert.match(e.message, /^Icon 'lucide:message' is not in the inventory; nearest: /);
  assert.match(e.message, /lucide:message-circle \(messages\)/, 'the nearest name carries its category');
  assert.match(e.message, /lucide:message-square \(messages\)/);
  assert.equal(e.code, 'invalid');
  assert.match(e.message, /weave_vocabulary \{section:"icons", query:/, 'and says where to search for more');
  const named = [...e.message.matchAll(/lucide:([a-z0-9-]+) \(/g)].map((m) => m[1]);
  assert.ok(named.length >= 1 && named.length <= 3, `up to three, got ${named.length}`);
  for (const n of named) assert.ok(ICONS.includes(n), `${n} is in the inventory, so the next write lands`);
});

test('the names the eval agents guessed each get a suggestion that is a real, writable icon', () => {
  const w = workspace();
  for (const guess of ['handshake', 'building-2', 'building', 'tags', 'tag', 'repeat']) {
    const e = refusal(() => call(w, 'weave_update_table', { db: 'Deal', icon: `lucide:${guess}` }));
    const named = [...e.message.matchAll(/lucide:([a-z0-9-]+) \(/g)].map((m) => m[1]);
    assert.ok(named.length >= 1, `${guess} gets at least one suggestion: ${e.message}`);
    assert.ok(named.length <= 3);
    // Taking the first suggestion writes.
    call(w, 'weave_update_table', { db: 'Deal', icon: `lucide:${named[0]}` });
    assert.equal(call(w, 'weave_schema').find((s) => s.space === 'Ops').tables[0].icon, `lucide:${named[0]}`);
  }
  // A guess that is in the inventory is not refused.
  call(w, 'weave_update_table', { db: 'Deal', icon: 'lucide:lightbulb' });
});

test('a bare name or an emoji is refused too; nothing close means no invented suggestion', () => {
  const w = workspace();
  assert.match(refusal(() => call(w, 'weave_update_table', { db: 'Deal', icon: 'message' })).message, /nearest: lucide:message-circle/);
  const far = refusal(() => call(w, 'weave_update_table', { db: 'Deal', icon: '🔥' }));
  assert.doesNotMatch(far.message, /nearest:/);
  assert.match(far.message, /weave_vocabulary \{section:"icons", query:/, 'it still says where to look');
});

test('nearestIcons ranks by name: exact stem first, then edit distance, at most the limit', () => {
  assert.deepEqual(nearestIcons('lucide:message', 2).map((m) => m.name), ['message-circle', 'message-square']);
  assert.deepEqual(nearestIcons('lucide:bell-dot').map((m) => m.name).slice(0, 2), ['bell', 'bell-ring']);
  assert.equal(nearestIcons('lucide:message', 3)[0].category, 'messages');
  assert.equal(nearestIcons('lucide:folder-open')[0].name, 'folder', 'the legacy alias word never outranks a whole-word match');
  assert.equal(nearestIcons('zzzzzzzz').length, 0);
  assert.equal(nearestIcons('').length, 0);
});

test('every synonym target is in the inventory', () => {
  for (const q of ['building', 'handshake', 'tag', 'tags', 'repeat', 'idea', 'office']) {
    for (const m of nearestIcons(q, 10)) assert.ok(ICONS.includes(m.name), `${q} → ${m.name}`);
    assert.ok(nearestIcons(q).length >= 1, `${q} has a suggestion`);
  }
});

test('weave_vocabulary with a section returns that section alone; with none it is unchanged', () => {
  const w = workspace();
  assert.deepEqual(call(w, 'weave_vocabulary'), VOCABULARY, 'no argument: the whole vocabulary, as before');
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'icons' }), VOCABULARY.icons);
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'optionColors' }), VOCABULARY.optionColors);
  const e = refusal(() => call(w, 'weave_vocabulary', { section: 'nope' }));
  assert.match(e.message, /Unknown vocabulary section 'nope' \(fieldTypes, optionColors, icons,/);
  assert.match(refusal(() => call(w, 'weave_vocabulary', { section: 'constructor' })).message, /Unknown vocabulary section 'constructor'/, 'a prototype name is not a section');
});

test('weave_vocabulary {section:"icons", query} searches the inventory by name, category and synonym', () => {
  const w = workspace();
  const r = call(w, 'weave_vocabulary', { section: 'icons', query: 'build' });
  assert.equal(r.query, 'build');
  assert.ok(r.matches.length >= 1 && r.matches.length <= 20);
  assert.ok(r.matches.some((m) => m.name === 'landmark'), 'building reaches the nearest real icon');
  for (const m of r.matches) { assert.ok(ICONS.includes(m.name)); assert.equal(m.category, category(m.name)); }
  assert.ok(JSON.stringify(r).length < 2000, 'a search costs a fraction of the 4.4k-token list');
  // A substring of the name, case-insensitive, with or without the prefix.
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'icons', query: 'LUCIDE:phone' }).matches.map((m) => m.name).sort(), ['phone', 'phone-call', 'phone-missed', 'phone-off']);
  // A category name lists its icons.
  assert.deepEqual(call(w, 'weave_vocabulary', { section: 'icons', query: 'time' }).matches.map((m) => m.name).sort(), ['calendar', 'calendar-range', 'clock', 'timer']);
  // A query alone means the icons section: an agent that forgets `section` still lands.
  assert.deepEqual(call(w, 'weave_vocabulary', { query: 'phone' }), call(w, 'weave_vocabulary', { section: 'icons', query: 'phone' }));
  // No substring hit falls back to the nearest names and says so.
  const fuzzy = call(w, 'weave_vocabulary', { section: 'icons', query: 'mesage' });
  assert.equal(fuzzy.fuzzy, true);
  assert.ok(fuzzy.matches.some((m) => m.name === 'message-circle'));
  // A query on another section is refused, naming where it works.
  assert.match(refusal(() => call(w, 'weave_vocabulary', { section: 'optionColors', query: 'x' })).message, /query searches the icons section/);
});

test('the MCP tool schema declares section and query', () => {
  const t = TOOLS.find((x) => x.name === 'weave_vocabulary');
  // sections (Issue #625) names several at once.
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['query', 'section', 'sections']);
  assert.match(t.description, /section/);
  assert.match(t.description, /query/);
});

test('REST: GET /api/vocabulary takes section and query', async () => {
  const { server } = await startServer(new Weave(), { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/api/vocabulary`;
  try {
    assert.deepEqual(await (await fetch(base)).json(), JSON.parse(JSON.stringify(VOCABULARY)), 'no parameter: unchanged');
    assert.deepEqual(await (await fetch(`${base}?section=icons`)).json(), JSON.parse(JSON.stringify(VOCABULARY.icons)));
    const hit = await (await fetch(`${base}?section=icons&query=build`)).json();
    assert.deepEqual(hit, JSON.parse(JSON.stringify(searchIcons('build'))));
    const bad = await fetch(`${base}?section=nope`);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Unknown vocabulary section 'nope'/);
  } finally { server.close(); }
});

test('CLI: weave vocabulary icons <query>', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-icon-search-'));
  const cli = (...args) => execFileSync('node', [BIN, '--data', join(dir, 'ws.db'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    assert.deepEqual(JSON.parse(cli('vocabulary', 'icons', 'build')), JSON.parse(JSON.stringify(searchIcons('build'))));
    assert.deepEqual(JSON.parse(cli('vocabulary', 'icons')), JSON.parse(JSON.stringify(VOCABULARY.icons)), 'section alone is unchanged');
    assert.ok(JSON.parse(cli('vocabulary')).fieldTypes, 'no argument is unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
