import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/source.mjs';

const INDEX = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const BOOT = readFileSync(join(ROOT, 'public/theme-boot.js'), 'utf8');

test('the shell declares both colour schemes to the browser (Issue #1714)', () => {
  assert.match(INDEX, /<meta name="color-scheme" content="light dark">/);
  assert.match(INDEX, /<meta name="theme-color" content="#eceff3" media="\(prefers-color-scheme: light\)">/);
  assert.match(INDEX, /<meta name="theme-color" content="#0f1115" media="\(prefers-color-scheme: dark\)">/);
});

test('the theme lands before the first stylesheet, not after the deferred boot (Issue #1714)', () => {
  const boot = INDEX.indexOf('<script src="/theme-boot.js"></script>');
  assert.ok(boot > 0, 'index.html loads /theme-boot.js');
  assert.ok(boot < INDEX.indexOf('<link rel="stylesheet"'), 'the theme script runs before any stylesheet applies');
  assert.doesNotMatch(INDEX.slice(boot, INDEX.indexOf('</script>', boot)), /\bdefer\b|\basync\b/, 'a deferred theme script lands after first paint');
});

test('the theme script reads the stored preference and the system scheme with no dependency (Issue #1714)', () => {
  assert.match(BOOT, /weave-theme/);
  assert.match(BOOT, /prefers-color-scheme: dark/);
  assert.match(BOOT, /bsTheme|data-bs-theme/);
  assert.doesNotMatch(BOOT, /WeavePrefs|\bimport\b/, 'the first script on the page can depend on nothing');
});
