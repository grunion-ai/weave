import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, HTML, read } from './lib/source.mjs';
const BOOT = read('public/ws-boot.js');
const TAG = '<script src="/ws-boot.js"></script>';
test('the workspace rail paints before first paint, after the rail and the wordmark are parsed (Issue #1283)', () => {
  const boot = HTML.indexOf(TAG);
  assert.ok(boot > 0, `index.html loads /ws-boot.js with ${TAG}`);
  assert.ok(boot > HTML.indexOf('id="ws-list"'), 'the script runs after the rail list it fills');
  assert.ok(boot > HTML.indexOf('id="ws-name"'), 'the script runs after the wordmark it writes');
  assert.ok(boot < HTML.indexOf('<script src="/app.js" defer></script>'), 'the rail is up before the deferred boot');
  assert.doesNotMatch(HTML.slice(boot, HTML.indexOf('</script>', boot)), /\bdefer\b|\basync\b/, 'a deferred rail script lands after first paint');
});
test('the rail boot depends on nothing (Issue #1283)', () => {
  assert.doesNotMatch(BOOT, /\bimport\b|\brequire\(|WeavePrefs|chipCore|weaveChip|\bapi\(/, 'a script that runs before first paint can depend on nothing');
  assert.match(BOOT, /localStorage/, 'the rail comes from the cache the last answer wrote');
  assert.match(BOOT, /weaveWsRail/, 'the boot publishes the renderer and the cache app.js reuses');
});
test('one renderer draws the cached rail and the answered rail (Issue #1283)', () => {
  const rail = APP.slice(APP.indexOf('async function buildWsRail'), APP.indexOf('const servesBareRoot'));
  assert.match(rail, /weaveWsRail\.chipEl\(/, 'buildWsRail draws its chips through the boot renderer');
  assert.match(rail, /weaveWsRail\.write\(/, 'a successful answer writes the cache the next paint reads');
  assert.ok(rail.indexOf('weaveWsRail.write(') > rail.indexOf("api('GET', '/workspaces')"), 'only an answered list is cached');
});
test('signing out forgets the cached rail (Issue #1283)', () => {
  const out = APP.slice(APP.indexOf('const postLogout'), APP.indexOf('async function signOutEverywhere'));
  assert.match(out, /weaveWsRail\.forget\(\)/, 'the next account never sees the last account chips');
});
