import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let table;
const s = await launch('doc task box tap target', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  table = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;
  let n = 0;
  const open = async (viewport, colorScheme = 'light') => {
    const id = weave.createEntity(table, { name: `Tasks ${++n}`, doc: '- [ ] first task\n- [ ] second task\n- [ ] third task\n' }).id;
    const page = viewport ? await browser.newPage({ viewport, colorScheme, hasTouch: true }) : await phonePage(await phoneBrowser(), { colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir .vditor-task input[type="checkbox"]');
    return { id, page };
  };
  const doc = async (id, want) => {
    for (let i = 0; i < 60 && weave.getDoc(id) !== want; i++) await new Promise((r) => setTimeout(r, 50));
    return weave.getDoc(id);
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone a task box is a 44px target with a visible box, in ${colorScheme} (Issue #705)`, async () => {
      const { page } = await open(null, colorScheme);
      try {
        const m = await page.evaluate(() => {
          const box = document.querySelector('.vditor-ir .vditor-task input[type="checkbox"]');
          const r = box.getBoundingClientRect();
          const face = getComputedStyle(box, '::before');
          const li = box.closest('li').getBoundingClientRect();
          return { w: r.width, h: r.height, faceW: parseFloat(face.width), faceH: parseFloat(face.height), faceBorder: face.borderTopColor, liH: li.height };
        });
        assert.ok(m.w >= 44 && m.h >= 44, `the target is ${m.w}x${m.h}px`);
        assert.ok(m.faceW >= 18 && m.faceW <= 22 && m.faceH === m.faceW, `the box face is ${m.faceW}x${m.faceH}px`);
        assert.notEqual(m.faceBorder, 'rgba(0, 0, 0, 0)', 'the box face has a visible edge');
        assert.ok(m.liH <= 32, `a task line stays ${m.liH}px tall`);
      } finally { await page.close(); }
    });
  }

  test('on a phone a tap 10px off the box ticks the task, and a tap on its text does not (Issue #705)', async () => {
    const { id, page } = await open(null);
    try {
      const [box, text] = await page.evaluate(() => {
        const input = document.querySelector('.vditor-ir .vditor-task input[type="checkbox"]');
        const r = input.getBoundingClientRect();
        const face = getComputedStyle(input, '::before');
        const faceRight = r.right - parseFloat(face.right || '0');
        const faceLeft = faceRight - parseFloat(face.width);
        const range = document.createRange();
        const node = [...input.parentElement.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim());
        range.setStart(node, node.textContent.indexOf('f') + 1);
        range.setEnd(node, node.textContent.indexOf('f') + 2);
        const t = range.getBoundingClientRect();
        return [{ x: faceLeft - 10, y: r.top + r.height / 2 - 10 }, { x: t.left + t.width / 2, y: t.top + t.height / 2 }];
      });
      await page.touchscreen.tap(text.x, text.y);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.vditor-task input').first().isChecked(), false, 'a tap on the text leaves the box alone');
      await page.touchscreen.tap(box.x, box.y);
      assert.equal(await doc(id, '- [x] first task\n- [ ] second task\n- [ ] third task\n'), '- [x] first task\n- [ ] second task\n- [ ] third task\n');
    } finally { await page.close(); }
  });

  test('on a desktop the task box keeps Vditor\'s own size', async () => {
    const { page } = await open({ width: 1280, height: 800 });
    try {
      const w = await page.locator('.vditor-task input').first().evaluate((i) => i.getBoundingClientRect().width);
      assert.ok(w < 20, `the desktop box is ${w}px`);
    } finally { await page.close(); }
  });
}
