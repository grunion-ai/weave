import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_KINDS, KEYSTORES } from '../src/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

/* Feature #143 — the credential chip. What a reader must be able to tell at a
   glance: which SORT of credential this is, WHERE the secret lives, and that
   what they are looking at is not the secret. */

test('app.js parses — the greps below are worthless against a broken file', () => {
  // Source greps passed for a whole release while app.js failed to parse.
  assert.doesNotThrow(() => new Function(APP), 'public/app.js does not parse');
});

test('every credential kind and keystore the engine allows has a glyph and a label', () => {
  const glyphs = APP.match(/const CREDENTIAL_GLYPHS = \{[^}]*\}/s)?.[0] ?? '';
  assert.ok(glyphs, 'app.js declares CREDENTIAL_GLYPHS');
  for (const kind of CREDENTIAL_KINDS) {
    assert.match(glyphs, new RegExp(`\\b${kind}\\b`), `no glyph for the '${kind}' kind`);
  }
  const stores = APP.match(/const KEYSTORE_LABELS = \{[^}]*\}/s)?.[0] ?? '';
  assert.ok(stores, 'app.js declares KEYSTORE_LABELS');
  for (const store of KEYSTORES) {
    // Quoted or bare — the contract is that the key is there, not how JS
    // spells an identifier that happens to start with a digit.
    assert.match(stores, new RegExp(`(['"]?)${store}\\1\\s*:`), `no label for the '${store}' keystore`);
  }
});

// Comments explain the code and are not the code; a prose mention of /reveal
// is not a fetch. Strip them before asserting on what the branch DOES.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the chip says it is masked, and never renders a secret', () => {
  const app = APP.slice(APP.indexOf("f.type === 'key'"));
  const chip = stripComments(app.slice(0, app.indexOf('if (f.type === \'checkbox\'')));
  assert.match(chip, /k-key/, 'it is still a tier-1 value chip');
  assert.match(chip, /✱/, 'the mask is visible in the chip');
  assert.doesNotMatch(chip, /revealKey|\/reveal/, 'the grid cell never fetches a secret');
  // The glyph is the mask here, so the engine's text mask is stripped rather
  // than worn on top of it — "✱✱✱✱✱ stripe-live" was the bug.
  assert.match(chip, /replace\(\/\^✱\+/, 'the chip strips the engine mask prefix');
});

test('the keystore badge has a rule, and does not fight the chip it sits in', () => {
  assert.match(CSS, /\.k-key \.store/, '.k-key .store has a rule');
  // Bare class names collide with Tabler's own (`.toast` was invisible for its
  // whole life). A credential badge is scoped inside .k-key, never bare.
  assert.doesNotMatch(CSS, /^\.store\s*\{/m, '.store must not be a bare global class');
});

test('the browser and the engine agree on where a remote credential lives', async () => {
  // The link table exists twice — once in the engine, once in app.js, because
  // the browser cannot import the engine and one shared module for six lines
  // is more machinery than the duplication. This is the gate that makes the
  // duplication safe: a keystore added on one side fails here.
  const { Weave } = await import('../src/engine.js');
  const w = new Weave({ keystorePath: '/dev/null/nope' });
  const browser = new Function(`${APP.slice(APP.indexOf('function credentialLinkFor('), APP.indexOf('\n/* The one control'))}; return credentialLinkFor;`)();

  for (const keystore of KEYSTORES) {
    const field = { type: 'key', config: { keystore } };
    assert.equal(browser(keystore, 'acme-portal'), w.credentialLink(field, 'acme-portal'),
      `the '${keystore}' link differs between app.js and the engine`);
  }
});

test('reopening a credential column shows the kind it actually has', () => {
  /* The schema flattens a credential's config onto the field, and the field
     tray reads {type, config}. Without the fold-back every existing column
     reopened saying "API key / weave" — and pressing Save would have written
     that over an SSN column's real config. */
  // The fold-back moved to field-dialog-core.definitionFromFieldView, where
  // it is behavior-tested (an SSN/vault column folds back as itself, not the
  // apikey/local defaults). Here only the dialog's delegation is pinned.
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
