import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';

test('the seeded workspace hierarchy article explains the levels and the direction of travel', () => {
  const w = seedWeaver(new Weave());
  const row = Object.values(w.state.entities).find((e) => !e.deletedAt && w.entityName(e) === 'Workspace hierarchy');
  assert.ok(row, 'the Workspace hierarchy article is seeded');
  const doc = w.getDoc(row.id);
  assert.match(doc, /^# Hierarchy/);
  assert.match(doc, /Workspace → spaces → tables → entities/);
  assert.match(doc, /Multiple workspaces share one web app/);
  assert.match(doc, /agent-editable through the same primitives/);
});
