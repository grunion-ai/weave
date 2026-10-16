import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

await import('../public/agent-connect-core.js');
const { TOOLS, guide, snippet, installLink, firstMessage } = globalThis.WeaveAgentConnect;
const URL_ = 'https://harbor.weave.grunion.ai/mcp';

test('catalog: chat apps come first, every tool has steps, an icon and something to copy', () => {
  assert.deepEqual(TOOLS.slice(0, 4).map((t) => t.kind), ['chat', 'chat', 'chat', 'chat'], 'people in a chat app see their tool first');
  assert.equal(TOOLS.at(-1).id, 'other');
  for (const t of TOOLS) assert.ok(existsSync(new URL(`../public/vendor/icons/${t.icon.slice(7)}.svg`, import.meta.url)), `${t.id} icon is vendored`);
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length);
  for (const t of TOOLS) {
    assert.ok(t.steps.length >= 2, t.id);
    assert.match(t.icon, /^lucide:[a-z0-9-]+$/, t.id);
    assert.match(t.hue, /^#[0-9a-f]{6}$/, `${t.id} carries its tile colour as data`);
    assert.ok(guide(t.id, { url: URL_, workspace: 'harbor' }).value.includes(URL_), `${t.id} copies the address`);
    for (const line of [...t.steps, t.note ?? '']) {
      assert.ok(!/—|!|\bsimply\b|\bjust\b|\beasy\b/i.test(line), `${t.id}: ${line}`);
    }
  }
});

test('chat apps copy the bare address; editors and terminals get their own config', () => {
  for (const id of ['claude', 'chatgpt', 'gemini', 'perplexity', 'other']) assert.equal(guide(id, { url: URL_, workspace: 'h' }).value, URL_, id);
  assert.equal(snippet(TOOLS.find((t) => t.id === 'claude-code'), URL_), `claude mcp add --transport http --scope user weave ${URL_}`);
  assert.deepEqual(JSON.parse(guide('cursor', { url: URL_, workspace: 'h' }).value), { mcpServers: { weave: { url: URL_ } } });
  assert.deepEqual(JSON.parse(guide('vscode', { url: URL_, workspace: 'h' }).value), { servers: { weave: { type: 'http', url: URL_ } } });
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
