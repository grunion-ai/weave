import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('a workspace named by its own slug keeps no separate title', () => {
  const w = new Weave();
  w.updateWorkspace({ name: 'sales-team' });
  assert.equal(w.getWorkspace().name, 'sales-team');
  assert.equal(w.state.meta.title, undefined);
  assert.equal(w.getWorkspace().title, 'sales-team');
});

test('a display name that differs from its slug is kept as the title', () => {
  const w = new Weave();
  w.updateWorkspace({ name: 'Sales Team' });
  assert.equal(w.getWorkspace().name, 'sales-team');
  assert.equal(w.state.meta.title, 'Sales Team');
  assert.equal(w.getWorkspace().title, 'Sales Team');
});

test('renaming a titled workspace to its bare slug drops the old title', () => {
  const w = new Weave();
  w.updateWorkspace({ name: 'Sales Team' });
  w.updateWorkspace({ name: 'crew' });
  assert.equal(w.getWorkspace().name, 'crew');
  assert.equal(w.state.meta.title, undefined);
  assert.equal(w.getWorkspace().title, 'crew');
});
