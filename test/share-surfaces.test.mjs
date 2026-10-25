import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { tempDir } from './lib/temp.mjs';

test('MCP keeps grant identity while changing expiry and rotating access', () => {
  const w = new Weave();
  try {
    w.createSpace({ name: 'Dev' });
    const table = w.createTable({ space: 'Dev', name: 'Task' });
    const row = w.createEntity(table.id, { name: 'One' });
    const call = (args) => dispatchTool(w, 'weave_shares', args);
    const g = call({ action: 'mint', kind: 'entities', ids: [row.id], expiry: 'never' });
    assert.equal(g.expiresAt, null);
    assert.deepEqual(g.scope.ids, [row.id]);
    const edited = call({ action: 'update', share: g.id, expiry: '1h', label: 'Review' });
    assert.equal(edited.token, g.token);
    assert.ok(Date.parse(edited.expiresAt) > Date.now());
    const rotated = call({ action: 'regenerate', share: g.id, expiry: '90d' });
    assert.equal(rotated.id, g.id);
    assert.notEqual(rotated.token, g.token);
    assert.equal(w.shareByToken(g.token), null);
    call({ action: 'revoke', share: g.id });
    assert.equal(call({ action: 'list' }).shares.length, 0);
    assert.equal(call({ action: 'list', includeInactive: true }).shares[0].status, 'revoked');
  } finally { w.store.close(); }
});

test('CLI exposes Never, expiry updates, rotation and inactive links', () => {
  const data = join(tempDir('weave-share-surfaces-'), 'ws.db');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['bin/weave.js', '--data', data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  cli('space', 'create', 'Dev');
  cli('table', 'create', 'Dev', 'Task');
  const g = cli('share', 'mint', 'table', 'Dev/Task', '--expiry', 'never');
  assert.equal(g.expiresAt, null);
  const edited = cli('share', 'update', g.id, '--expiry', '7d', '--label', 'Review');
  assert.equal(edited.token, g.token);
  assert.equal(edited.label, 'Review');
  const rotated = cli('share', 'regenerate', g.id, '--expiry', '30d');
  assert.equal(rotated.id, g.id);
  assert.notEqual(rotated.token, g.token);
  cli('share', 'revoke', g.id);
  assert.equal(cli('share', 'list').length, 0);
  assert.equal(cli('share', 'list', '--include-inactive')[0].status, 'revoked');
});
