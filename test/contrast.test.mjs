import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
};

const tokensOf = (css) => Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)].map((m) => [m[1], m[2]]));

const DARK_AT = '@media (prefers-color-scheme: dark)';
const billingThemes = () => {
  const html = read('public/billing.html');
  const cut = html.indexOf(DARK_AT);
  return { light: tokensOf(html.slice(0, cut)), dark: tokensOf(html.slice(cut)) };
};

test('the billing page reads its muted text at 4.5:1 on both the canvas and the card (Issue #1097)', () => {
  for (const [theme, tokens] of Object.entries(billingThemes())) {
    for (const ground of ['--bg', '--card']) {
      const r = ratio(tokens['--muted'], tokens[ground]);
      assert.ok(r >= 4.5, `billing ${theme}: muted ${tokens['--muted']} on ${ground} ${tokens[ground]} reads ${r}:1`);
    }
  }
});

const APP_THEMES = () => {
  const css = read('public/style.css');
  const block = (head) => css.slice(css.indexOf(head), css.indexOf('\n}', css.indexOf(head)));
  return { light: tokensOf(block(':root, [data-bs-theme="light"] {')), dark: tokensOf(block('[data-bs-theme="dark"] {')) };
};

const textMutedToken = () => {
  const rule = read('public/style.css').match(/\.text-muted\s*\{[^}]*color:\s*var\((--[\w-]+)\)/);
  return rule ? rule[1] : null;
};

test('app muted text reads 4.5:1 on the panel and the sunk surface in both themes (Issue #1098)', () => {
  const token = textMutedToken();
  assert.ok(token, '.text-muted takes a weave theme token, not the vendored fixed grey');
  for (const [theme, tokens] of Object.entries(APP_THEMES())) {
    for (const ground of ['--tblr-bg-surface', '--tblr-bg-surface-secondary']) {
      const r = ratio(tokens[token], tokens[ground]);
      assert.ok(r >= 4.5, `${theme}: ${token} ${tokens[token]} on ${ground} ${tokens[ground]} reads ${r}:1`);
    }
  }
});

const VENDOR = tokensOf(read('public/vendor/tabler.min.css'));

test('danger labels read 4.5:1 on the panel in both themes (Issue #1099)', () => {
  for (const [theme, tokens] of Object.entries(APP_THEMES())) {
    const danger = tokens['--tblr-danger'] ?? VENDOR['--tblr-danger'];
    const r = ratio(danger, tokens['--tblr-bg-surface']);
    assert.ok(r >= 4.5, `${theme}: danger ${danger} on the panel ${tokens['--tblr-bg-surface']} reads ${r}:1`);
  }
});

await import('../public/chip-core.js');
const core = globalThis.chipCore;

const chipPaints = () => {
  const out = { light: {}, dark: {} };
  for (const m of read('public/chip.css').matchAll(/(\[data-bs-theme="dark"\]\s+)?\.hue-([\w-]+)\s*\{([^}]*)\}/g)) {
    const fill = m[3].match(/--fill:\s*rgba\(([^)]+)\)/);
    const text = m[3].match(/--text:\s*(#[0-9a-fA-F]{3,8})/);
    if (fill && text) out[m[1] ? 'dark' : 'light'][m[2]] = { fill: fill[1].split(',').map(Number), text: text[1] };
  }
  return out;
};

const hexOf = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const composite = ([r, g, b, a], groundHex) => {
  const h = groundHex.trim().replace('#', '');
  const ground = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return hexOf([r, g, b].map((v, i) => v * a + ground[i] * (1 - a)));
};

test('the done state chip reads 4.5:1 on its own tint in both themes (Issue #1100)', () => {
  const paints = chipPaints();
  const hue = core.categoryHue('done');
  const themes = APP_THEMES();
  for (const theme of ['light', 'dark']) {
    const paint = paints[theme][hue] ?? paints.light[hue];
    assert.ok(paint, `chip.css paints the ${hue} hue for ${theme}`);
    const tint = composite(paint.fill, themes[theme]['--tblr-bg-surface']);
    const r = ratio(paint.text, tint);
    assert.ok(r >= 4.5, `${theme}: done chip text ${paint.text} on its tint ${tint} reads ${r}:1`);
  }
});
