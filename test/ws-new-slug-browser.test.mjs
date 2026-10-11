import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
await import('../public/slug-core.js');
const { COPY, fill } = globalThis.WeaveSlugs;

const s = await launch('new workspace address', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

if (s) {
  const { base, browser, weave } = s;
  const taken = weave.state.meta.name;

  const open = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#ws-new svg');
    await page.click('#ws-new');
    await page.waitForSelector('#modal input[name="slug"]');
    return page;
  };
  const read = (page) => page.evaluate(() => {
    const m = document.querySelector('#modal');
    const chips = m.querySelector('.ws-slug-chips');
    return {
      slug: m.querySelector('input[name="slug"]').value,
      placeholder: m.querySelector('input[name="slug"]').placeholder,
      state: m.querySelector('.ws-slug-status').dataset.state,
      status: m.querySelector('.ws-slug-status').textContent,
      chips: chips.hidden ? null : [...chips.querySelectorAll('button')].map((b) => b.textContent),
      disabled: m.querySelector('button[type="submit"]').disabled,
      submit: m.querySelector('button[type="submit"]').textContent,
    };
  });
  const settledOn = (page, state) => page.waitForFunction((st) => document.querySelector('#modal .ws-slug-status')?.dataset.state === st, state);

  for (const theme of ['light', 'dark']) {
    test(`new workspace: the address follows the name, is checked, and Create waits for available (${theme})`, async () => {
      const page = await open(theme);
      try {
        assert.deepEqual(await read(page), { slug: '', placeholder: '', state: '', status: '', chips: null, disabled: true, submit: COPY.submit });
        await page.fill('#modal input[name="name"]', 'Harbor Launch');
        await settledOn(page, 'available');
        const ok = await read(page);
        assert.deepEqual([ok.slug, ok.status, ok.disabled, ok.chips], ['harbor-launch', fill(COPY.availableNoBase, { slug: 'harbor-launch' }), false, null]);

        await page.fill('#modal input[name="slug"]', 'weave');
        await settledOn(page, 'reserved');
        const reserved = await read(page);
        assert.deepEqual([reserved.status, reserved.disabled], [fill(COPY.reserved, { slug: 'weave' }), true]);
        assert.deepEqual(reserved.chips, [COPY.chips.team, COPY.chips.project, COPY.chips.mascot], 'no account name, so no own-name chip');

        await page.fill('#modal input[name="slug"]', taken);
        await settledOn(page, 'taken');
        assert.equal((await read(page)).status, fill(COPY.taken, { slug: taken }));

        await page.fill('#modal input[name="slug"]', 'Bad Slug');
        await settledOn(page, 'invalid');
        assert.equal((await read(page)).status, COPY.invalid);

        await page.fill('#modal input[name="slug"]', taken);
        await settledOn(page, 'taken');
        await page.click(`#modal .ws-slug-chip[data-kind="mascot"]`);
        const chip = await read(page);
        assert.deepEqual([chip.slug, chip.placeholder, chip.disabled], ['', COPY.placeholders.mascot, true]);
        assert.equal(await page.evaluate(() => document.activeElement.name), 'slug', 'the chip focuses the address');
        await page.fill('#modal input[name="name"]', 'Otter Works');
        assert.equal((await read(page)).slug, '', 'an address the person touched no longer follows the name');
      } finally { await page.close(); }
    });
  }
}
