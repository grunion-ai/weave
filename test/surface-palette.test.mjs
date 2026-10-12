import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SURFACES = {
  canvas: { light: '#eceff3', dark: '#0f1115' },
  panel: { light: '#ffffff', dark: '#181b21' },
  sunk: { light: '#e2e6ec', dark: '#222731' },
  divider: { light: '#d9dee6', dark: '#2a2f38' },
};
const RETIRED = ['#f3f1ec', '#fafaf8', '#132444', '#1a2d54', '#24375e', '#e6e3dc', '#0f1e39', '#efece5'];
const APP_FILES = ['public/style.css', 'src/applet.js', 'src/auth-page.js'];

const themeBlock = (css, theme) => {
  const start = css.indexOf(theme === 'light' ? ':root, [data-bs-theme="light"] {' : '[data-bs-theme="dark"] {');
  assert.ok(start >= 0, `style.css has a ${theme} theme block`);
  return css.slice(start, css.indexOf('\n}', start));
};

test('brand/README.md Surfaces table carries the same hexes the app uses', () => {
  const readme = read('brand/README.md');
  const section = readme.slice(readme.indexOf('## Surfaces'), readme.indexOf('## Assets'));
  for (const [name, { light, dark }] of Object.entries(SURFACES)) {
    assert.ok(section.includes(`\`${light}\``), `README surfaces lists ${name} light ${light}`);
    assert.ok(section.includes(`\`${dark}\``), `README surfaces lists ${name} dark ${dark}`);
  }
});

test('public/style.css resolves canvas, panel, sunk and divider to the slate table per theme', () => {
  const css = read('public/style.css');
  const light = themeBlock(css, 'light');
  const dark = themeBlock(css, 'dark');
  assert.ok(light.includes(`--wv-canvas: ${SURFACES.canvas.light};`));
  assert.ok(light.includes(`--tblr-bg-surface: ${SURFACES.panel.light};`));
  assert.ok(light.includes(`--tblr-bg-surface-secondary: ${SURFACES.sunk.light};`));
  assert.ok(light.includes(`--tblr-border-color: ${SURFACES.divider.light};`));
  assert.ok(dark.includes(`--wv-canvas: ${SURFACES.canvas.dark};`));
  assert.ok(dark.includes(`--tblr-bg-surface: ${SURFACES.panel.dark};`));
  assert.ok(dark.includes(`--tblr-bg-surface-secondary: ${SURFACES.sunk.dark};`));
  assert.ok(dark.includes(`--tblr-border-color: ${SURFACES.divider.dark};`));
});

test('the applet and the auth page ground on the same canvas and panel', () => {
  for (const file of ['src/applet.js', 'src/auth-page.js']) {
    const src = read(file);
    assert.ok(src.includes(`--ground:${SURFACES.canvas.light}; --surface:${SURFACES.panel.light};`), `${file} light ground + surface`);
    assert.ok(src.includes(`--ground:${SURFACES.canvas.dark}; --surface:${SURFACES.panel.dark};`), `${file} dark ground + surface`);
  }
  const applet = read('src/applet.js');
  assert.ok(applet.includes(`<meta name="theme-color" content="${SURFACES.canvas.light}"`));
  assert.ok(applet.includes(`<meta name="theme-color" content="${SURFACES.canvas.dark}"`));
});

test('no app file paints a retired Kami surface hex', () => {
  for (const file of APP_FILES) {
    const src = read(file).toLowerCase();
    for (const hex of RETIRED) assert.ok(!src.includes(hex), `${file} still carries ${hex}`);
  }
});

test('the rope keeps its strands on every surface', () => {
  const index = read('public/index.html');
  assert.ok(index.includes('stroke="#2563eb"'), 'blue lead strand');
  assert.ok(index.includes('stroke="#0c1b33"'), 'ink second strand in light');
  assert.ok(index.includes('stroke="#60a5fa"'), 'sky second strand in dark');
});
