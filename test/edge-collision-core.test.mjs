import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, PLATFORMS, SCREENS, THEME, TOLERANCE, WIDTHS, keyOf, ratchet, sectionOf } from './lib/edge-collision.mjs';

const file = JSON.parse(readFileSync(new URL('./edge-collision-baseline.json', import.meta.url), 'utf8'));
const hit = (extra = {}) => ({ screen: 'view-panel', width: 1440, theme: 'light', kind: 'overlap', a: 'Clear all', b: 'Report a problem', ...extra });

test('a collision key names the screen, width, theme, kind and both names, in either order', () => {
  assert.equal(keyOf(hit()), 'view-panel|1440|light|overlap|Clear all + Report a problem');
  assert.equal(keyOf(hit({ a: 'Report a problem', b: 'Clear all' })), keyOf(hit()));
  assert.equal(keyOf({ screen: 'table', width: 390, theme: 'light', kind: 'clipped', a: 'Share (Beta)' }), 'table|390|light|clipped|Share (Beta)');
});

test('a collision key folds numbers, so a record named Task 37 and Task 12 hold one entry', () => {
  assert.equal(keyOf(hit({ a: 'Task 37', b: 'Open Task 37' })), keyOf(hit({ a: 'Task 12', b: 'Open Task 12' })));
});

test('a collision the baseline names passes, and one it does not name is fresh', () => {
  const entry = { ...hit(), issue: 1861 };
  assert.deepEqual(ratchet([hit()], [entry]), { fresh: [], gone: [], unfiled: [], doubled: [] });
  const other = hit({ a: 'Share (Beta)', b: 'Show or hide fields' });
  assert.deepEqual(ratchet([hit(), other], [entry]).fresh, [other]);
});

test('a baseline entry that no longer reproduces is gone, so the baseline only shrinks', () => {
  const entry = { ...hit(), issue: 1861 };
  assert.deepEqual(ratchet([], [entry]).gone, [entry]);
});

test('a baseline entry with no Issue number is refused', () => {
  for (const issue of [undefined, null, 0, -4, 1.5, '1861']) {
    const entry = { ...hit(), issue };
    assert.deepEqual(ratchet([hit()], [entry]).unfiled, [entry], `issue ${JSON.stringify(issue)}`);
  }
});

test('a baseline entry listed twice is refused', () => {
  const entry = { ...hit(), issue: 1861 };
  assert.deepEqual(ratchet([hit()], [entry, { ...entry }]).doubled, [keyOf(entry)]);
});

test('one collision measured twice on a screen counts once', () => {
  assert.deepEqual(ratchet([hit(), hit()], [{ ...hit(), issue: 1861 }]).fresh, []);
  assert.equal(ratchet([hit(), hit()], []).fresh.length, 1);
});

test('the sweep covers the screens, widths and kinds Feature #388 names', () => {
  assert.deepEqual(SCREENS.map((s) => s.name), ['home', 'space', 'table', 'board', 'view-panel', 'share-panel', 'record-beside', 'record-page', 'document', 'command-menu']);
  assert.deepEqual(WIDTHS, [1920, 1440, 1280, 1024, 960, 768, 390]);
  assert.deepEqual(KINDS, ['overlap', 'clipped', 'off-screen']);
  assert.equal(TOLERANCE, 2);
  assert.equal(THEME, 'light');
});

test('every baseline entry is well formed and names the Issue that tracks it', () => {
  assert.deepEqual(Object.keys(file).sort(), [...PLATFORMS].sort(), 'one section per platform the gate runs on');
  for (const platform of PLATFORMS) {
    const entries = sectionOf(file, platform);
    assert.ok(Array.isArray(entries), `${platform} is a list`);
    const { unfiled, doubled } = ratchet([], entries);
    assert.deepEqual(unfiled, [], `${platform}: every entry names its Issue number`);
    assert.deepEqual(doubled, [], `${platform}: no entry is listed twice`);
    for (const e of entries) {
      assert.ok(SCREENS.some((s) => s.name === e.screen), `${platform}: ${e.screen} is a screen the sweep opens`);
      assert.ok(WIDTHS.includes(e.width), `${platform}: ${e.width} is a width the sweep measures`);
      assert.equal(e.theme, THEME, `${platform}: ${keyOf(e)} is measured in the theme the sweep runs`);
      assert.ok(KINDS.includes(e.kind), `${platform}: ${e.kind} is a kind the probe reports`);
      assert.equal(typeof e.a, 'string');
      if (e.kind === 'overlap') assert.equal(typeof e.b, 'string', `${platform}: an overlap names both controls`);
    }
  }
});
