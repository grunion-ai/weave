import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_KINDS, KEYSTORES } from '../src/engine.js';
import { APP, liftFunction } from './lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

test('every credential kind and keystore the engine allows has a glyph and a label', () => {
  const glyphs = APP.match(/const CREDENTIAL_GLYPHS = \{[^}]*\}/s)?.[0] ?? '';
  assert.ok(glyphs, 'app.js declares CREDENTIAL_GLYPHS');
  for (const kind of CREDENTIAL_KINDS) {
    assert.match(glyphs, new RegExp(`\\b${kind}\\b`), `no glyph for the '${kind}' kind`);
  }
  const stores = APP.match(/const KEYSTORE_LABELS = \{[^}]*\}/s)?.[0] ?? '';
  assert.ok(stores, 'app.js declares KEYSTORE_LABELS');
  for (const store of KEYSTORES) {
    assert.match(stores, new RegExp(`(['"]?)${store}\\1\\s*:`), `no label for the '${store}' keystore`);
  }
});

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the chip says it is masked, and never renders a secret', () => {
  const app = APP.slice(APP.indexOf("f.type === 'key'"));
  const chip = stripComments(app.slice(0, app.indexOf('if (f.type === \'checkbox\'')));
  assert.match(chip, /k-key/, 'it is still a tier-1 value chip');
  assert.match(chip, /✱/, 'the mask is visible in the chip');
  assert.doesNotMatch(chip, /revealKey|\/reveal/, 'the grid cell never fetches a secret');
  assert.match(chip, /replace\(\/\^✱\+/, 'the chip strips the engine mask prefix');
});

test('the keystore badge has a rule, and does not fight the chip it sits in', () => {
  assert.match(CSS, /\.k-key \.store/, '.k-key .store has a rule');
  assert.doesNotMatch(CSS, /^\.store\s*\{/m, '.store must not be a bare global class');
});

test('the browser and the engine agree on where a remote credential lives', async () => {
  const { Weave } = await import('../src/engine.js');
  const w = new Weave({ keystorePath: '/dev/null/nope' });
  const browser = liftFunction('credentialLinkFor');

  for (const keystore of KEYSTORES) {
    const field = { type: 'key', config: { keystore } };
    assert.equal(browser(keystore, 'acme-portal'), w.credentialLink(field, 'acme-portal'),
      `the '${keystore}' link differs between app.js and the engine`);
  }
});

test('reopening a credential column shows the kind it actually has', () => {
  assert.match(APP, /fdc\.definitionFromFieldView\(existing\)/, 'the tray reopens a column through the tested fold-back');
});

test('reveal lives on the entity page, behind a deliberate press', () => {
  assert.match(APP, /function credentialReveal\(/, 'app.js has a reveal control');
  const fn = APP.slice(APP.indexOf('function credentialReveal('));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /\/reveal/, 'it calls the reveal endpoint');
  assert.match(body, /via/, 'and says whether the secret was shown or copied');
  assert.match(body, /forbidden|not shared|403/i, 'a refusal is explained, not swallowed');
});
