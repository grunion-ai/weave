import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFor } from './lib/source.mjs';

const POPS = ['.chip-pop', '.date-pop', '#bug-panel'];

test('the floating surfaces read one radius and one shadow token (Feature #177)', () => {
  const root = rulesFor(':root');
  assert.ok(root['--wv-pop-radius'], ':root defines --wv-pop-radius');
  assert.ok(root['--wv-pop-shadow'], ':root defines --wv-pop-shadow');
  for (const sel of POPS) {
    const r = rulesFor(sel);
    assert.equal(r['border-radius'], 'var(--wv-pop-radius)', `${sel} radius`);
    assert.equal(r['box-shadow'], 'var(--wv-pop-shadow)', `${sel} shadow`);
  }
});
