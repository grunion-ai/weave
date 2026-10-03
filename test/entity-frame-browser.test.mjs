/* The entity frame holds while its body scrolls (Issue #608).
   Kyle's screenshots, v0.4.54, Issue #601 open full page: at rest the card
   showed its rounded top edge, its top padding, the crumb row and the title.
   After a scroll the crumb row and the title stayed, but the card's top edge
   and the padding above the crumb row scrolled away, and the header floated
   against the window edge with no frame round it. The dock did the same
   inside its pane: its header climbed 14px into the pane's padding. Kyle:
   "entity frame should be visible at top, only things below the title should
   scroll."
   Both poses, both themes, a desktop window and a phone: scroll the body to
   the bottom and the card's top edge, the header band, the crumb row and the
   title keep the top they had at rest, while the document under them really
   moved. The band above the crumb row is still the header's own ground, so
   nothing from the body shows through it.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

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
  const open = async (pose, { width = 1440, height = 900, theme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${poses[pose].hash()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${poses[pose].pane} .name-edit`);
    await page.waitForSelector(`${poses[pose].pane} .doc-section .vditor-reset p`);
    await page.waitForTimeout(400); // the header height is published on a ResizeObserver
    return page;
  };
  // Where the frame is: the card's top edge, the header band, the crumb row,
  // the title, and a paragraph of the body to prove the body moved.
  const frame = (page, pose) => page.evaluate(({ pane, header }) => {
    const top = (n) => (n ? Math.round(n.getBoundingClientRect().top * 10) / 10 : null);
    const card = document.querySelector(pane);
    const head = document.querySelector(header);
    const r = card.getBoundingClientRect();
    // Just inside the card's top edge, mid-width: the header's ground, never the body.
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
  // Scroll the way a reader does, with the wheel over the body, until it stops.
  const wheelToBottom = async (page, pose) => {
    const box = await page.evaluate((pane) => {
      const r = document.querySelector(pane).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
    }, poses[pose].pane);
    await page.mouse.move(box.x, box.y);
    let last = null;
    for (let k = 0; k < 30; k++) {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(120);
      const now = (await frame(page, pose)).body;
      if (now === last) break;
      last = now;
    }
  };
  const holds = (rest, end, what) => assert.ok(Math.abs(end[what] - rest[what]) <= 1, `the ${what} keeps its top: rest ${rest[what]}, after the scroll ${end[what]} (${JSON.stringify({ rest, end })})`);

  const cases = [];
  for (const pose of ['page', 'dock']) for (const theme of ['light', 'dark']) cases.push({ pose, theme, width: 1440, height: 900 });
  for (const pose of ['page', 'dock']) cases.push({ pose, theme: 'light', width: 390, height: 844 });

  for (const { pose, theme, width, height } of cases) {
    test(`${pose}, ${theme}, ${width}x${height}: the card edge, crumb row and title hold while the body scrolls`, async () => {
      const page = await open(pose, { width, height, theme });
      const rest = await frame(page, pose);
      assert.ok(rest.edgeIsFrame, `at rest the card's top edge is the frame: ${JSON.stringify(rest)}`);
      await wheelToBottom(page, pose);
      const end = await frame(page, pose);
      assert.ok(rest.body - end.body > 400, `the body really scrolled: ${rest.body} -> ${end.body}`);
      assert.equal(end.doc, 0, 'the document itself never scrolls');
      for (const what of ['card', 'head', 'crumb', 'title']) holds(rest, end, what);
      assert.ok(end.edgeIsFrame, `after the scroll the band under the card's top edge is still the header, not the body: ${JSON.stringify(end)}`);
      await page.close();
    });
  }
}
