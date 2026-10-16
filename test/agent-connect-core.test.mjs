import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

await import('../public/agent-connect-core.js');
const { TOOLS, SETUP_PROMPT, setupPrompt, guide, snippet, installLink, firstMessage } = globalThis.WeaveAgentConnect;
const PROMPT_SHA = '2b225c1d0b6f';
const URL_ = 'https://harbor.weave.grunion.ai/mcp';

test('catalog: Claude first, every agent has steps, a pitch, an icon and something to copy', () => {
  assert.deepEqual(TOOLS.map((t) => t.id), ['claude', 'claude-code', 'cursor', 'vscode', 'gemini-cli', 'other'], 'the agents the Haiku setup eval kept (Feature #330), the chat app first');
  for (const cut of ['chatgpt', 'gemini', 'perplexity', 'windsurf']) assert.equal(guide(cut, { url: URL_, workspace: 'h' }), null, `${cut} needs a business plan, an admin or a region most accounts lack`);
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

test('Claude copies the bare address; every other agent copies the tested setup prompt', () => {
  assert.equal(guide('claude', { url: URL_, workspace: 'h' }).value, URL_);
  for (const id of ['claude-code', 'cursor', 'vscode', 'gemini-cli', 'other']) assert.equal(guide(id, { url: URL_, workspace: 'h' }).value, setupPrompt(URL_), id);
  assert.equal(snippet({ copy: 'command' }, URL_), `claude mcp add --transport http --scope user weave ${URL_}`);
  assert.deepEqual(JSON.parse(snippet({ copy: 'cursor' }, URL_)), { mcpServers: { weave: { url: URL_ } } });
});

test('setup prompt: the text the eval tested, with only the address filled in', () => {
  const lines = SETUP_PROMPT.split('\n');
  assert.equal(lines[0], 'Connect yourself to my weave workspace.');
  assert.equal(lines.filter((l) => l.includes('{URL}')).length, 1);
  assert.equal(setupPrompt(URL_), SETUP_PROMPT.replace('{URL}', URL_));
  assert.match(setupPrompt(URL_), /Streamable HTTP/);
  assert.match(setupPrompt(URL_), /never ask me for a token or password/);
  assert.equal(createHash('sha256').update(SETUP_PROMPT).digest('hex').slice(0, 12), PROMPT_SHA, 'any edit voids the eval results (Feature #330): rerun the eval, then update this hash');
});

test('install links: Cursor base64 config, VS Code url-encoded JSON, none for chat apps', () => {
  const cursor = new URL(installLink(TOOLS.find((t) => t.id === 'cursor'), URL_));
  assert.equal(cursor.protocol, 'cursor:');
  assert.deepEqual(JSON.parse(Buffer.from(cursor.searchParams.get('config'), 'base64').toString()), { url: URL_ });
  const vs = installLink(TOOLS.find((t) => t.id === 'vscode'), URL_);
  assert.deepEqual(JSON.parse(decodeURIComponent(vs.slice('vscode:mcp/install?'.length))), { name: 'weave', type: 'http', url: URL_ });
  assert.equal(guide('claude', { url: URL_, workspace: 'h' }).install, null);
  assert.equal(guide('nope', { url: URL_, workspace: 'h' }), null);
});

test('first message: tailored to the template, the free-text answer, or an empty workspace', () => {
  assert.match(firstMessage({ workspace: 'harbor', template: 'Sales' }), /harbor workspace and walk me through the Sales tables/);
  assert.match(firstMessage({ workspace: 'harbor', other: 'dog adoptions' }), /for this: dog adoptions\. Propose the tables/);
  assert.match(firstMessage({ workspace: 'harbor' }), /Ask me what I want to track/);
  assert.match(firstMessage({ workspace: 'harbor', other: 'dog adoptions.' }), /for this: dog adoptions\. Propose/, 'no doubled full stop');
});
