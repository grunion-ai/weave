import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onDisk, reopen } from './lib/reopen.mjs';

const UNKNOWN = {
  Amount: { format: 'ledger', display: 'gauge' },
  When: { clock: '36h', zone: 'lunar' },
  Cover: { preview: 'reel', size: 'huge', fit: 'stretch' },
  Face: { shape: 'hexagon' },
  Notes: { kind: 'notebook' },
  Secret: { kind: 'passkey', keystore: 'vault' },
};

function newerWorkspace() {
  const w = onDisk('wv-1721-');
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Item' });
  w.addField('Item', { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'USD', display: 'bar' } });
  w.addField('Item', { name: 'When', type: 'date', config: { time: true, clock: '12h', zone: 'instant' } });
  w.addField('Item', { name: 'Cover', type: 'attachments', config: { multiple: false, preview: 'intro', size: 'large', fit: 'fill' } });
  w.addField('Item', { name: 'Face', type: 'avatar', config: { shape: 'square' } });
  w.addField('Item', { name: 'Notes', type: 'document', config: { kind: 'code' } });
  w.addField('Item', { name: 'Secret', type: 'key', config: { kind: 'token', keystore: '1password' } });
  w.addField('Item', { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Idea', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  w.createEntity('Item', { name: 'r1', values: { Amount: 4 } });
  const tableId = w.getTable('Item').id;
  const path = w.store.path;
  w.store.close();
  const db = new DatabaseSync(path);
  const row = JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(tableId).json);
  for (const f of Object.values(row.fields)) {
    if (UNKNOWN[f.name]) Object.assign(f.config, UNKNOWN[f.name]);
    if (f.name === 'Stage') f.config.states[1].category = 'archived';
  }
  db.prepare('UPDATE tables SET json = ? WHERE id = ?').run(JSON.stringify(row), tableId);
  db.close();
  return { w, path };
}

test('an unknown option value in a stored field config opens with the default and a warning (Issue #1721)', (t) => {
  const { w } = newerWorkspace();
  const warned = [];
  t.mock.method(console, 'warn', (...args) => warned.push(args.join(' ')));
  const again = reopen(w);
  assert.equal(again.listEntities(again.getTable('Item').id).length, 1);
  const config = (name) => again.getField('Item', name).config;
  for (const [name, keys] of Object.entries(UNKNOWN)) {
    for (const key of Object.keys(keys)) assert.equal(config(name)[key], undefined, `${name}.${key} falls back to its default`);
  }
  assert.equal(config('Amount').currency, 'USD', 'known keys stay');
  assert.equal(config('Cover').multiple, false);
  assert.deepEqual(config('Stage').states.map((s) => s.category), ['not-started', 'in-progress']);
  const tolerated = again.listAudit({ actions: ['field-config-tolerated'], limit: -1 })
    .map((r) => `${r.detail.field}.${r.detail.key}=${r.detail.value}`).sort();
  const expected = [
    ...Object.entries(UNKNOWN).flatMap(([name, keys]) => Object.entries(keys).map(([k, v]) => `${name}.${k}=${v}`)),
    'Stage.category=archived',
  ].sort();
  assert.deepEqual(tolerated, expected);
  assert.equal(warned.length, expected.length);
  assert.match(warned[0], /Item/);
});

test('the write side still refuses an unknown option value (Issue #1721)', () => {
  const { w } = newerWorkspace();
  const again = reopen(w);
  const cover = again.getField('Item', 'Cover');
  assert.throws(() => again.updateField('Item', cover.id, { config: { preview: 'reel' } }), /Invalid attachments preview 'reel'/);
  assert.throws(() => again.addField('Item', { name: 'Spec', type: 'document', config: { kind: 'notebook' } }), /Invalid document kind/);
});
