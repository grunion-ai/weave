import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_CATEGORIES, DEFAULT_WORKFLOW_STATES, CELL_COLORS, SYSTEM_SORT_KEYS } from '../src/engine.js';

const FDC = globalThis.fieldDialogCore;
const CG = globalThis.weaveCellGraphics;

test('the engine reads its state lists from the field dialog core, not a copy', () => {
  assert.equal(STATE_CATEGORIES, FDC.STATE_CATEGORIES);
  assert.equal(DEFAULT_WORKFLOW_STATES, FDC.DEFAULT_WORKFLOW_STATES);
});

test('the engine reads its cell colours from the cell graphics core, not a copy', () => {
  assert.equal(CELL_COLORS, CG.COLORS);
});

test('the engine sort keys come from the dialog system sort table', () => {
  assert.deepEqual(SYSTEM_SORT_KEYS, Object.fromEntries(Object.values(FDC.SYSTEM_SORT).map((s) => [s.name, s.key])));
  assert.deepEqual(SYSTEM_SORT_KEYS, {
    'Created At': 'createdAt', 'Modified At': 'updatedAt',
    'Created By': 'createdBy', 'Modified By': 'modifiedBy',
    'Public Id': 'publicId',
  });
});
