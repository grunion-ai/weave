import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

test('GET /api/spaces/:id answers the space by id or name; an unknown space is a 404', async () => {
  const w = new Weave();
  const space = w.createSpace({ name: 'Sales', description: 'the pipeline' });
  w.createTable({ space: 'Sales', name: 'Deal' });
  await withServer(w, async ({ base }) => {
    const byId = await fetch(`${base}/api/spaces/${space.id}`);
    assert.equal(byId.status, 200);
    const body = await byId.json();
    assert.equal(body.id, space.id);
    assert.equal(body.name, 'Sales');
    assert.equal(body.description, 'the pipeline');
    assert.equal((await (await fetch(`${base}/api/spaces/Sales`)).json()).id, space.id, 'a name reaches the same space');

    const ghost = await fetch(`${base}/api/spaces/Nowhere`);
    assert.equal(ghost.status, 404);
    assert.equal((await ghost.json()).code, 'not-found');
  });
});
