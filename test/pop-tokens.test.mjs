import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFor } from './lib/source.mjs';

const POPS = ['.chip-pop', '.date-pop', '#bug-panel'];

test('the floating surfaces read one radius and one shadow token (Features #177, #385)', () => {
  const root = rulesFor(':root');
  assert.ok(root['--wv-radius-surface'], ':root defines --wv-radius-surface');
  assert.ok(root['--wv-pop-shadow'], ':root defines --wv-pop-shadow');
  for (const sel of POPS) {
    const r = rulesFor(sel);
    assert.equal(r['border-radius'], 'var(--wv-radius-surface)', `${sel} radius`);
    assert.equal(r['box-shadow'], 'var(--wv-pop-shadow)', `${sel} shadow`);
  }
});
