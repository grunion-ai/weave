import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/share-panel.js';
const core = globalThis.WeaveSharePanel;
test('share scope snapshots selection and otherwise uses the current container', () => {
  const selected = new Set(['a', 'b']);
  const scope = core.scope({ kind: 'table', id: 't', selected });
  selected.clear();
  assert.deepEqual(scope, { kind: 'entities', ids: ['a', 'b'] });
  assert.deepEqual(core.scope({ kind: 'table', id: 't' }), { kind: 'table', id: 't' });
  assert.deepEqual(core.scope({ kind: 'space', id: 's' }), { kind: 'space', id: 's' });
  assert.deepEqual(core.scope({ kind: 'workspace', id: 'w' }), { kind: 'workspace' });
});
test('custom expiration rejects invalid and past values and preserves never', () => {
  assert.deepEqual(core.expiration('never'), { expiry: 'never' });
  for (const v of ['1h','1d','7d','30d','90d']) assert.deepEqual(core.expiration(v), { expiry: v });
  assert.throws(() => core.expiration('custom', 'bad'), /future/);
  assert.throws(() => core.expiration('custom', '2020-01-01'), /future/);
  assert.deepEqual(core.expiration('custom', '2099-01-01T00:00:00Z'), { expiresAt: '2099-01-01T00:00:00.000Z' });
});
