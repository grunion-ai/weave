import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

function setup(path) {
  const w = new Weave({ path });
  w.createSpace({ name: 'S' });
  const deal = w.createTable({ space: 'S', name: 'Deal' });
  w.addField(deal, { name: 'Amount', type: 'number' });
  w.addField(deal, { name: 'Stage', type: 'select', config: { options: ['Lead', 'Won'] } });
  return { w, deal, row: w.createEntity(deal, { name: 'Original', values: { Amount: 5 } }) };
}

test('a rejected multi-field update leaves memory and disk unchanged (Issue #1454)', () => {
  const dir = tempDir('weave-atomic-');
  try {
    const path = join(dir, 'ws.db');
    const { w, deal, row } = setup(path);
    assert.throws(() => w.updateEntity(row.id, { Name: 'REJECTED_NAME', Amount: 'invalid' }), /not a number/);
    assert.equal(w.readEntity(row.id).name, 'Original');
    assert.throws(() => w.updateEntity(row.id, { Stage: 'Won', Name: 'REJECTED_NAME', Missing: 1 }), /not found/);
    assert.equal(w.readEntity(row.id).fields.Stage ?? null, null);
    w.createEntity(deal, { name: 'Unrelated' });
    const reopened = new Weave({ path });
    const back = reopened.readEntity(row.id);
    assert.equal(back.name, 'Original');
    assert.equal(back.fields.Amount, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
