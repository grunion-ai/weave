import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE ??= join(tempDir('weave-csp-browser-'), 'keystore.json');
const { launch, eventually } = await import('../lib/browser.mjs');

const TOKEN = 'csp-count-reader-token-0123456789abcdef';
const ctx = await launch('csp report sink', () => {}, { server: () => ({ deployToken: TOKEN }) });
if (ctx) {
  const { base, browser } = ctx;
  const counts = async () => (await fetch(`${base}/_supervisor/csp`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();

  test('a frame, object, base and form the app page refuses each reach the sink once as blocked, and an inline script as reported', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/`);
      const fired = page.evaluate(() => new Promise((resolve) => {
        const seen = new Set();
        addEventListener('securitypolicyviolation', (e) => {
          if (e.disposition === 'enforce') seen.add(e.effectiveDirective);
          if (seen.size === 4) resolve([...seen].sort());
        });
      }));
      await page.evaluate(() => {
        const object = document.createElement('object');
        object.data = '/brand/favicon.ico';
        document.body.append(object);
        const frame = document.createElement('iframe');
        frame.src = 'https://frames.invalid/';
        document.body.append(frame);
        const base = document.createElement('base');
        base.href = 'https://base.invalid/';
        document.head.append(base);
        const script = document.createElement('script');
        script.textContent = 'window.inlineRan = true';
        document.body.append(script);
        const form = document.createElement('form');
        form.method = 'post';
        form.action = 'https://forms.invalid/';
        document.body.append(form);
        form.submit();
      });
      assert.deepEqual(await fired, ['base-uri', 'form-action', 'frame-src', 'object-src']);
      assert.equal(await page.evaluate(() => window.inlineRan), true, 'an inline script is only reported, so it still runs');
      const want = { blocked: { 'base-uri': 1, 'form-action': 1, 'frame-src': 1, 'object-src': 1 }, inlineScriptReported: true };
      const read = async () => { const c = await counts(); return { blocked: c.blocked, inlineScriptReported: (c.reported['script-src-elem'] ?? 0) > 0 }; };
      assert.deepEqual(await eventually(read, want), want);
    } finally { await page.close(); }
  });
}
