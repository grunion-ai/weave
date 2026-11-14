import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { everyTypeWorkspace, EDITS } from './lib/schema-scenarios.mjs';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/schema-mirror.json', import.meta.url), 'utf8'));
const REFUSED = GOLDEN.edits.map((e, i) => ({ ...e, i })).filter((e) => e.error);
const fieldOf = (doc, name) => doc.find((sp) => sp.space === 'Ops').tables.find((t) => t.name === 'Deal').fields.find((f) => f.name === name);
const pinned = (error) => (err) => `${err.code ?? 'error'}: ${err.message}` === error;

test('the golden pins every refused edit with its field as it was (Issue #1625)', () => {
  assert.ok(REFUSED.length, 'the golden pins refusals');
  for (const e of REFUSED) assert.deepEqual(e.after, e.before, `${e.name} ${JSON.stringify(e.change)}: ${e.error}`);
});

test('a refused schema edit changes no table, and its dry run raises the same error (Issue #1625)', () => {
  for (const { i, error } of REFUSED) {
    const [name, change] = EDITS[i];
    const w = everyTypeWorkspace();
    const before = w.describeSchema();
    const doc = structuredClone(before);
    Object.assign(fieldOf(doc, name), structuredClone(change));
    assert.throws(() => w.applySchema(doc, { dryRun: true }), pinned(error), `${name} dry run`);
    assert.throws(() => w.applySchema(doc), pinned(error), name);
    assert.deepEqual(w.describeSchema(), before, `${name} ${JSON.stringify(change)} left every table as it was`);
  }
});
