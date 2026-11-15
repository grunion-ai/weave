import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Weave } from '../src/engine.js';

test('the outline etag digests the changed spaces in id order, whatever order they changed in', () => {
  const w = new Weave();
  const ids = [];
  let unordered = false;
  for (let i = 0; i < 60 && !unordered; i++) {
    const s = w.createSpace({ name: `Space ${i}` });
    unordered = ids.some((id) => id > s.id);
    ids.push(s.id);
  }
  assert.ok(unordered, 'created spaces until one id sorts before an earlier one');
  const text = w.spaceVersions().spaces
    .filter((s) => s.version > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => `${s.id}:${s.version}`)
    .join(',');
  const want = createHash('sha1').update(text).digest('hex').slice(0, 8);
  assert.equal(w.spaceVersions().etag, want);
  assert.match(w.ontology(), new RegExp(`etag ${want}$`));
});
