import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone crumb chips', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  const row = weave.createEntity(issues, { name: 'Looks broken: the layout breaks' });
  return { table: `#/table/${issues.id}`, docked: `#/table/${issues.id}?e=${row.id}` };
});

if (s) {
  const { base, browser, table, docked } = s;
  const open = async (hash, { width, theme = 'light' } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.crumb-row .crumb-cur');
    return page;
  };
  const crumbs = (page, scope) => page.evaluate((scope) => {
    const root = document.querySelector(scope);
    const chips = [...root.querySelectorAll('.crumb-row .crumb-slot:not([hidden]) .crumb-item')].filter((n) => n.getClientRects().length).map((n) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return {
        text: n.textContent.trim(), current: n.classList.contains('crumb-cur'),
        height: Math.round(r.height), radius: cs.borderTopLeftRadius, fill: cs.backgroundColor,
        weight: Number(cs.fontWeight), icon: !!n.querySelector('.crumb-ic, svg'), label: !!n.querySelector('.crumb-nm'),
      };
    });
    const menu = root.querySelector('.nav-menu')?.getBoundingClientRect();
    return { theme: document.documentElement.dataset.bsTheme, chips, menu: menu && [Math.round(menu.width), Math.round(menu.height)], scrollWidth: document.documentElement.scrollWidth, vw: innerWidth };
  }, scope);
  const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

  for (const theme of ['light', 'dark']) {
    for (const [where, hash, scope] of [['table page', table, '#main'], ['row page', docked, '#dock']]) {
      test(`on a phone every crumb on the ${where} is a 36px filled chip with an icon and a label, the current one bold (${theme}, Feature #270)`, async () => {
        const page = await open(hash, { theme });
        try {
          if (scope === '#dock') await page.waitForSelector('#dock:not([hidden]) .crumb-row .crumb-item');
          const seen = await crumbs(page, scope);
          assert.equal(seen.theme, theme);
          assert.ok(seen.chips.length >= (scope === '#dock' ? 1 : 2), `crumbs: ${JSON.stringify(seen.chips)}`);
          for (const c of seen.chips) {
            assert.equal(c.height, 36, `${c.text} is ${c.height}px tall`);
            assert.equal(c.radius, '18px', `${c.text} has an 18px radius`);
            assert.ok(!transparent(c.fill), `${c.text} has a surface fill`);
            assert.ok(c.icon && c.label, `${c.text} carries an icon and a label`);
          }
          const cur = seen.chips.filter((c) => c.current);
          assert.equal(cur.length, 1, 'one current crumb');
          assert.ok(cur[0].weight >= 700, `the current crumb is bold (${cur[0].weight})`);
          assert.ok(seen.chips.filter((c) => !c.current).every((c) => c.weight < cur[0].weight), 'and bolder than the rest');
          if (scope === '#main') assert.deepEqual(seen.menu, [44, 44], 'the menu button is a 44px circle');
          assert.ok(seen.scrollWidth <= seen.vw, `the page does not scroll sideways (${seen.scrollWidth})`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the crumbs stay plain links (Feature #270)', async () => {
    const page = await open(table, { width: 1280 });
    try {
      const seen = await crumbs(page, '#main');
      for (const c of seen.chips) {
        assert.ok(c.height < 30, `${c.text} keeps its desktop height (${c.height})`);
        assert.ok(transparent(c.fill), `${c.text} has no fill`);
      }
    } finally { await page.close(); }
  });
}
