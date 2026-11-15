import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool, listTools } from '../src/mcp.js';
import { COMMANDS } from '../src/commands.js';
import { withServer } from './lib/fixtures.mjs';

const tool = (name) => listTools('all').find((t) => t.name === name);

test('weave_stats declares its table, by and field arguments as strings', () => {
  const { properties, required } = tool('weave_stats').inputSchema;
  for (const key of ['table', 'by', 'field']) assert.equal(properties[key].type, 'string', key);
  assert.deepEqual(required, ['table']);
});

test('weave_template_use declares its space, workspace and name arguments as strings', () => {
  const { properties, required } = tool('weave_template_use').inputSchema;
  for (const key of ['space', 'workspace', 'name']) assert.deepEqual(properties[key], { type: 'string' }, key);
  assert.deepEqual(required, ['space', 'workspace']);
});

test('a person invited through weave_create_entity gets a sign-in link that is the bare path when no origin is configured', () => {
  const saved = process.env.WEAVE_ORIGIN;
  delete process.env.WEAVE_ORIGIN;
  try {
    const w = new Weave({ actor: 'kyle' });
    w.inviteIssuer = 'https://idp.test';
    const { invite } = dispatchTool(w, 'weave_create_entity', { db: 'Users', values: { Email: 'ann@example.com' } });
    assert.match(invite.code, /^wvi_/);
    assert.equal(invite.url, `/api/auth/oidc/start?invite=${encodeURIComponent(invite.code)}`);
  } finally {
    if (saved !== undefined) process.env.WEAVE_ORIGIN = saved;
  }
});

test('a person invited by a caller that supplies no origin still gets the bare sign-in path', () => {
  const w = new Weave({ actor: 'kyle' });
  w.inviteIssuer = 'https://idp.test';
  const create = COMMANDS.find((c) => c.name === 'entity.create');
  const { invite } = create.run(w, { db: 'Users', input: { values: { Email: 'bo@example.com' } } }, {});
  assert.equal(invite.url, `/api/auth/oidc/start?invite=${encodeURIComponent(invite.code)}`);
});

test('weave_workspace update hands the link preview flag to the workspace update', () => {
  const w = new Weave();
  const patches = [];
  const caller = { role: 'architect', signedIn: true, tier: 'architect', updateWorkspace: (p) => { patches.push(p); return { ok: true }; } };
  dispatchTool(w, 'weave_workspace', { action: 'update', linkPreview: false, name: 'Docs' }, { caller });
  assert.deepEqual(patches, [{ name: 'Docs', linkPreview: false }]);
});

test('PUT /api/schema with no body is refused as an invalid document, never a server error', async () => {
  const w = new Weave();
  await withServer(w, async ({ base }) => {
    for (const body of [undefined, 'null']) {
      const r = await fetch(`${base}/api/schema`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
      assert.equal(r.status, 400, `body ${body}`);
      assert.equal((await r.json()).code, 'invalid');
    }
  });
});
