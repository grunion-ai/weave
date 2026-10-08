import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, PHONE, phoneBrowser, phonePage, touchScroll } from './lib/browser.mjs';

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1} with enough words to read as prose.`).join('\n\n');

const s = await launch('entity frame', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  const issue = weave.createEntity(issues, { name: 'Looks broken: a long record to scroll' });
  weave.setDoc(issue.id, para('Record', 90));
  return { issues, issue };
});

if (s) {
  const { base, browser, issues, issue } = s;

  const poses = {
    page: { hash: () => `#/entity/${issue.id}`, pane: '#main', header: '#main > .view-header' },
    dock: { hash: () => `#/table/${issues.id}?e=${issue.id}`, pane: '#dock', header: '#dock .dock-entity > .view-header' },
  };
  const open = async (pose, { width = 1440, height = 900, theme = 'light', phone = false } = {}) => {
    const page = phone ? await phonePage(await phoneBrowser()) : await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${poses[pose].hash()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${poses[pose].pane} .name-edit`);
    await page.waitForSelector(`${poses[pose].pane} .doc-section .vditor-reset p`);
    await page.waitForTimeout(400);
    return page;
  };
  const frame = (page, pose) => page.evaluate(({ pane, header }) => {
    const top = (n) => (n ? Math.round(n.getBoundingClientRect().top * 10) / 10 : null);
    const card = document.querySelector(pane);
    const head = document.querySelector(header);
    const r = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 3);
    return {
      card: top(card), head: top(head),
      crumb: top(head?.querySelector('.crumb-row')),
      title: top(head?.querySelector('.name-edit')),
      body: top(card.querySelector('.doc-section .vditor-reset p')),
      edgeIsFrame: !!hit && (hit === card || !!head?.contains(hit)),
      doc: document.scrollingElement.scrollTop,
    };
  }, { pane: poses[pose].pane, header: poses[pose].header });
  const wheelToBottom = async (page, pose, phone) => {
    const box = await page.evaluate((pane) => {
      const r = document.querySelector(pane).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
    }, poses[pose].pane);
    if (!phone) await page.mouse.move(box.x, box.y);
    let last = null;
    for (let k = 0; k < 30; k++) {
      await (phone ? touchScroll(page, box, 2000) : page.mouse.wheel(0, 2000));
      await page.waitForTimeout(120);
      const now = (await frame(page, pose)).body;
      if (now === last) break;
      last = now;
    }
  };
  const holds = (rest, end, what) => assert.ok(Math.abs(end[what] - rest[what]) <= 1, `the ${what} keeps its top: rest ${rest[what]}, after the scroll ${end[what]} (${JSON.stringify({ rest, end })})`);

  const cases = [];
  for (const pose of ['page', 'dock']) for (const theme of ['light', 'dark']) cases.push({ pose, theme, width: 1440, height: 900 });
  for (const pose of ['page', 'dock']) cases.push({ pose, theme: 'light', phone: true });

  for (const { pose, theme, width, height, phone } of cases) {
    test(`${pose}, ${theme}, ${phone ? PHONE : `${width}x${height}`}: the card edge, crumb row and title hold while the body scrolls`, async () => {
      const page = await open(pose, { width, height, theme, phone });
      const rest = await frame(page, pose);
      assert.ok(rest.edgeIsFrame, `at rest the card's top edge is the frame: ${JSON.stringify(rest)}`);
      await wheelToBottom(page, pose, phone);
      const end = await frame(page, pose);
      assert.ok(rest.body - end.body > 400, `the body really scrolled: ${rest.body} -> ${end.body}`);
      assert.equal(end.doc, 0, 'the document itself never scrolls');
      for (const what of ['card', 'head', 'crumb', 'title']) holds(rest, end, what);
      assert.ok(end.edgeIsFrame, `after the scroll the band under the card's top edge is still the header, not the body: ${JSON.stringify(end)}`);
      await page.close();
    });
  }
}
