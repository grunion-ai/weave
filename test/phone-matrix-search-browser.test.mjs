import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneMatrix, eachPhone, atRest, eventually } from './lib/browser.mjs';
import { seedDemo, openTable, openRecord, recordCoversScreen, topBar, stubKeyboard, WIDE } from './lib/phone-matrix.mjs';

const s = await launch('phone matrix search and bars', (weave) => seedDemo(weave));

const NO_BAR = 'the table has no phone search bar at this width';
const KEYBOARD_ON_17_PRO = 336;
const SCREEN_17_PRO = 874;

if (s) {
  const { base, browser, tasks, t4 } = s;
  const matrix = await phoneMatrix(browser);
  const phoneBar = (page) => page.isVisible('.phone-bar .phone-search');
  const openSearch = async (page) => {
    if (await phoneBar(page)) await page.tap('.phone-bar .phone-search');
    else await page.evaluate(() => openPalette());
    await page.waitForSelector('#cmdk #cmdk-input');
    await atRest(page.locator('#cmdk'));
  };

  test('the phone search sheet covers the top bar so more results fit (Issue #1379)', { todo: 'Issue #1379' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openTable(page, base, tasks);
      if (!(await phoneBar(page))) return NO_BAR;
      const bar = await page.locator('#main .nav-menu').boundingBox();
      await openSearch(page);
      const sheet = await page.locator('#cmdk').boundingBox();
      assert.ok(sheet.y <= bar.y, `the search sheet starts at ${Math.round(sheet.y)} px, below the top bar's menu button at ${Math.round(bar.y)} px`);
    });
  });

  test('the phone search sheet shows no keyboard key hints on a touch screen (Issue #1380)', { todo: 'Issue #1380' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openTable(page, base, tasks);
      await openSearch(page);
      const v = await page.evaluate(() => ({
        touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
        keys: [...document.querySelectorAll('#cmdk kbd')].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((k) => k.textContent.trim()),
      }));
      assert.ok(v.touch, 'the phone answers (hover: none) and (pointer: coarse)');
      assert.deepEqual(v.keys, [], `the search sheet draws key hints ${v.keys.join(' ')}`);
    });
  });

  test('with the keyboard up the New task sheet keeps its Name field and Create button above the keyboard (keyboard modeled, Issue #1386)', { todo: 'Issue #1386' }, async (t) => {
    await eachPhone(t, matrix, async (page, run) => {
      await page.addInitScript(stubKeyboard);
      await openTable(page, base, tasks);
      if (!(await page.isVisible('.phone-bar .phone-new'))) return NO_BAR;
      await page.tap('.phone-bar .phone-new');
      await page.waitForSelector('.new-row-sheet .new-row-name');
      await atRest(page.locator('.new-row-sheet'));
      const screen = run.phone.page.screen?.height ?? run.phone.page.viewport.height;
      const keyboard = Math.round((KEYBOARD_ON_17_PRO * screen) / SCREEN_17_PRO);
      await page.evaluate((h) => window.wvTestKeyboard(h), keyboard);
      const read = () => page.evaluate(() => {
        const room = window.visualViewport.height;
        const fits = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.top >= 0 && r.bottom <= room + 0.5; };
        return { name: fits('.new-row-name'), create: fits('.new-row-create'), focused: !!document.activeElement?.matches('.new-row-name') };
      });
      const want = { name: true, create: true, focused: true };
      const got = await eventually(read, want, { timeout: 3000 });
      const at = await page.evaluate(() => ({ room: Math.round(window.visualViewport.height), name: Math.round(document.querySelector('.new-row-name').getBoundingClientRect().bottom), create: Math.round(document.querySelector('.new-row-create').getBoundingClientRect().bottom) }));
      assert.deepEqual(got, want, `a ${keyboard} px keyboard leaves ${at.room} px of page, but the Name field ends at ${at.name} px and Create at ${at.create} px`);
    });
  });

  test('the phone record page keeps the bottom search bar while the keyboard is closed (Issue #1400)', { todo: 'Issue #1400' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      if (!(await recordCoversScreen(page))) return WIDE;
      const v = await page.evaluate(() => {
        const shown = [...document.querySelectorAll('.phone-search, [role="search"], button[aria-label^="Search"]')].filter((n) => {
          const r = n.getBoundingClientRect();
          if (!r.width || !r.height || r.top < innerHeight * 0.7) return false;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === n || n.contains(hit));
        });
        const bottom = [...document.querySelectorAll('button')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.top >= innerHeight * 0.7; })
          .filter((n) => { const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === n || n.contains(hit)); })
          .map((n) => n.textContent.trim() || n.getAttribute('aria-label') || n.title);
        return { search: shown.length, bottom };
      });
      assert.ok(v.search > 0, `the bottom of the record page holds ${v.bottom.map((b) => `"${b}"`).join(', ') || 'nothing'} and no search bar`);
    });
  });

  test('the phone top bar keeps the drawer and menu buttons in one place on table and record pages, with at most four buttons (Issue #1406)', { todo: 'Issue #1406' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      if (!(await recordCoversScreen(page))) return WIDE;
      const onRecord = (await topBar(page, 'body')).filter((b) => !b.location);
      await openTable(page, base, tasks);
      const onTable = (await topBar(page, 'body')).filter((b) => !b.location);
      const find = (bar, re) => bar.find((b) => re.test(b.cls));
      const where = (b) => (b ? `${Math.round(b.left)} px` : 'missing');
      const problems = [];
      for (const [name, re] of [['drawer', /\bnav-menu\b/], ['menu dots', /\bdots-btn\b/]]) {
        const a = find(onTable, re), b = find(onRecord, re);
        if (!a || !b || Math.abs(a.left - b.left) > 1) problems.push(`the ${name} button sits at ${where(a)} on the table and ${where(b)} on the record`);
      }
      for (const [page_, bar] of [['table', onTable], ['record', onRecord]]) {
        if (bar.length > 4) problems.push(`the ${page_} top bar holds ${bar.length} buttons: ${bar.map((b) => b.label).join(', ')}`);
      }
      assert.deepEqual(problems, [], problems.join('; '));
    });
  });
}
