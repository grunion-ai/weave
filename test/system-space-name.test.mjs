import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

const systemSpaces = (w) => Object.values(w.state.spaces).filter((s) => s.system === 'workspace');
const spacesRow = (w, id) => {
  const t = w.getTable('System/Spaces');
  return Object.values(w.state.entities).find((e) => e.dbId === t.id && e.sysId === id);
};

test('a new workspace names its system space System, with the gear, under the key workspace', () => {
  const w = new Weave();
  const [sys] = systemSpaces(w);
  assert.equal(systemSpaces(w).length, 1);
  assert.equal(sys.name, 'System');
  assert.equal(sys.system, 'workspace', 'the internal key stays workspace');
  assert.equal(sys.icon, 'lucide:settings');
  assert.equal(w.qualifiedName(w.getTable('System/Users')), 'System/Users');
});

test('opening a workspace stored with a Workspace space renames it System, once, and keeps its id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-system-space-'));
  try {
    const path = join(dir, 'old.db');
    const old = new Weave({ path });
    old.createSpace({ name: 'Product' });
    const [sys] = systemSpaces(old);
    sys.name = 'Workspace';
    delete sys.icon;
    old.save();
    old.store.close?.();

    const first = new Weave({ path });
    const [moved] = systemSpaces(first);
    assert.equal(systemSpaces(first).length, 1, 'no second system space');
    assert.equal(moved.id, sys.id, 'the same space, renamed');
    assert.equal(moved.name, 'System');
    assert.equal(moved.system, 'workspace');
    assert.equal(moved.icon, 'lucide:settings');
    assert.equal(first.entityName(spacesRow(first, moved.id)), 'System', 'its registry row follows');
    first.store.close?.();

    const second = new Weave({ path });
    const [again] = systemSpaces(second);
    assert.deepEqual([systemSpaces(second).length, again.id, again.name, again.icon], [1, sys.id, 'System', 'lucide:settings'], 'a second open changes nothing');
    assert.equal(second.listSpaces().filter((s) => s.name === 'System').length, 1);
    second.store.close?.();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the old Workspace/ names still find the system space and its tables', () => {
  const w = new Weave();
  assert.equal(w.getTable('Workspace/Users').id, w.getTable('System/Users').id);
  assert.equal(w.getTable('Workspace/Spaces').id, w.getTable('System/Spaces').id);
  assert.equal(w.getSpace('Workspace').id, w.getSpace('System').id);
  assert.equal(w.getSpace('Workspace').system, 'workspace');
});

test('a user space named Workspace wins its own name over the old alias', () => {
  const w = new Weave();
  const mine = w.createSpace({ name: 'Workspace' });
  const t = w.createTable({ space: 'Workspace', name: 'Users' });
  assert.equal(w.getSpace('Workspace').id, mine.id);
  assert.equal(w.getTable('Workspace/Users').id, t.id);
  assert.equal(w.getTable('System/Users').system, 'users');
});
