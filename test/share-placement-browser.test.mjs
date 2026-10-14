import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted } from './lib/browser.mjs';

let space, task, one, view;
const s = await launch('share placement', (weave) => {
  space = weave.createSpace({ name: 'Dev' });
  task = weave.createTable({ space: 'Dev', name: 'Task' });
  one = weave.createEntity(task.id, { name: 'One' });
  view = weave.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
});

if (s) {
  const { base, browser } = s;
  const kinds = () => [
    { kind: 'space', hash: `#/space/${space.id}`, ready: '#main .view-header', header: '#main .view-header', dots: '#main .view-header .dots-btn' },
    { kind: 'share page', hash: `#/view/${view.id}`, ready: '#main .share-page-head', header: '#main .share-page-head', dots: '#main .share-page-head .dots-btn' },
    { kind: 'table', hash: `#/table/${task.id}`, ready: '#main .wv-grid tbody tr.entity-row', header: '#main .view-header', dots: '#main .view-header .dots-btn' },
    { kind: 'record', hash: `#/entity/${one.id}`, ready: '#main .entity-head', header: '#main .view-header .crumb-actions', dots: '#main .view-header .crumb-actions .dots-btn' },
  ];

  test('on a phone the header button gives way to the Share… row on the sheet (Issue #765)', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/#/table/${task.id}?e=${one.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
    assert.equal(await page.locator('.share-btn:visible').count(), 0, 'no Share button crowds the phone row header');
    await page.click('#dock .crumb-row .dots-btn');
    await painted(page, '.wv-menu');
    const rows = await page.locator('.wv-menu .wv-menu-label, .wv-menu .hold-label').evaluateAll((ns) => ns.filter((n) => n.getClientRects().length).map((n) => n.textContent.trim()));
    assert.ok(rows.includes('Share…'), `the phone sheet offers Share…: ${rows.join(' | ')}`);
    await page.keyboard.press('Escape');
    await page.goto(`${base}/#/space/${space.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .view-header');
    assert.equal(await page.locator('.share-btn:visible').count(), 0, 'nor on the phone space header');
    await page.click('#main .view-header .dots-btn');
    await painted(page, '.wv-menu');
    const spaceRows = await page.locator('.wv-menu .wv-menu-label, .wv-menu .hold-label').evaluateAll((ns) => ns.filter((n) => n.getClientRects().length).map((n) => n.textContent.trim()));
    assert.ok(spaceRows.includes('Share…'), `a phone keeps Share… on the space sheet too: ${spaceRows.join(' | ')}`);
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    for (const k of kinds()) {
      test(`the ${k.kind} header carries the one Share button and its menu carries no Share row in ${theme} (Issue #765)`, async () => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`${base}/${k.hash}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(k.ready);
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        assert.equal(await page.locator(`${k.header} .share-btn`).count(), 1, `one Share button in the ${k.kind} header`);
        assert.equal(await page.locator(`${k.header} .share-btn`).first().textContent(), 'Share…');
        await page.locator(k.dots).first().click();
        await painted(page, '.wv-menu');
        const rows = await page.locator('.wv-menu .wv-menu-row').allTextContents();
        assert.equal(rows.some((r) => r.trim().startsWith('Share…')), false, `the ${k.kind} menu still offers Share…: ${rows.join(' | ')}`);
        await page.keyboard.press('Escape');
        await page.locator(`${k.header} .share-btn`).first().click();
        await painted(page, '#modal');
        assert.match(await page.locator('#modal h2').textContent(), /Share/, 'the button opens the share dialog');
        await page.close();
      });
    }
  }
}
