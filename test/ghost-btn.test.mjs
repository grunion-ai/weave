import test from 'node:test';
import assert from 'node:assert/strict';
import { read, liftFunction } from './lib/source.mjs';

const APP_JS = read('public/app.js');
const FILES = ['public/app.js', 'public/command-palette.js', 'public/field-dialog.js'];
const el = (tag, attrs, ...kids) => ({ tag, attrs, kids });

test('ghostBtn builds the small ghost button and appends extra classes (Feature #177)', () => {
  const ghostBtn = liftFunction('ghostBtn', { el }, APP_JS);
  assert.deepEqual(ghostBtn({ type: 'button', title: 'Retry' }, 'x'),
    { tag: 'button', attrs: { class: 'btn btn-sm btn-ghost-secondary tiny', type: 'button', title: 'Retry' }, kids: ['x'] });
  assert.equal(ghostBtn({ class: 'unlink-btn' }).attrs.class, 'btn btn-sm btn-ghost-secondary tiny unlink-btn');
});

test('no button spells the ghost button classes by hand (Feature #177)', () => {
  for (const file of FILES) {
    const src = read(file).replace(/function ghostBtn\([\s\S]*?\n}\n/, '');
    assert.doesNotMatch(src, /el\('button', \{[^}]{0,80}'btn btn-sm btn-ghost-secondary tiny/, `${file} builds its ghost buttons through ghostBtn`);
  }
});
