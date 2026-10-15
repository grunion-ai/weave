import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const body = (name) => {
  const at = APP.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} exists`);
  return APP.slice(at, APP.indexOf('\n}\n', at) + 2);
};

test('one shared dismiss closes overlays on pointerdown in the capture phase (Issue #726)', () => {
  const fn = body('dismissOutside');
  assert.match(fn, /addEventListener\('pointerdown', away, true\)/, 'iOS sends pointerdown for any touch, where a click may never come');
  assert.match(fn, /removeEventListener\('pointerdown', away, true\)/, 'and it unhooks itself');
  assert.match(fn, /swallowClick\(\)/, 'a site can swallow the click that follows the dismissing touch');
});

test('no overlay dismisses itself from a hand-rolled click listener (Issue #726)', () => {
  const rolled = [...APP.matchAll(/addEventListener\('click', (?:function )?(away|close|outside)\b/g)].map((m) => m[0]);
  assert.deepEqual(rolled, [], 'a click listener never reaches iOS for a touch on empty space');
  const uses = (APP.match(/dismissOutside\(\{/g) ?? []).length;
  assert.ok(uses >= 8, `the menu builder, popovers, pickers, sheets and the bug panel all use it (${uses})`);
  for (const fn of ['showPopover', 'searchPicker', 'valuePop', 'menu', 'tableControlPopover', 'tableToolsButton', 'openBugPanel']) {
    assert.match(body(fn), /dismissOutside\(\{/, `${fn} closes through dismissOutside`);
  }
});

test('every action menu shares the builder\'s one dismiss path, none rolls its own (Issue #663)', () => {
  for (const fn of ['dotsMenu', 'crumbFoldMenu', 'personalMenu']) {
    const src = body(fn);
    assert.match(src, /\bmenu\(/, `${fn} opens through menu()`);
    assert.doesNotMatch(src, /dismissOutside|addEventListener\('keydown'/, `${fn} has no private dismiss or key handler`);
  }
  assert.equal(APP.includes('function contextMenu('), false, 'the right-click menu is the same builder, opened at the pointer');
});
