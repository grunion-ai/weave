import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage } from './lib/browser.mjs';

const prose = 'This paragraph runs long enough that a narrow column shows at once, because every line would hold three or four words and wrap again and again down the page.';

let task;
const s = await launch('side panel keeps the document wide', (weave) => {
  weave.createSpace({ name: 'Net' });
  const tasks = weave.createTable({ space: 'Net', name: 'Task' });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  const plan = weave.createEntity(tasks, { name: 'Plan the review' });
  task = weave.createEntity(tasks, { name: 'Review the task report', values: { Owner: 'Kyle' } });
  weave.setDoc(task.id, [
    `Plan: [[Task#${plan.publicId}]]`,
    '',
    prose,
    '',
    '## Weave issues',
    '',
    '- Opening a file preview squeezes the entity Description into a sliver of a column beside the panel.',
    '- Closing the panel restores the document to the full width of the entity column again.',
    '- Each list item in a long brief then runs six lines where one or two would do.',
  ].join('\n'));
  weave.attachFile(task.id, { name: 'report.html', mime: 'text/html', bytes: Buffer.from('<h1>report</h1>') });
});

if (s) {
  const { base, browser } = s;
  const widths = (page) => page.evaluate(() => {
    const grid = document.querySelector('#main .entity-grid');
    const doc = grid.querySelector('.doc-section .vditor-reset li').closest('.vditor-reset');
    return { doc: Math.round(doc.getBoundingClientRect().width), column: Math.round(grid.getBoundingClientRect().width) };
  });
  const openEntity = async (page, theme) => {
    await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#main .entity-grid.side-open .doc-section .vditor-reset li');
  };
  const openPreview = async (page) => {
    await page.locator('.entity-files-card .attach-item a', { hasText: 'report.html' }).click();
    await page.waitForSelector('#side:not([hidden]) > .wv-file-panel iframe');
  };

  for (const theme of ['light', 'dark']) {
    test(`a file preview leaves the document at least 80% of the entity column (${theme}, Issue #1476)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await openEntity(page, theme);
        const shut = await widths(page);
        await openPreview(page);
        const open = await widths(page);
        console.log(`# ${theme} document ${shut.doc} of ${shut.column} px shut, ${open.doc} of ${open.column} px with the preview open`);
        assert.ok(open.doc >= 0.8 * open.column, `the document is ${open.doc} px of a ${open.column} px entity column`);
      } finally { await page.close(); }
    });
  }

  test('a phone keeps the document across the entity column with a file preview open (Issue #1476)', async () => {
    const page = await phonePage(browser);
    try {
      await openEntity(page);
      await openPreview(page);
      const open = await widths(page);
      console.log(`# phone document ${open.doc} of ${open.column} px with the preview open`);
      assert.ok(open.doc >= 0.8 * open.column, `the phone document is ${open.doc} px of a ${open.column} px entity column`);
    } finally { await page.close(); }
  });
}
