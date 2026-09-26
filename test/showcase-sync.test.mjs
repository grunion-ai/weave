/* Showcase sync: seedFieldShowcase built the Showcase once and returned early
   when the space existed, so the columns Features #230 (bar, ring, heat),
   #231 (rating) and #232 (sparkline) added to the seed never reached a docs
   workspace seeded before them: :4400's Showcase had none of the three.
   The additions are now data the fresh seed and an existing workspace both
   go through, and boot applies them once per build (the Handbook sync's
   shape, Issue #255). Additive and name-matched: a missing field is added
   beside its anchor, a value lands only in an empty cell, and nothing a
   person renamed, filled or kept is touched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { ROOT } from './lib/source.mjs';
import { seedWeaver, seedFieldShowcase, syncShowcase, showcaseHash } from '../src/weaver-seed.js';

const BIN = join(ROOT, 'bin', 'weave.js');
const dir = mkdtempSync(join(tmpdir(), 'weave-showcase-sync-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

/* The Showcase as a build before Features #230–#232 left it: the base
   columns and rows, no rating, no graphic display, no list formula, and one
   cell a person filled in by hand under a name the sync will add. */
function olderShowcase(w = new Weave()) {
  w.createSpace({ name: 'Showcase' });
  const people = w.createTable({ space: 'Showcase', name: 'People' });
  w.addField(people, { name: 'Age', type: 'number' });
  const ft = w.createTable({ space: 'Showcase', name: 'Field Types' });
  w.addField(ft, { name: 'Count', type: 'number' });
  w.addField(ft, { name: 'Weight', type: 'number' });
  w.addField(ft, { name: 'Progress', type: 'number' }); // a person's column, same name
  w.addRelation(ft, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: 'Peer of' });
  w.addField(ft, { name: 'Days left', type: 'formula', config: { expression: '1' } });
  const ada = w.createEntity(people, { name: 'Ada Chen', values: { Age: 34 } });
  const leo = w.createEntity(people, { name: 'Leo Marsh', values: { Age: 41 } });
  w.createEntity(ft, { name: 'Sensor board', values: { Count: 12, Progress: 55, Peers: [ada.id, leo.id] } });
  w.createEntity(ft, { name: 'Blank row', values: {} });
  w.save();
  return w;
}
const field = (w, table, name) => w.findField(w.getTable(`Showcase/${table}`), name);
const row = (w, table, name) => w.findEntity(w.getTable(`Showcase/${table}`), name);

test('an older Showcase gains the rating, the displays and the sparklines, beside their anchors', () => {
  const w = olderShowcase();
  const r = syncShowcase(w);
  assert.equal(r.applied, true);
  for (const name of ['Fit', 'Effort', 'Love', 'Score', 'Completion', 'Load', 'Peer skill', 'Age trend', 'Delta columns', 'Wins and losses', 'Skill trend']) {
    assert.ok(field(w, 'Field Types', name), `Field Types gained ${name}`);
  }
  for (const name of ['Skill', 'Joined', 'Delta']) assert.ok(field(w, 'People', name), `People gained ${name}`);
  // Placed beside the anchor, not dumped on the end.
  const ft = w.getTable('Showcase/Field Types');
  const order = ft.fieldOrder.map((id) => ft.fields[id].name);
  assert.equal(order[order.indexOf('Weight') + 1], 'Progress', 'the person\'s Progress keeps its place after Weight');
  assert.ok(order.indexOf('Age trend') > order.indexOf('Days left'), 'the sparklines sit after the formulas');
  // Values fill empty cells only, on the rows the seed names.
  assert.equal(row(w, 'People', 'Ada Chen').values[field(w, 'People', 'Skill').id], 5);
  assert.equal(row(w, 'Field Types', 'Sensor board').values[field(w, 'Field Types', 'Fit').id], 4);
  const sensor = w.readEntity(row(w, 'Field Types', 'Sensor board').id).fields;
  assert.ok(Array.isArray(sensor['Wins and losses']) && sensor['Wins and losses'].length === 2, 'the sparkline reads the existing Peers');
  assert.equal(w.readEntity(row(w, 'Field Types', 'Blank row').id).fields['Skill trend'], null);
});

test('the sync leaves what a person made alone: same-name fields, filled cells, the blank row', () => {
  const w = olderShowcase();
  const before = field(w, 'Field Types', 'Progress');
  syncShowcase(w);
  const after = field(w, 'Field Types', 'Progress');
  assert.equal(after.id, before.id, 'no second Progress');
  assert.equal(after.config?.display, undefined, 'the person\'s Progress is not re-dressed');
  assert.equal(row(w, 'Field Types', 'Sensor board').values[after.id], 55, 'a filled cell is never overwritten');
  assert.equal(row(w, 'Field Types', 'Sensor board').values[field(w, 'Field Types', 'Count').id], 12);
  const blank = row(w, 'Field Types', 'Blank row');
  assert.equal(blank.values[field(w, 'Field Types', 'Fit').id], undefined, 'the blank row stays blank');
});

test('the build hash makes the sync one pass per build; a workspace with no Showcase is left alone', () => {
  const w = olderShowcase();
  assert.equal(syncShowcase(w).applied, true);
  assert.equal(w.state.meta.showcaseSync, showcaseHash());
  const fields = Object.keys(w.getTable('Showcase/Field Types').fields).length;
  assert.equal(syncShowcase(w).applied, false, 'the second boot writes nothing');
  assert.equal(syncShowcase(w, { force: true }).applied, true);
  assert.equal(Object.keys(w.getTable('Showcase/Field Types').fields).length, fields, 'forcing it again adds nothing twice');
  const bare = new Weave();
  assert.equal(syncShowcase(bare).applied, false);
  assert.equal(bare.listSpaces().some((sp) => sp.name === 'Showcase'), false, 'no Showcase is created');
});

test('a fresh seed is already at the current build, and seedFieldShowcase upgrades an existing Showcase', () => {
  const fresh = seedWeaver(new Weave());
  assert.equal(fresh.state.meta.showcaseSync, showcaseHash());
  assert.equal(syncShowcase(fresh).applied, false);
  const old = olderShowcase();
  seedFieldShowcase(old);
  assert.ok(field(old, 'Field Types', 'Wins and losses'), 'the old early return no longer strands an existing Showcase');
});

test('serve brings an existing docs workspace\'s Showcase up to the current build on boot', async () => {
  const sub = mkdtempSync(join(dir, 'boot-'));
  const docsPath = join(sub, 'weave.db');
  const docs = olderShowcase(new Weave({ path: docsPath }));
  docs.state.meta.name = 'weave';
  docs.save();
  docs.store.close?.();
  const child = spawn('node', [BIN, 'serve', '--port', '0', '--data', join(sub, 'ws.db')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve never came up:\n${log}`)), 20000);
    const onData = (d) => { log += d; if (/Weave running/.test(log)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve exited ${code}:\n${log}`)); });
  });
  child.removeAllListeners('exit');
  const exited = new Promise((r) => child.on('exit', r));
  child.kill('SIGTERM');
  await exited;
  assert.match(log, /Showcase sync: \d+ fields added/);
  const w = new Weave({ path: docsPath });
  try {
    assert.ok(field(w, 'Field Types', 'Wins and losses'));
    assert.equal(w.state.meta.showcaseSync, showcaseHash());
  } finally {
    w.store.close?.();
  }
});
