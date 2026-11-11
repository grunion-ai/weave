import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plan, prPlan, touchedBrowser, browserHelpers, gating, SMOKE } from '../scripts/ci-test.mjs';
import { testFiles, lanes } from '../scripts/test.mjs';

const ROOT = join(import.meta.dirname, '..');
const MONOLITHS = ['public/app.js', 'public/style.css', 'src/engine.js', 'src/routes.js', 'src/commands.js'];
const unit = Array.from({ length: 30 }, (_, i) => `test/u${String(i).padStart(2, '0')}.test.mjs`);
const rest = Array.from({ length: 90 }, (_, i) => `test/b${String(i).padStart(2, '0')}-browser.test.mjs`);
const browser = ['test/grid-keymap-browser.test.mjs', 'test/oidc-login-browser.test.mjs', 'test/phone-picker-sheet-browser.test.mjs', 'test/security/headers-browser.test.mjs', ...rest, ...SMOKE];
const sources = {
  'test/grid-keymap-browser.test.mjs': "import { launch } from './lib/driver.mjs';",
  'test/oidc-login-browser.test.mjs': "import { startIdp } from './lib/sign-in.mjs'; const src = '../src/oidc.js';",
  'test/phone-picker-sheet-browser.test.mjs': "const pill = page.locator('.sheet-grip-pill'); const { hold } = await import('./lib/press.mjs');",
  'test/security/headers-browser.test.mjs': "import {\n  stateOf,\n} from '../lib/surface-states.mjs';",
  'test/lib/driver.mjs': "export { report } from './report.mjs';",
  'test/u00.test.mjs': "import { withServer } from './lib/server.mjs';",
};
const HELPERS = ['test/lib/driver.mjs', 'test/lib/press.mjs', 'test/lib/report.mjs', 'test/lib/sign-in.mjs', 'test/lib/surface-states.mjs'];
const read = (file) => sources[file] ?? '';
const shardsOf = (shards, lane) => shards.filter((s) => s.lane === lane);
const filesOf = (shards, lane) => shardsOf(shards, lane).flatMap((s) => s.files).sort();
const grip = "+  const grip = el('span', { class: 'sheet-grip-pill' });";

function todays(changed, diff) {
  const touched = touchedBrowser(changed, browser, read, diff);
  return plan([...unit, ...touched], { unit, browser: touched }, () => 1, 4, Math.min(4, Math.ceil(touched.length / 20)));
}

test('the browser helpers are the test/lib files a browser test reaches through its imports, directly or through another helper (Feature #368)', () => {
  assert.deepEqual(browserHelpers(browser, read), HELPERS);
  assert.deepEqual(browserHelpers(SMOKE, read), []);
});

test('a diff touching a shared monolith or a browser helper runs every browser file in the PR gate (Feature #368)', () => {
  for (const path of [...MONOLITHS, ...HELPERS]) {
    const shards = prPlan({ unit, browser }, ['DEVELOPMENT.md', path], read, () => 1, "+  const limit = 'wv-one-line';");
    assert.deepEqual(filesOf(shards, 'browser'), [...browser].sort(), path);
    assert.deepEqual(filesOf(shards, 'unit'), unit, path);
  }
});

test('the full browser lane spreads over the main gate\'s eight shards, each file once, so the 20-minute PR job holds it (Feature #368)', () => {
  const shards = prPlan({ unit, browser }, ['public/app.js'], read, () => 1);
  assert.deepEqual(shardsOf(shards, 'browser').map((s) => s.id), Array.from({ length: 8 }, (_, i) => `browser-${i + 1}`));
  assert.equal(shardsOf(shards, 'unit').length, 4);
  const planned = shardsOf(shards, 'browser').flatMap((s) => s.files);
  assert.equal(new Set(planned).size, planned.length);
  assert.equal(planned.length, browser.length);
});

test('a diff touching none of them keeps today\'s named and reached selection and its shard count (Feature #368)', () => {
  for (const [changed, diff] of [
    [['DEVELOPMENT.md'], ''],
    [['public/grid-keymap.js'], ''],
    [['src/oidc.js'], ''],
    [['public/sheet-core.js'], grip],
    [['test/lib/server.mjs'], ''],
    [['test/lib/helper-no-browser-test-imports.mjs'], ''],
    [['public/app-shell.js', 'public/style-tokens.css', 'src/engine-sql.js', 'src/routes.json', 'docs/public/app.js', 'test/library.mjs', 'test/lib-browser.test.mjs'], ''],
  ]) {
    assert.deepEqual(prPlan({ unit, browser }, changed, read, () => 1, diff), todays(changed, diff), changed.join(' '));
  }
  assert.deepEqual(filesOf(prPlan({ unit, browser }, ['test/lib/server.mjs'], read, () => 1), 'browser'), [...SMOKE].sort());
  assert.ok(filesOf(prPlan({ unit, browser }, ['public/sheet-core.js'], read, () => 1, grip), 'browser').includes('test/phone-picker-sheet-browser.test.mjs'));
  assert.ok(filesOf(prPlan({ unit, browser }, ['test/oidc-login-browser.test.mjs'], read, () => 1), 'browser').length < browser.length);
});

test('the full lane still refuses a plan that lost a required journey suite (Feature #368)', () => {
  for (const path of ['src/routes.js', 'test/lib/driver.mjs']) {
    assert.throws(() => prPlan({ unit, browser: browser.filter((f) => f !== SMOKE[0]) }, [path], read, () => 1), /Missing required journey suite/, path);
  }
});

test('a one-line public/app.js pull request runs this repository\'s whole gating browser lane, where file and token matching ran a sliver (Feature #368)', () => {
  const groups = gating(lanes(testFiles(ROOT), ROOT));
  const readRepo = (file) => readFileSync(join(ROOT, file), 'utf8');
  const diff = ['diff --git a/public/app.js b/public/app.js', '@@ -10,1 +10,1 @@', '-const limit = 10;', '+const limit = 11;'].join('\n');
  const shards = prPlan(groups, ['public/app.js'], readRepo, () => 1, diff);
  assert.deepEqual(filesOf(shards, 'browser'), [...groups.browser].sort());
  assert.equal(shardsOf(shards, 'browser').length, 8);
  assert.ok(touchedBrowser(['public/app.js'], groups.browser, readRepo, diff).length < groups.browser.length);
});

test('this repository\'s browser helpers take in the shared browser driver and what it imports, and leave the unit-only server fixture out (Feature #368)', () => {
  const groups = gating(lanes(testFiles(ROOT), ROOT));
  const helpers = browserHelpers(groups.browser, (file) => readFileSync(join(ROOT, file), 'utf8'));
  for (const file of ['test/lib/browser.mjs', 'test/lib/bug-report.mjs', 'test/lib/journeys.mjs', 'test/lib/states.mjs']) assert.ok(helpers.includes(file), file);
  assert.ok(!helpers.includes('test/lib/fixtures.mjs'));
  assert.ok(helpers.every((file) => file.startsWith('test/lib/') && existsSync(join(ROOT, file))));
});

test('each shared monolith names a file of this repository, so a rename cannot drop the guard unnoticed (Feature #368)', () => {
  for (const path of MONOLITHS) assert.ok(existsSync(join(ROOT, path)), path);
});
