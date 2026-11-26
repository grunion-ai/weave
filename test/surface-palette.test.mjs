import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
const APP_FILES = [
  'public/style.css', 'public/chip.css', 'public/status.css', 'public/status.html', 'public/billing.html', 'public/404.html', 'public/start.html',
  'src/applet.js', 'src/auth-page.js', 'src/markdown.js', 'src/mail.js',
];
const RETIRED_INK_RGB = /rgba?\(\s*12\s*,\s*27\s*,\s*51\b/i;

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

test('no app file paints the retired Kami ink #0c1b33 in its rgb form (Issue #1717)', () => {
  assert.ok(RETIRED_INK_RGB.test('box-shadow: 0 1px 2px rgba(12, 27, 51, .25)'));
  assert.ok(RETIRED_INK_RGB.test('rgb(12,27,51)'));
  assert.ok(!RETIRED_INK_RGB.test('rgba(15, 23, 42, .25)'));
  for (const file of APP_FILES) {
    const lines = read(file).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => RETIRED_INK_RGB.test(l));
    assert.deepEqual(lines.map(([n]) => `${file}:${n}`), [], `${file} still carries the retired ink as rgba`);
  }
});

test('every --wv-* custom property defined in public/style.css is read by the app (Issue #1717)', () => {
  const css = read('public/style.css');
  const defined = new Set([...css.matchAll(/(--wv-[\w-]+)\s*:/g)].map((m) => m[1]));
  const spacingStep = /^--wv-space-\d+$/;
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const sources = [...walk('public'), ...walk('src')].filter((f) => /\.(css|js|mjs|html)$/.test(f)).map(read).join('\n');
  const readers = (name) => sources.includes(`var(${name})`) || sources.includes(`var(${name},`) || sources.includes(`'${name}'`) || sources.includes(`"${name}"`);
  const unread = [...defined].filter((name) => !spacingStep.test(name) && !readers(name));
  assert.deepEqual(unread, [], 'tokens defined but never read');
});

test('the rope keeps its strands on every surface', () => {
  const index = read('public/index.html');
  assert.ok(index.includes('stroke="#2563eb"'), 'blue lead strand');
  assert.ok(index.includes('stroke="#0c1b33"'), 'ink second strand in light');
  assert.ok(index.includes('stroke="#60a5fa"'), 'sky second strand in dark');
});
