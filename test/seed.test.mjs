import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed } from '../scripts/seed.mjs';

test('demo seed builds a coherent workspace', () => {
  const w = new Weave();
  const { apollo, t3, ada } = seed(w);

  // Rollups across the seeded graph.
  const proj = w.readEntity(apollo.id);
  assert.equal(proj.fields['Task Count'], 3);
  assert.equal(proj.fields['Total Estimate'], 24);
  assert.match(proj.fields['Task List'], /Design onboarding wizard/);

  // Automation fired when t3 hit Done.
  const done = w.readEntity(t3.id);
  assert.match(done.doc, /✅ Completed on \d{4}-\d{2}-\d{2}/);
  assert.ok(done.comments.some((c) => c.text.includes('moved to Done')));

  // Lookup + formula computed.
  assert.equal(done.fields['Project Budget'], 120000);
  assert.equal(done.fields.Size, 'small');

  // Person rollup over assigned tasks.
  assert.equal(w.readEntity(ada.id).fields['Open Load'], 16);

  // Mentions resolve in HTML.
  const schema = w.describeSchema();
  // Demo spaces + the Workspace system space (Feature #12).
  assert.equal(schema.filter((sp) => !sp.system).length, 2);
  assert.equal(schema.filter((sp) => sp.system).length, 1);
});
