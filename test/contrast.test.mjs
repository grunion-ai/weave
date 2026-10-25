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
