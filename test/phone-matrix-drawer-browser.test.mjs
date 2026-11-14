import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneMatrix, eachPhone, settled } from './lib/browser.mjs';
import { seedDemo, openTable } from './lib/phone-matrix.mjs';

const s = await launch('phone matrix drawer', (weave) => seedDemo(weave));

if (s) {
  const { base, browser, tasks } = s;
  const matrix = await phoneMatrix(browser);

  const openDrawer = async (page, { untouched = false } = {}) => {
    await openTable(page, base, tasks);
    if (untouched) {
      await page.evaluate(() => {
        document.activeElement?.blur();
        document.querySelector('#main .nav-menu').click();
      });
    } else await page.tap('#main .nav-menu');
    await page.waitForSelector('#app.nav-peek.nav-held #sidebar #nav a.nav-db');
    await settled(page.locator('#sidebar'));
    await page.waitForFunction(() => document.activeElement !== document.body && !!document.activeElement?.closest('#sidebar, #ws-rail'), null, { timeout: 3000 }).catch(() => {});
  };

  test('every table row in the phone drawer carries its icon (Issue #1394)', async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openDrawer(page);
      const rows = await page.evaluate(() => [...document.querySelectorAll('#nav a.nav-db')].map((a) => {
        const icon = a.querySelector('.nav-icon');
        const r = icon?.getBoundingClientRect();
        return { name: a.textContent.trim(), icon: !!r && r.width > 0 && r.height > 0 };
      }));
      const bare = rows.filter((r) => !r.icon).map((r) => r.name);
      assert.deepEqual(bare, [], `these drawer rows draw no icon: ${bare.join(', ')}`);
    });
  });

  test('the phone drawer uses one inset for its rules and rows, + New space at row size, and one menu icon (Issue #1395)', { todo: 'Issue #1395' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openDrawer(page);
      const d = await page.evaluate(() => {
        const box = (n) => { const r = n.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; };
        const ruled = (n) => {
          const c = getComputedStyle(n);
          return parseFloat(c.borderTopWidth) > 0 && c.borderTopStyle !== 'none' && !/,\s*0\)$|transparent/.test(c.borderTopColor);
        };
        const rules = [...document.querySelectorAll('#sidebar *')].filter((n) => n.getBoundingClientRect().width > 100 && ruled(n))
          .map((n) => ({ cls: n.className, ...box(n) }));
        const add = [...document.querySelectorAll('#sidebar .nav-foot button')].find((b) => /New space/.test(b.textContent));
        const icons = [...document.querySelectorAll('#sidebar .dots-btn .wv-icon, #sidebar .nav-identity-more .wv-icon')]
          .filter((n) => n.getBoundingClientRect().width > 0)
          .map((n) => [...n.classList].find((c) => /^mi-/.test(c)));
        return {
          rules,
          add: add && { size: getComputedStyle(add).fontSize, left: Math.round(add.getBoundingClientRect().left) },
          row: getComputedStyle(document.querySelector('#nav a.nav-db')).fontSize,
          space: Math.round(document.querySelector('#nav .nav-space').getBoundingClientRect().left),
          icons: [...new Set(icons)],
        };
      });
      const edges = [...new Set(d.rules.map((r) => `${r.left}-${r.right}`))];
      assert.ok(edges.length <= 1, `the drawer rules run between ${edges.length} different pairs of edges: ${d.rules.map((r) => `${r.cls} ${r.left} to ${r.right}`).join('; ')}`);
      assert.ok(d.add, 'the drawer offers + New space');
      assert.equal(d.add.size, d.row, `+ New space is set at ${d.add.size} while the table rows are ${d.row}`);
      assert.ok(Math.abs(d.add.left - d.space) <= 1, `+ New space starts at ${d.add.left} px while the space headers start at ${d.space} px`);
      assert.equal(d.icons.length, 1, `the drawer menus use ${d.icons.length} different icons: ${d.icons.join(', ')}`);
    });
  });

  test('opening the phone drawer by tap moves focus without drawing a focus ring on the workspace name (Issue #1396)', { todo: 'Issue #1396' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openDrawer(page, { untouched: true });
      const focus = await page.evaluate(() => {
        const a = document.activeElement;
        return { what: a === document.body ? 'body' : `${a.tagName.toLowerCase()}#${a.id}.${a.className}`, ring: a !== document.body && a.matches(':focus-visible') };
      });
      assert.equal(focus.ring, false, `after a tap that leaves the menu button unfocused, as iOS does, the drawer puts a visible focus ring on ${focus.what}`);
    });
  });
}
