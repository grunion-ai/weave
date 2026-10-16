import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { TOOLS } from '../src/mcp.js';
import { startIdp, serveOidc } from './lib/idp.mjs';

const CHALLENGE = '/.well-known/openai-apps-challenge';

async function walled(options = {}) {
  const w = new Weave();
  w.createAccount({ name: 'root', role: 'architect' });
  w.setRequireAuth(true);
  return serveOidc(w, await startIdp(), { baseDomain: 'weave.test', origin: 'http://weave.test', ...options });
}

function withChallenge(value, fn) {
  const before = process.env.WEAVE_OPENAI_APPS_CHALLENGE;
  if (value == null) delete process.env.WEAVE_OPENAI_APPS_CHALLENGE; else process.env.WEAVE_OPENAI_APPS_CHALLENGE = value;
  return fn().finally(() => {
    if (before == null) delete process.env.WEAVE_OPENAI_APPS_CHALLENGE; else process.env.WEAVE_OPENAI_APPS_CHALLENGE = before;
  });
}

test('the wall still sends an anonymous visitor to sign in', async () => {
  const s = await walled();
  try {
    const res = await s.call('GET', '/index.html');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/auth\?next=/);
  } finally { s.stop(); }
});

test('an anonymous visitor reads /support with the contact address', async () => {
  const s = await walled();
  try {
    for (const method of ['GET', 'HEAD']) assert.equal((await s.call(method, '/support')).status, 200, `${method} /support`);
    const res = await s.call('GET', '/support');
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<h1>Support<\/h1>/);
    assert.ok(html.includes('<a href="mailto:weave@grunion.ai">weave@grunion.ai</a>'), 'support lacks the mailto link');
    assert.ok(html.includes('https://github.com/grunion-ai/weave/issues'), 'support lacks the issue tracker');
    assert.ok(html.includes('href="/docs"'), 'support links the agent setup docs');
  } finally { s.stop(); }
});

test('an anonymous visitor reads /docs: the MCP address and every tool with its hints', async () => {
  const s = await walled();
  try {
    const res = await s.call('GET', '/docs');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<h1>Connect an agent<\/h1>/);
    assert.ok(html.includes('http://weave.test/mcp'), 'docs name this host\'s MCP address');
    assert.ok(html.includes('href="/support"'), 'docs link support');
    for (const t of TOOLS) {
      const row = html.split('Tools</h2>')[1].split('<tr>').find((l) => l.includes(`<code>${t.name}</code>`));
      assert.ok(row, `docs list ${t.name}`);
      assert.ok(row.includes(t.annotations.title), `${t.name} row shows its title`);
      assert.equal(/Read-only/.test(row), t.annotations.readOnlyHint, `${t.name} row marks read-only`);
      assert.equal(/Destructive/.test(row), t.annotations.destructiveHint, `${t.name} row marks destructive`);
    }
  } finally { s.stop(); }
});

test('the challenge path answers the configured token as plain text', () => withChallenge('tok_abc123', async () => {
  const s = await walled();
  try {
    const res = await s.call('GET', CHALLENGE);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    assert.equal(await res.text(), 'tok_abc123');
  } finally { s.stop(); }
}));

test('the challenge path is a 404 when no token is configured', () => withChallenge(null, async () => {
  const s = await walled();
  try {
    assert.equal((await s.call('GET', CHALLENGE)).status, 404);
  } finally { s.stop(); }
}));

test('the new doors open nothing else: writes stay walled', () => withChallenge('tok_abc123', async () => {
  const s = await walled();
  try {
    for (const path of ['/support', '/docs', CHALLENGE]) {
      const res = await s.call('POST', path);
      assert.notEqual(res.status, 200, `POST ${path} answered 200`);
      assert.ok([302, 401, 404, 405].includes(res.status), `POST ${path} answered ${res.status}`);
    }
    assert.equal((await s.call('GET', '/api/tables')).status, 401);
    assert.equal((await s.call('GET', '/support.md')).status, 302);
  } finally { s.stop(); }
}));
