import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

await import('../public/agent-connect-core.js');
const { TOOLS, SETUP_PROMPT, setupPrompt, guide, snippet, firstMessage } = globalThis.WeaveAgentConnect;
const PROMPT_SHA = '2b225c1d0b6f';
const URL_ = 'https://harbor.weave.grunion.ai/mcp';

test('catalog: Claude first, every agent has steps, a pitch, an icon and something to copy', () => {
  assert.deepEqual(TOOLS.map((t) => t.id), ['claude', 'chatgpt', 'gemini', 'claude-code', 'codex', 'antigravity', 'gemini-cli', 'other'], 'the chat apps, then the harnesses, then Something else (Issue #950)');
  assert.deepEqual(TOOLS.filter((t) => t.kind === 'chat').map((t) => t.name), ['Claude', 'ChatGPT', 'Gemini']);
  assert.deepEqual(TOOLS.filter((t) => t.kind === 'harness').map((t) => t.name), ['Claude Code', 'Codex', 'Antigravity', 'Gemini CLI']);
  assert.deepEqual([...new Set(TOOLS.map((t) => t.kind))], ['chat', 'harness', 'other'], 'no editor kind');
  for (const cut of ['cursor', 'vscode', 'perplexity', 'windsurf']) assert.equal(guide(cut, { url: URL_, workspace: 'h' }), null, `${cut} is not offered`);
  assert.ok(!/cursor|vscode|vs code/i.test(JSON.stringify(TOOLS)), 'nothing in the catalog names Cursor or VS Code');
  assert.equal(TOOLS.at(-1).id, 'other');
  for (const t of TOOLS) assert.ok(existsSync(new URL(`../public/vendor/icons/${t.icon.slice(7)}.svg`, import.meta.url)), `${t.id} icon is vendored`);
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length);
  for (const t of TOOLS) {
    assert.ok(t.steps.length >= 2, t.id);
    assert.ok(t.pitch && t.pitch.length <= 200, `${t.id} has a short pitch for the picker`);
    assert.match(t.icon, /^lucide:[a-z0-9-]+$/, t.id);
    assert.match(t.hue, /^#[0-9a-f]{6}$/, `${t.id} carries its tile colour as data`);
    assert.ok(guide(t.id, { url: URL_, workspace: 'harbor' }).value.includes(URL_), `${t.id} copies the address`);
    for (const line of [...t.steps, t.note ?? '', t.pitch]) {
      assert.ok(!/—|!|\bsimply\b|\bjust\b|\beasy\b/i.test(line), `${t.id}: ${line}`);
    }
  }
});

test('chat apps copy the bare address, Codex copies its add command, every other harness copies the tested setup prompt', () => {
  for (const id of ['claude', 'chatgpt', 'gemini']) assert.equal(guide(id, { url: URL_, workspace: 'h' }).value, URL_, id);
  assert.equal(guide('codex', { url: URL_, workspace: 'h' }).value, `codex mcp add weave-harbor --url ${URL_}`);
  for (const id of ['claude-code', 'antigravity', 'gemini-cli', 'other']) assert.equal(guide(id, { url: URL_, workspace: 'h' }).value, setupPrompt(URL_), id);
  assert.equal(snippet({ copy: 'command' }, URL_), `claude mcp add --transport http --scope user weave-harbor ${URL_}`);
});

test('plan limits are said plainly where a vendor gates custom MCP servers', () => {
  const note = (id) => TOOLS.find((t) => t.id === id).note;
  const pitch = (id) => TOOLS.find((t) => t.id === id).pitch;
  assert.match(note('chatgpt'), /Business, Enterprise or Edu/);
  assert.match(note('chatgpt'), /Pro reads only/);
  assert.match(note('chatgpt'), /Plus and Free cannot/);
  assert.match(note('gemini'), /Personal Google accounts only/);
  assert.match(note('gemini'), /Work and school accounts cannot/);
  assert.match(pitch('chatgpt'), /^Business, Enterprise or Edu\. Pro can only read\.$/, 'the ChatGPT tile names the plans that can connect');
  assert.match(pitch('gemini'), /^Personal Google accounts in the US only\.$/, 'the Gemini tile names the accounts that can connect');
  assert.match(pitch('claude'), /Any plan/);
  assert.match(TOOLS.find((t) => t.id === 'antigravity').steps.join(' '), /Authenticate/);
  assert.match(TOOLS.find((t) => t.id === 'codex').steps.join(' '), /codex mcp login weave/);
});

const words = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

test('the connect step reads short: a one-line tile pitch, steps of a dozen words, a note of twenty (Issue #954)', () => {
  for (const t of TOOLS) {
    assert.ok(words(t.pitch) <= 10, `${t.id} pitch: ${t.pitch}`);
    assert.ok(words(t.where) <= 5, `${t.id} where: ${t.where}`);
    assert.ok(t.steps.length <= 6, `${t.id} has at most six steps`);
    for (const step of t.steps) assert.ok(words(step) <= 12, `${t.id} step: ${step}`);
    if (t.note) assert.ok(words(t.note) <= 20, `${t.id} note: ${t.note}`);
    for (const line of [t.where, t.pitch, ...t.steps, t.note ?? '']) assert.ok(!/\u2014|\u2013/.test(line), `${t.id}: no em or en dash in ${line}`);
  }
  const all = TOOLS.reduce((n, t) => n + words(t.where) + words(t.pitch) + t.steps.reduce((m, x) => m + words(x), 0) + words(t.note), 0);
  assert.ok(all <= 370, `the catalog stays at 370 words or fewer, down from 608 (${all})`);
});

test('setup prompt: the text the eval tested, with only the address filled in', () => {
  const lines = SETUP_PROMPT.split('\n');
  assert.equal(lines[0], 'Connect yourself to my weave workspace.');
  assert.equal(lines.filter((l) => l.includes('{URL}')).length, 1);
  assert.equal(setupPrompt('https://weave.grunion.ai/mcp'), SETUP_PROMPT.replace('{URL}', 'https://weave.grunion.ai/mcp'));
  assert.match(setupPrompt(URL_), /Streamable HTTP/);
  assert.match(setupPrompt(URL_), /never ask me for a token or password/);
  assert.equal(createHash('sha256').update(SETUP_PROMPT).digest('hex').slice(0, 12), PROMPT_SHA, 'any edit voids the eval results (Feature #330): rerun the eval, then update this hash');
});

test('no install deeplinks: no agent carries one and the module exports none', () => {
  assert.equal(globalThis.WeaveAgentConnect.installLink, undefined);
  for (const t of TOOLS) {
    assert.equal(t.install, undefined, t.id);
    assert.equal(guide(t.id, { url: URL_, workspace: 'h' }).install, undefined, t.id);
  }
  assert.equal(guide('nope', { url: URL_, workspace: 'h' }), null);
  for (const file of ['agent-connect-core.js', 'start.js', 'start.html']) {
    assert.ok(!/cursor:\/\/|vscode:|['"]editor['"]|Editors and terminals|data-go['"]?: ?['"]install/.test(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')), `${file} keeps no Cursor or VS Code link, editor kind or install button`);
  }
});

test('first message: tailored to the template, the free-text answer, or an empty workspace', () => {
  assert.match(firstMessage({ workspace: 'harbor', template: 'Sales' }), /harbor workspace and walk me through the Sales tables/);
  assert.match(firstMessage({ workspace: 'harbor', other: 'dog adoptions' }), /for this: dog adoptions\. Propose the tables/);
  assert.match(firstMessage({ workspace: 'harbor' }), /Ask me what I want to track/);
  assert.match(firstMessage({ workspace: 'harbor', other: 'dog adoptions.' }), /for this: dog adoptions\. Propose/, 'no doubled full stop');
});
test('every named agent shows its own vendored logo mark; Something else keeps a glyph', () => {
  const expected = { claude: 'claude-color', chatgpt: 'openai', gemini: 'gemini-color', 'claude-code': 'claudecode-color', codex: 'codex-color', antigravity: 'antigravity-color', 'gemini-cli': 'geminicli-color' };
  assert.deepEqual(Object.fromEntries(TOOLS.filter((t) => t.logo).map((t) => [t.id, t.logo])), expected);
  assert.equal(TOOLS.find((t) => t.id === 'other').logo, undefined);
  for (const name of Object.values(expected)) {
    const file = new URL(`../public/vendor/brands/${name}.svg`, import.meta.url);
    assert.ok(existsSync(file), `${name} is vendored`);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /^<svg[\s>]/, `${name} is an svg`);
    assert.ok(!/<script|<!--|\son[a-z]+=|href=/i.test(svg), `${name} carries no script, comment, handler or link`);
  }
});


test('workspace connections keep distinct stable names across setup and authentication (Issue #1276)', () => {
  for (const workspace of ['harbor', 'bandito']) {
    for (const url of [`https://${workspace}.weave.grunion.ai/mcp`, `https://weave.grunion.ai/w/${workspace}/mcp`]) {
      const name = `weave-${workspace}`;
      const codex = guide('codex', { url, workspace: 'A display title' });
      assert.equal(codex.value, `codex mcp add ${name} --url ${url}`);
      assert.ok(codex.steps.includes(`Run codex mcp login ${name} and sign in.`));
      const claude = guide('claude-code', { url, workspace });
      assert.ok(claude.value.includes(`server named "${name}"`));
      assert.ok(claude.steps.includes(`Run /mcp, pick ${name}, choose Authenticate.`));
      assert.ok(guide('gemini-cli', { url, workspace }).steps.includes(`Run /mcp auth ${name} and sign in.`));
      assert.ok(guide('antigravity', { url, workspace }).steps.some((s) => s.includes(`next to ${name}.`)));
      assert.ok(guide('claude', { url, workspace }).steps.some((s) => s.startsWith(`Name it ${name},`)));
      assert.equal(snippet({ copy: 'command' }, url), `claude mcp add --transport http --scope user ${name} ${url}`);
    }
  }
  for (const url of ['https://weave.grunion.ai/mcp', 'https://dev.weave.grunion.ai/mcp', 'http://localhost:4400/mcp']) {
    const g = guide('codex', { url, workspace: 'Default' });
    assert.equal(g.value, `codex mcp add weave --url ${url}`);
    assert.ok(g.steps.includes('Run codex mcp login weave and sign in.'));
  }
  assert.ok(setupPrompt(URL_, 'my-server').includes('server named "my-server"'));
  assert.equal(snippet({ copy: 'codex' }, URL_, 'my-server'), `codex mcp add my-server --url ${URL_}`);
});
