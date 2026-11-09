import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled, atRest, phoneBrowser, phonePage } from './lib/browser.mjs';

const MANY = Array.from({ length: 12 }, (_, i) => `Area ${i + 1}`);

const s = await launch('phone picker sheets', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Area', type: 'select', config: { options: MANY } });
  const row = weave.createEntity(issues, { name: 'Looks broken', values: { Status: 'Open', Area: 'Area 1' } });
  return { docked: `#/table/${issues.id}?e=${row.id}` };
});

if (s) {
  const { base, browser, docked } = s;
  const open = async ({ width, theme = 'light' } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${docked}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .chip-trigger[title="Status"]');
    return page;
  };
  const pop = async (page) => { await settled(page.locator('.picker-pop')); return page.evaluate(() => {
    const p = document.querySelector('.picker-pop');
    const r = p.getBoundingClientRect();
    const input = p.querySelector('.picker-search');
    return {
      theme: document.documentElement.dataset.bsTheme,
      left: r.left, right: r.right, bottom: Math.round(r.bottom), top: r.top,
      rows: [...p.querySelectorAll('.picker-row')].map((n) => Math.round(n.getBoundingClientRect().height)),
      typing: document.activeElement === input,
      boxShown: !!input && input.getClientRects().length > 0,
      vw: innerWidth, vh: innerHeight,
    };
  }); };

  const dragSheet = async (page, sel, dy, { step = 40 } = {}) => {
    const box = await page.locator(`${sel} .sheet-grip`).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) {
      await page.waitForTimeout(step);
      await page.mouse.move(x, y + (dy * i) / 6);
    }
    await page.mouse.up();
  };

  const flickSheet = async (page, sel, dy) => {
    await atRest(page.locator(sel));
    await page.evaluate((q) => {
      globalThis.wvFlick = null;
      const mark = (e) => {
        if (e.type === 'pointerdown') globalThis.wvFlick = { at: e.timeStamp, last: e.timeStamp };
        else if (globalThis.wvFlick) globalThis.wvFlick.last = e.timeStamp;
      };
      for (const type of ['pointerdown', 'pointermove']) {
        document.querySelector(`${q} .sheet-grip`).addEventListener(type, mark, { capture: true });
      }
    }, sel);
    const box = await page.locator(`${sel} .sheet-grip`).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy);
    await page.mouse.up();
    const seen = await page.evaluate(() => globalThis.wvFlick);
    return Math.max(1, Math.round((seen?.last ?? 0) - (seen?.at ?? 0)));
  };

  const openPicker = async (page) => {
    await page.click('#dock .chip-trigger[title="Status"]');
    await page.waitForSelector('.picker-pop .sheet-grip');
    await atRest(page.locator('.picker-pop'));
    return (await page.locator('.picker-pop').boundingBox()).height;
  };

  test('a flick of a fifth of the picker sheet dismisses it, and a slow drag that far springs it back (Issue #1110)', async () => {
    const page = await open({ width: 390 });
    try {
      const was = await page.textContent('#dock .chip-trigger[title="Status"]');
      let h = await openPicker(page);
      await dragSheet(page, '.picker-pop', Math.round(h * 0.2), { step: 60 });
      await atRest(page.locator('.picker-pop'));
      assert.ok(await page.isVisible('.picker-pop'),
        'a fifth of the sheet is a dismissal only when the finger moves fast, so a slow drag that far springs back');
      assert.equal(await page.locator('.picker-pop').evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).isIdentity), true);
      const reach = Math.round(h * 0.2);
      const budget = Math.round(reach / 0.5);
      const spans = [];
      let standing = true;
      for (let i = 0; i < 3 && standing; i += 1) {
        spans.push(await flickSheet(page, '.picker-pop', reach));
        standing = (await page.locator('.picker-pop').count()) > 0;
      }
      assert.equal(standing, false,
        `a ${reach}px flick, a fifth of the sheet and under its one-third threshold, left it standing after ${spans.length} tries: the harness delivered them over ${spans.join(', ')} ms and a flick has under ${budget} ms`);
      assert.equal(await page.textContent('#dock .chip-trigger[title="Status"]'), was, 'flicking it away changes nothing');
    } finally { await page.close(); }
  });

  test('the picker sheet dismisses when the last movement arrives with the release, not as a move (Issue #1064)', async () => {
    const page = await open({ width: 390 });
    try {
      const was = await page.textContent('#dock .chip-trigger[title="Status"]');
      const h = await openPicker(page);
      const box = await page.locator('.picker-pop .sheet-grip').boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.evaluate(() => {
        globalThis.wvGripPointer = null;
        document.querySelector('.picker-pop .sheet-grip')
          .addEventListener('pointerdown', (e) => { globalThis.wvGripPointer = e.pointerId; }, { capture: true });
      });
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i += 1) {
        await page.waitForTimeout(150);
        await page.mouse.move(x, y + (h * 0.12 * i) / 6);
      }
      await page.waitForSelector('.picker-pop.sheet-dragging');
      await page.evaluate(({ at, to }) => {
        document.querySelector('.picker-pop .sheet-grip').dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true,
          pointerId: globalThis.wvGripPointer, button: 0, buttons: 0, clientX: at, clientY: to,
        }));
      }, { at: x, to: y + h * 0.5 });
      await page.mouse.up();
      await page.waitForSelector('.picker-pop', { state: 'detached' });
      assert.equal(await page.textContent('#dock .chip-trigger[title="Status"]'), was, 'dragging it away changes nothing');
    } finally { await page.close(); }
  });

  test('atRest waits for a transform that has not started yet (Issue #901)', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const n = document.createElement('div');
        n.id = 'rest-probe';
        n.style.cssText = 'position:fixed;left:0;bottom:0;width:80px;height:80px;background:#000;transform:translateY(40px)';
        document.body.append(n);
        let frames = 6;
        const tick = () => (frames-- > 0 ? requestAnimationFrame(tick) : (n.style.transition = 'transform 300ms linear', n.style.transform = ''));
        tick();
      });
      await settled(page.locator('#rest-probe'));
      await atRest(page.locator('#rest-probe'));
      assert.equal(await page.locator('#rest-probe').evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).isIdentity), true,
        'the probe starts its transition six frames after the wait begins, so an empty animation set is not rest');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`the picker sheet grabber follows the finger and dismisses past a third (${theme}, Issue #808)`, async () => {
      const page = await open({ theme });
      try {
        const was = await page.textContent('#dock .chip-trigger[title="Status"]');
        await page.click('#dock .chip-trigger[title="Status"]');
        await page.waitForSelector('.picker-pop .sheet-grip');
        await atRest(page.locator('.picker-pop'));
        const grip = await page.locator('.picker-pop .sheet-grip').boundingBox();
        assert.ok(Math.round(grip.height) >= 44, `the grabber is a real target, got ${Math.round(grip.height)}px tall`);
        const h = (await page.locator('.picker-pop').boundingBox()).height;

        await dragSheet(page, '.picker-pop', h * 0.12);
        await atRest(page.locator('.picker-pop'));
        assert.ok(await page.isVisible('.picker-pop'), 'a short, slow drag springs the picker back');
        assert.equal(await page.evaluate(() => document.querySelector('.picker-pop').style.transform), '',
          'and leaves no transform behind');
        assert.equal(await page.locator('.picker-pop').evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).isIdentity), true,
          'the sheet is back at rest before the next drag');

        await dragSheet(page, '.picker-pop', h * 0.5);
        await page.waitForSelector('.picker-pop', { state: 'detached' });
        assert.equal(await page.textContent('#dock .chip-trigger[title="Status"]'), was,
          'dragging the picker away changes nothing');
      } finally { await page.close(); }
    });


    test(`on a phone a short picker opens as a bottom sheet of 56px options without the keyboard (${theme}, Feature #274)`, async () => {
      const page = await open({ theme });
      try {
        await page.click('#dock .chip-trigger[title="Status"]');
        await page.waitForSelector('.picker-pop .picker-row');
        const p = await pop(page);
        assert.equal(p.theme, theme);
        assert.deepEqual([p.left, p.right, p.bottom], [0, p.vw, p.vh], 'the sheet spans the bottom of the screen');
        assert.ok(p.rows.length >= 3 && p.rows.every((h) => h >= 56), `every option is 56px: ${p.rows}`);
        assert.equal(p.typing, false, 'the text box does not take focus, so no keyboard');
        assert.equal(p.boxShown, false, 'and a short list shows no text box');
        await page.click('.picker-pop .picker-row:has-text("In Progress")');
        await page.waitForSelector('.picker-pop', { state: 'detached' });
        await page.waitForFunction(() => document.querySelector('#dock .chip-trigger[title="Status"]')?.textContent.includes('In Progress'));
      } finally { await page.close(); }
    });
  }

  test('on a phone a long picker keeps its search box and focuses it (Feature #274)', async () => {
    const page = await open();
    try {
      await page.click('#dock .chip-trigger[title="Area"]');
      await page.waitForSelector('.picker-pop .picker-row');
      const p = await pop(page);
      assert.deepEqual([p.left, p.right, p.bottom], [0, p.vw, p.vh], 'it is a bottom sheet too');
      assert.ok(p.typing && p.boxShown, 'with the search box focused for 12 options');
      assert.ok(p.top >= 60, `the sheet leaves the top of the screen clear (${p.top})`);
    } finally { await page.close(); }
  });

  test('on a desktop the picker stays anchored to its chip with the search box focused (Feature #274)', async () => {
    const page = await open({ width: 1280 });
    try {
      await page.click('#dock .chip-trigger[title="Status"]');
      await page.waitForSelector('.picker-pop .picker-row');
      const p = await pop(page);
      assert.ok(p.left > 0 && p.right - p.left < 600, `the picker is a popover (${p.left}..${p.right})`);
      assert.ok(p.rows.every((h) => h < 40), `rows keep their desktop height: ${p.rows}`);
      assert.ok(p.typing, 'the search box is focused');
    } finally { await page.close(); }
  });
}
