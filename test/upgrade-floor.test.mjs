import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, UPGRADE_FLOOR } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'weave-v0.4.100.db');

const sample = () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Item' });
  w.addField(t, { name: 'Share', type: 'number', config: { format: 'percent' } });
  w.createEntity(t, { name: 'X', doc: 'body', values: { Share: 0.25 } });
  return w;
};

test('the upgrade floor is v0.4.4, the release that marked percent values fractional', () => {
  assert.equal(UPGRADE_FLOOR, 'v0.4.4');
});

for (const [label, age] of [
  ['a v1 dump', (d) => { d.version = 1; }],
  ['a dump keyed by databases', (d) => { d.databases = d.tables; delete d.tables; }],
  ['a dump with percent values still whole numbers', (d) => { delete d.meta.percentFractional; }],
]) {
  test(`${label} is refused with the floor named, never half-migrated`, () => {
    const dump = sample().exportJSON();
    age(dump);
    const w = new Weave();
    const before = Object.keys(w.state.entities);
    assert.throws(() => w.importJSON(dump), (err) => err.code === 'invalid' && err.message.includes(UPGRADE_FLOOR));
    assert.deepEqual(Object.keys(w.state.entities), before, 'the refused dump leaves the workspace as it was');
  });
}

test('a workspace the minimum supported release wrote opens and round-trips through importJSON', () => {
  const dir = tempDir('weave-floor-');
  const path = join(dir, 'weave.db');
  copyFileSync(FIXTURE, path);
  const w = new Weave({ path });
  const dump = w.exportJSON({ blobs: false });
  const again = new Weave();
  again.importJSON(dump);
  const strip = (s) => Object.fromEntries(Object.entries(s.entities).map(([id, e]) => [id, { name: e.name, values: e.values, docs: e.docs }]));
  assert.ok(Object.keys(dump.entities).length > 0, 'the fixture holds rows');
  assert.deepEqual(strip(again.exportJSON({ blobs: false })), strip(dump));
});

test('opening, settling deferred work and importJSON each restore the same migrated shape', () => {
  const dir = tempDir('weave-migrate-paths-');
  const path = join(dir, 'ws.db');
  const w = sample();
  const dump = w.exportJSON();
  const shape = (s) => ({ counted: Number.isInteger(s.meta.activitySeq), automationSeq: s.meta.automationSeq });
  const want = shape(w.state);
  const aged = () => { const d = structuredClone(dump); delete d.meta.activitySeq; delete d.meta.automationSeq; return d; };
  const imported = new Weave();
  imported.importJSON(aged());
  assert.deepEqual(shape(imported.state), want, 'importJSON');
  const disk = new Weave({ path });
  disk.importJSON(dump);
  delete disk.state.meta.activitySeq;
  delete disk.state.meta.automationSeq;
  disk.settleDeferred();
  assert.deepEqual(shape(disk.state), want, 'settleDeferred');
  delete disk.state.meta.activitySeq;
  disk.save();
  assert.deepEqual(shape(new Weave({ path }).state), want, 'open');
});

test('roleName is the one reader of the retired role names', () => {
  assert.deepEqual([Weave.roleName('admin'), Weave.roleName('writer'), Weave.roleName('reader')], ['architect', 'editor', 'observer']);
  assert.equal(Weave.roleName('editor'), 'editor');
  const src = join(ROOT, 'src');
  const readers = readdirSync(src).filter((f) => f.endsWith('.js'))
    .flatMap((f) => (readFileSync(join(src, f), 'utf8').match(/OLD_ROLES/g) ?? []).map(() => f));
  assert.deepEqual(readers, ['engine.js', 'engine.js'], 'OLD_ROLES is defined once and read only inside roleName');
});
