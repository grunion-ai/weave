import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIELD_TYPES, TYPE_MIGRATIONS } from '../src/engine.js';
import { ADD_CASES, UPDATE_CASES, addScenarios, updateScenarios, extraUpdateScenarios, migrationScenarios, nameFieldScenarios } from './lib/field-type-scenarios.mjs';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/field-type-config.json', import.meta.url), 'utf8'));

const pinned = (name, got, want, label) => {
  assert.equal(got.length, want.length, `${name}: case count`);
  got.forEach((g, i) => assert.deepEqual(g, want[i], `${name} ${label(g)}`));
};

test('every field type is pinned on add, and every config-carrying type on update', () => {
  const added = new Set(ADD_CASES.map(([t]) => t));
  assert.deepEqual(FIELD_TYPES.filter((t) => !added.has(t)), []);
  const updated = new Set(UPDATE_CASES.map(([t]) => t));
  assert.deepEqual(FIELD_TYPES.filter((t) => !updated.has(t) && !['relation', 'view'].includes(t)), []);
});

test('addField builds the same config for every type as the pinned record', () => {
  pinned('add', addScenarios(), GOLDEN.add, (g) => `${g.type} ${JSON.stringify(g.sent)}`);
});

test('updateField merges every type\'s config patch as the pinned record', () => {
  pinned('update', updateScenarios(), GOLDEN.update, (g) => g.type);
  pinned('extra update', extraUpdateScenarios(), GOLDEN.extraUpdate, (g) => g.which);
});

test('every allowed type change converts config and values as the pinned record', () => {
  const got = migrationScenarios();
  const edges = new Set(got.map((m) => `${m.from}>${m.to}`));
  for (const [from, tos] of Object.entries(TYPE_MIGRATIONS)) for (const to of tos) assert.ok(edges.has(`${from}>${to}`), `${from} to ${to} is pinned`);
  pinned('migrate', got, GOLDEN.migrate, (g) => `${g.from} to ${g.to} ${JSON.stringify(g.sent)}`);
  pinned('name field', nameFieldScenarios(), GOLDEN.nameField, (g) => g.to);
});
