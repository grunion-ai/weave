/* Issue #467 (follow-up to #428): a field type change converts every stored
   value, and nothing kept the values from before, so its Activity entry was
   marked lossy and offered no Undo and no Roll back.

   Kyle's ruling, 2026-09-28: a type change must be undoable, values included.
   - The write path keeps each row's value from before the conversion (and
     the value the conversion made) with the field-config-updated entry, only
     for rows that held a value, once per type change.
   - Undo and Roll back restore the definition and every row that is
     unchanged since the conversion. A row edited since is left with its edit
     (converted back to the old type, never overwritten by the snapshot), and
     a row made since has no snapshot and is converted. The counts are in the
     answer and in the undo entry.
   - Growth: the audit log has no size policy, and the capped stores (doc
     revisions, activity, undo) cap by count per subject, which a whole
     column of values per entry does not fit. So a field keeps the snapshot of
     its newest type change only; an older entry says its values were dropped.
   - The snapshot never leaves the engine: the Activity feed carries only its
     row count, and the export does not carry the audit log. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

function workspace(opts = {}) {
  const w = new Weave(opts);
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  return { w, t };
}
const val = (w, id, name) => w.getEntity(id).values[w.getField(w.getEntity(id).dbId, name).id];
const newest = (w, t, kind = 'field-config-updated') => w.activityFeed({ entityId: t.id, kinds: [kind] }).items[0];

test('number to text and back restores the numbers', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'number' });
  const a = w.createEntity(t, { name: 'a', values: { Qty: 12.5 } });
  const b = w.createEntity(t, { name: 'b', values: { Qty: 3 } });
  const empty = w.createEntity(t, { name: 'empty' });
  w.updateField(t.id, f.id, { type: 'text' });
  assert.equal(val(w, a.id, 'Qty'), '12.5');
  const entry = newest(w, t);
  assert.equal(entry.detail.lossy, true, 'a type change is still marked as one');
  assert.deepEqual(entry.detail.snapshot, { rows: 2 }, 'only rows that held a value, and the feed carries the count only');
  assert.equal(w.getActivity(entry.id).rollback.ok, true, 'a type change now offers Roll back');
  const out = w.rollbackFieldConfig(entry.id, { via: 'undo' });
  assert.equal(w.getField(t.id, f.id).type, 'number');
  assert.equal(val(w, a.id, 'Qty'), 12.5, 'the exact number, not a reparse');
  assert.equal(val(w, b.id, 'Qty'), 3);
  assert.equal(val(w, empty.id, 'Qty') ?? null, null);
  assert.deepEqual({ restored: out.restored, left: out.left, converted: out.converted }, { restored: 2, left: 0, converted: 0 });
  const undo = w.getActivity(out.activity);
  assert.deepEqual([undo.detail.restored, undo.detail.left, undo.detail.converted], [2, 0, 0], 'the undo entry says so too');
});

test('select to text and back restores the option ids', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Tier', type: 'select', config: { options: [
    { id: 'gold-7', name: 'Gold', hue: 'amber' }, { id: 'lead-2', name: 'Lead', hue: 'slate' },
  ] } });
  const a = w.createEntity(t, { name: 'a', values: { Tier: 'Gold' } });
  const b = w.createEntity(t, { name: 'b', values: { Tier: 'Lead' } });
  w.updateField(t.id, f.id, { type: 'text' });
  assert.equal(val(w, a.id, 'Tier'), 'Gold');
  w.rollbackFieldConfig(newest(w, t).id);
  const back = w.getField(t.id, f.id);
  assert.equal(back.type, 'select');
  assert.deepEqual(back.config.options.map((o) => [o.id, o.hue]), [['gold-7', 'amber'], ['lead-2', 'slate']]);
  assert.equal(val(w, a.id, 'Tier'), 'gold-7');
  assert.equal(val(w, b.id, 'Tier'), 'lead-2');
});

test('a row edited after the change is left alone and counted', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'number' });
  const a = w.createEntity(t, { name: 'a', values: { Qty: 12 } });
  const b = w.createEntity(t, { name: 'b', values: { Qty: 4 } });
  w.updateField(t.id, f.id, { type: 'text' });
  w.updateEntity(a.id, { Qty: '15' });
  const out = w.rollbackFieldConfig(newest(w, t).id);
  assert.equal(val(w, a.id, 'Qty'), 15, 'the edit stands, in the old type; the snapshot did not overwrite it');
  assert.equal(val(w, b.id, 'Qty'), 4);
  assert.deepEqual([out.restored, out.left, out.converted], [1, 1, 0]);
});

test('a row created after the change is converted and counted', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'number' });
  w.createEntity(t, { name: 'a', values: { Qty: 1 } });
  w.updateField(t.id, f.id, { type: 'text' });
  const late = w.createEntity(t, { name: 'late', values: { Qty: '7' } });
  w.createEntity(t, { name: 'blank' });
  const out = w.rollbackFieldConfig(newest(w, t).id);
  assert.equal(val(w, late.id, 'Qty'), 7, 'converted by the same conversion a type change uses');
  assert.deepEqual([out.restored, out.left, out.converted], [1, 0, 1], 'a row with nothing in it is not counted');
});

test('a stale definition still refuses, values untouched', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'number' });
  const a = w.createEntity(t, { name: 'a', values: { Qty: 2 } });
  w.updateField(t.id, f.id, { type: 'text' });
  const entry = newest(w, t);
  w.updateField(t.id, f.id, { config: { description: 'now described' } });
  assert.throws(() => w.rollbackFieldConfig(entry.id), (err) => err.code === 'conflict' && /changed again/.test(err.message));
  assert.equal(w.getField(t.id, f.id).type, 'text');
  assert.equal(val(w, a.id, 'Qty'), '2');
});

test('a newer type change drops the older snapshot, and the older entry says so', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'number' });
  w.createEntity(t, { name: 'a', values: { Qty: 5 } });
  w.updateField(t.id, f.id, { type: 'text' });
  const first = newest(w, t);
  w.updateField(t.id, f.id, { type: 'number' });
  const second = newest(w, t);
  assert.notEqual(first.id, second.id);
  const old = w.getActivity(first.id);
  assert.equal(old.detail.snapshotDropped, true);
  assert.equal(old.detail.snapshot, undefined);
  assert.equal(old.rollback.ok, false);
  assert.match(old.rollback.reason, /no longer kept/, 'said plainly');
  assert.deepEqual(w.getActivity(second.id).detail.snapshot, { rows: 1 }, 'the newest keeps its values');
});

test('the undo of a type change keeps its own snapshot, so rolling it back redoes the change with values', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'text' });
  const a = w.createEntity(t, { name: 'a', values: { Qty: 'about 3' } });
  w.updateField(t.id, f.id, { type: 'number' });
  assert.equal(val(w, a.id, 'Qty') ?? null, null, 'text that is not a number converts to nothing');
  const out = w.rollbackFieldConfig(newest(w, t).id);
  assert.equal(val(w, a.id, 'Qty'), 'about 3', 'and comes back whole');
  w.rollbackFieldConfig(out.activity);
  assert.equal(w.getField(t.id, f.id).type, 'number', 'the redo');
});

test('snapshots survive a reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wv-467-'));
  try {
    const data = join(dir, 'w.db');
    const { w, t } = workspace({ path: data });
    const f = w.addField(t, { name: 'Qty', type: 'number' });
    const a = w.createEntity(t, { name: 'a', values: { Qty: 9.75 } });
    w.updateField(t.id, f.id, { type: 'text' });
    const again = new Weave({ path: data });
    again.rollbackFieldConfig(again.activityFeed({ entityId: t.id }).items[0].id);
    assert.equal(val(again, a.id, 'Qty'), 9.75);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('snapshot values never leave: not in the feed, not in the export', async () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Ref', type: 'text' });
  w.createEntity(t, { name: 'a', values: { Ref: 'only-in-the-snapshot-9f3' } });
  w.updateField(t.id, f.id, { type: 'number' }); // the text converts to nothing
  assert.ok(!JSON.stringify(w.exportJSON({ blobs: false })).includes('only-in-the-snapshot-9f3'), 'the export does not carry it');
  assert.ok(!JSON.stringify(w.activityFeed()).includes('only-in-the-snapshot-9f3'), 'the feed does not carry it');
  const reader = w.createAccount({ name: 'reader-bot', role: 'reader' }).token;
  const writer = w.createAccount({ name: 'writer-bot', role: 'writer' }).token;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const entry = newest(w, t);
    const one = await (await fetch(`${base}/api/activity/${encodeURIComponent(entry.id)}`, { headers: { Authorization: `Bearer ${reader}` } })).text();
    assert.ok(!one.includes('only-in-the-snapshot-9f3'), 'a reader reads the entry, not the values');
    const audit = await (await fetch(`${base}/api/audit`, { headers: { Authorization: `Bearer ${reader}` } })).text();
    assert.ok(!audit.includes('only-in-the-snapshot-9f3'), 'nor through the audit log');
    const denied = await fetch(`${base}/api/tables/${t.id}/fields/${f.id}/rollback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${writer}` }, body: JSON.stringify({ activity: entry.id }),
    });
    assert.equal(denied.status, 403, 'the schema rung, unchanged');
  } finally { server.close(); }
});

test('a credential field keeps only secret names in its snapshot', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Token', type: 'key' });
  const a = w.createEntity(t, { name: 'a', values: { Token: 'stripe-live' } });
  w.updateField(t.id, f.id, { type: 'text' });
  const raw = w.store.listAudit({ limit: 5 }).find((r) => r.action === 'field-config-updated');
  assert.deepEqual(Object.values(raw.detail.snapshot).map((pair) => pair[0]), ['stripe-live'], 'the name the row held, never a secret');
  assert.deepEqual(w.listAudit({ limit: 5 }).find((r) => r.action === 'field-config-updated').detail.snapshot, { rows: 1 }, 'the audit door shows the count only');
  assert.ok(!JSON.stringify(w.exportJSON({ blobs: false })).includes('"snapshot"'));
  w.rollbackFieldConfig(newest(w, t).id);
  assert.equal(val(w, a.id, 'Token'), 'stripe-live');
});

test('the MCP door answers with the counts', () => {
  const { w, t } = workspace();
  const f = w.addField(t, { name: 'Qty', type: 'number' });
  w.createEntity(t, { name: 'a', values: { Qty: 1 } });
  w.updateField(t.id, f.id, { type: 'text' });
  const out = dispatchTool(w, 'weave_rollback_field', { activity: newest(w, t).id });
  assert.deepEqual([out.restored, out.left, out.converted], [1, 0, 0]);
});
