export const PANE = '#view-pane';

export function paneOnLoad(page, section = 'display') {
  return page.addInitScript((sec) => {
    try { localStorage.setItem('weave-view-pane', 'open'); localStorage.setItem('weave-view-pane-section', sec); } catch {}
  }, section);
}

export async function tableDrawn(page) {
  await page.waitForFunction(() => document.querySelector('#main .table-view-btn') && document.querySelector('#main')?.wvDraw?.db?.id === state.route?.dbId);
}

export async function openPane(page, section = null) {
  await tableDrawn(page);
  if (!await page.locator('#view-pane:not([hidden]) .vp-acc').count()) await page.click('#main .table-view-btn');
  await page.waitForSelector('#view-pane:not([hidden]) .vp-acc');
  if (section) {
    const acc = page.locator(`#view-pane .vp-acc[data-section="${section}"]`);
    if (await acc.getAttribute('aria-expanded') !== 'true') await acc.click();
    await page.waitForSelector(`#view-pane #vp-body-${section}`);
  }
  return page.locator(PANE);
}

export async function openViews(page) {
  await openPane(page);
  if (await page.getAttribute('#view-pane .vp-view-pick', 'aria-expanded') !== 'true') await page.click('#view-pane .vp-view-pick');
  await page.waitForSelector('#view-pane .view-strip');
  return page.locator(PANE);
}

export async function closePane(page) {
  if (await page.locator('#view-pane:not([hidden])').count()) await page.click('#view-pane .vp-close');
  await page.waitForSelector('#view-pane', { state: 'hidden' });
}

export async function sortBy(page, field, dir = null) {
  await openPane(page, 'sort');
  const level = page.locator(`#view-pane .sort-level[data-level="${field}"]`);
  if (!await level.count()) {
    for (let n = await page.locator('#view-pane .sort-level').count(); n > 0; n--) {
      await page.locator('#view-pane .sort-remove').first().click();
      await page.waitForFunction((k) => document.querySelectorAll('#view-pane .sort-level').length === k - 1, n);
    }
    await page.click('#view-pane .sort-add');
    await page.locator('.picker-pop .picker-row').filter({ has: page.locator('.picker-label', { hasText: new RegExp(`^${field}$`) }) }).first().click();
    await page.waitForSelector(`#view-pane .sort-level[data-level="${field}"]`);
  }
  if (dir) {
    await page.locator(`#view-pane .sort-level[data-level="${field}"] .sort-dir .seg-opt`, { hasText: dir }).click();
    await page.waitForSelector(`#view-pane .sort-level[data-level="${field}"] .sort-dir .seg-opt.on:text-is("${dir}")`);
  }
}
