import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const CANVAS = { light: 'rgb(236, 239, 243)', dark: 'rgb(15, 17, 21)' };
const UNPAINTED = 'rgba(0, 0, 0, 0)';

function lightness(colour) {
  const [r, g, b] = colour.match(/[\d.]+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const s = await launch('the theme at first paint', (weave) => {
  weave.createSpace({ name: 'Work' });
  weave.createTable({ space: 'Work', name: 'Task' });
});

async function booted(browser, base, { colorScheme, stored }) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
  await page.addInitScript((pref) => {
    if (pref) { try { localStorage.setItem('weave-theme', pref); } catch {} }
    window.__paint = { theme: 'unread', canvases: [] };
    const sample = () => {
      if (document.body) {
        const canvas = getComputedStyle(document.body).backgroundColor;
        if (window.__paint.canvases.at(-1) !== canvas) window.__paint.canvases.push(canvas);
      }
      if (document.readyState !== 'complete') requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive' || window.__paint.theme !== 'unread') return;
      window.__paint.theme = document.documentElement.getAttribute('data-bs-theme');
    });
  }, stored ?? null);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#nav');
  return page;
}

if (s) {
  const { base, browser } = s;
  for (const scheme of ['light', 'dark']) {
    test(`a ${scheme} system boot paints no frame of the other theme's canvas (Issue #1714)`, async () => {
      const page = await booted(browser, base, { colorScheme: scheme });
      try {
        const paint = await page.evaluate(() => window.__paint);
        assert.equal(paint.theme, scheme, `the document was still ${paint.theme} when parsing finished, so the deferred boot set the theme`);
        const wrong = paint.canvases.filter((c) => c !== UNPAINTED && (lightness(c) > 0.5) !== (scheme === 'light'));
        assert.deepEqual(wrong, [], `the canvas painted ${wrong.join(' then ')} on a ${scheme} boot`);
        assert.equal(paint.canvases.at(-1), CANVAS[scheme], 'the settled canvas is the themed one');
      } finally { await page.close(); }
    });
  }

  test('a stored light preference on a dark system paints light at once (Issue #1714)', async () => {
    const page = await booted(browser, base, { colorScheme: 'dark', stored: 'light' });
    try {
      const paint = await page.evaluate(() => window.__paint);
      assert.equal(paint.theme, 'light', `the stored preference was ignored until the boot ran: ${paint.theme}`);
      const wrong = paint.canvases.filter((c) => c !== UNPAINTED && lightness(c) <= 0.5);
      assert.deepEqual(wrong, [], `the canvas painted ${wrong.join(' then ')} although light was stored`);
      assert.equal(paint.canvases.at(-1), CANVAS.light, 'the settled canvas is the stored one');
    } finally { await page.close(); }
  });
}
