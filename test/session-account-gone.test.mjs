import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('a session whose account no longer exists resolves to nobody instead of throwing', () => {
  const w = new Weave({ name: 'orphans' });
  w.createAccount({ name: 'kyle', role: 'editor' });
  w.createAccount({ name: 'eye', role: 'observer' });
  const gone = w.createSession('kyle');
  const kept = w.createSession('eye');
  const kyleId = Object.values(w.state.meta.accounts).find((a) => a.name === 'kyle').id;
  delete w.state.meta.accounts[kyleId];

  assert.equal(w.verifySession(gone.token), null);
  assert.equal(w.verifySession(kept.token)?.name, 'eye');
});
