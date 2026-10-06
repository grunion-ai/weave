import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import '../public/date-grain.js';

const DG = globalThis.weaveDateGrain;

test('{{Today}} wears the workspace date format; {{Today:iso}} stays ISO; a date field wears its own', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  w.addField(t.id, { name: 'Due', type: 'date' });
  w.createAutomation(t.id, {
    name: 'Stamp', trigger: { type: 'entity-created' },
    actions: [{ type: 'append-doc', text: 'Closed {{Today}} ({{Today:iso}}), due {{Due}}.' }],
  });
  const iso = w.now().toISOString().slice(0, 10);
  const today = DG.formatDate(iso, { now: w.now(), viewerZone: 'UTC' });
  assert.notEqual(today, iso, 'the premise: the costume is not the ISO form');
  const e = w.createEntity(t.id, { Name: 'R', Due: '2026-10-06' });
  assert.equal(w.getDoc(e.id), `Closed ${today} (${iso}), due ${DG.formatDate('2026-10-06', { now: w.now(), viewerZone: 'UTC' })}.`);
  assert.match(w.getDoc(e.id), /due Oct 6, 2026\./);
});
