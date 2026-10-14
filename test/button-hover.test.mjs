import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS, rulesFor } from './lib/source.mjs';

const QUIET = ['.icon-btn', '.ws-icon', '.wv-act-icon', '.url-edit', '.field-menu', '.add-field-btn', '.tray-close', '.bug-cat', '.mention-caret', '.doc-caret'];
const BORDERED = ['.search-like', '#nav-expand', '.type-tile', '.ws-icon.ws-new'];

test('the hover palette is two tokens, not a grey per author (Issue #760)', () => {
  const root = rulesFor(':root');
  assert.equal(root['--wv-hover-wash'], 'var(--wv-pill-hover)', 'one wash, the body colour the rest of the app already washes with');
  assert.equal(root['--wv-hover-border'], 'var(--tblr-secondary)', 'one hover grey');
  assert.match(root['--tblr-primary-darken'], /color-mix\(in oklab, var\(--tblr-primary\) 88%, black\)/,
    'a filled primary darkens one step; Tabler faded it to 80% alpha instead');
});

test('the quiet weight is one override and one rule (Issue #760)', () => {
  const ghost = rulesFor('.btn-ghost-secondary');
  assert.equal(ghost['--tblr-btn-hover-bg'], 'var(--wv-hover-wash)', 'every ghost button washes');
  assert.equal(ghost['--tblr-btn-hover-color'], 'var(--tblr-body-color)', 'and its glyph moves to body colour');
  assert.equal(ghost['--tblr-btn-hover-border-color'], 'transparent', 'a quiet button grows no border on hover');
  assert.equal(ghost['--tblr-btn-active-bg'], 'var(--wv-hover-wash)', 'and the pressed state matches the hover');

  const one = CSS.match(/:where\(([^)]*\.icon-btn[^{]*)\):hover \{([^}]*)\}/);
  assert.ok(one, 'the hand-rolled quiet classes share one :where(...):hover rule');
  for (const sel of QUIET) assert.ok(one[1].includes(sel), `${sel} is on the shared quiet rule`);
  assert.match(one[2], /background: var\(--wv-hover-wash\)/, 'the shared rule washes');
  assert.match(one[2], /color: var\(--tblr-body-color\)/, 'and moves the glyph to body colour');
});

test('no quiet class keeps a hover of its own, and the bordered weight reads the one grey (Issue #760)', () => {
  for (const sel of QUIET) {
    assert.deepEqual(Object.keys(rulesFor(`${sel}:hover`)), [], `${sel} wrote its own hover; the shared rule carries it now`);
  }
  const bordered = CSS.match(/:where\(([^)]*#nav-expand[^{]*)\):hover \{([^}]*)\}/);
  assert.ok(bordered, 'the bordered buttons share one :where(...):hover rule');
  for (const sel of BORDERED) assert.ok(bordered[1].includes(sel), `${sel} is on the shared bordered rule`);
  assert.match(bordered[2], /border-color: var\(--wv-hover-border\)/, 'and it darkens the border to the one grey');
  assert.doesNotMatch(CSS, /\.bug-fab[^{]*:hover[^}]*border-color: var\(--tblr-secondary\)/,
    'the floating bug button reads the token too, not the raw grey');
});

test('no hover fills a quiet button with an opaque block (Issue #760)', () => {
  const opaque = [...CSS.matchAll(/([^{}]*btn-ghost[^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /--tblr-btn-hover-bg:\s*var\(--tblr-secondary\)|--tblr-btn-hover-bg:\s*#|--tblr-btn-hover-bg:\s*rgb\(/.test(body))
    .map(([, sel]) => sel.trim());
  assert.deepEqual(opaque, [], 'a ghost button never hovers to a solid fill');
});
