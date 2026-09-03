/* An icon value is enforced at the engine (Kyle, 2026-09-02: "I'm still
   finding emojis; this should not be possible"). A space, a table, a select
   option or a workflow state takes one of the inventory, a legacy alias that
   resolves, or a drawn mark — and refuses anything else, so no surface has
   to decide what to do with a value that is not an icon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const fresh = () => { const w = new Weave(); w.createSpace({ name: 'Ops' }); return w; };

test('the inventory, a legacy alias and a mark are accepted; an emoji or a typo is refused', () => {
  const w = fresh();
  const t = w.createTable({ space: 'Ops', name: 'Invoice', icon: 'lucide:wallet' });
  assert.equal(w.getTable(t.id).icon, 'lucide:wallet');
  w.updateTable(t.id, { icon: 'iconly:wallet' });
  assert.equal(w.getTable(t.id).icon, 'iconly:wallet', 'a legacy value that resolves is kept as stored');
  w.updateTable(t.id, { icon: '✓' });
  assert.equal(w.getTable(t.id).icon, '✓', 'a mark is its own value');
  w.updateTable(t.id, { icon: '' });
  assert.equal(w.getTable(t.id).icon, '', 'empty clears');
  for (const bad of ['🎉', '📦', 'lucide:not-a-real-icon', 'iconly:slides', 'wallet', 'B']) {
    assert.throws(() => w.updateTable(t.id, { icon: bad }), /not in the inventory/, `${bad} must be refused`);
  }
  assert.throws(() => w.createTable({ space: 'Ops', name: 'Party', icon: '🎉' }), /not in the inventory/);
});

test('a space refuses the same values', () => {
  const w = fresh();
  assert.throws(() => w.createSpace({ name: 'Fun', icon: '🎉' }), /not in the inventory/);
  w.updateSpace('Ops', { icon: 'lucide:briefcase' });
  assert.equal(w.getSpace('Ops').icon, 'lucide:briefcase');
  assert.throws(() => w.updateSpace('Ops', { icon: '🏢' }), /not in the inventory/);
});

test('select options and workflow states refuse them too', () => {
  const w = fresh();
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  assert.throws(() => w.addField(t, { name: 'Mood', type: 'select', config: { options: [{ name: 'Good', icon: '😀' }] } }), /not in the inventory/);
  w.addField(t, { name: 'Mood', type: 'select', config: { options: [{ name: 'Good', icon: 'lucide:star' }, { name: 'Bad', icon: '✕' }] } });
  assert.throws(() => w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Open', category: 'in-progress', icon: '🔥' }] } }), /not in the inventory/);
  w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Open', category: 'in-progress', icon: 'lucide:activity' }, { name: 'Done', category: 'done', icon: '✓' }] } });
});
