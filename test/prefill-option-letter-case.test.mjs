import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

test('a prefill value in another letter case resolves to its option', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Library' });
  const saves = w.createTable({ space: 'Library', name: 'Saves' });
  w.addField(saves, { name: 'Source', type: 'select', config: { options: ['Squirrel', 'Manual Entry'] } });
  w.addField(saves, { name: 'Tags', type: 'multiselect', config: { options: ['ai', 'Deep Ops'] } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const q = new URLSearchParams([['Source', 'MANUAL ENTRY'], ['Tags', 'AI'], ['Tags', 'deep ops']]);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/${saves.id}/prefill?${q}`);
    assert.equal(res.status, 200);
    const draft = await res.json();
    const by = Object.fromEntries(draft.fields.map((f) => [f.field, f]));
    assert.equal(by.Source.value, 'Manual Entry');
    assert.deepEqual(by.Tags.value, ['ai', 'Deep Ops']);
    assert.deepEqual(draft.fields.flatMap((f) => f.errors), []);
  } finally { server.close(); }
});
