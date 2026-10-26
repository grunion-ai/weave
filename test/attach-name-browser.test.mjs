import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phoneProfile, eventually } from './lib/browser.mjs';
import { CELLS, probe, seed } from './lib/cutoff.mjs';
import { UNBROKEN } from './lib/states.mjs';

const LONG = `${UNBROKEN}.pdf`;
const SHORT = 'brief.pdf';
const LOST = `${UNBROKEN.slice(0, 84)}-lost.html`;
const LOST_SHOWN = `${LOST} (missing)`;
const CHIP = '.wv-board .tile .k-attach:not(.is-empty)';

const s = await launch('attachment chip name', async (weave) => {
  const handles = await seed(weave);
  const short = weave.createEntity(handles.sink.table, { name: 'Short file' }).id;
  weave.attachToField(short, 'Files', { name: SHORT, mime: 'application/pdf', bytes: Buffer.from('%PDF-1') });
  const lost = weave.createEntity(handles.sink.table, { name: 'Lost file' }).id;
  const gone = weave.attachToField(lost, 'Files', { name: LOST, mime: 'text/html', bytes: Buffer.from('<h1>b</h1>') });
  delete weave.state.fileBlobs[gone.id];
  return handles;
});

if (s) {
  const open = async (page, theme) => {
    await page.goto(`${s.base}/#/table/${s.sink.table}/view/${s.sink.board}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-board .tile');
  };
  const chipFindings = (page) => page.evaluate(probe, '.wv-board').then((all) => all.filter((f) => /k-attach/.test(f.selector)));
  const chipFor = (page, name) => page.locator(`${CHIP}[title="${name}"]`).first();
  const fitted = (chip, tail) => eventually(() => chip.evaluate((c, t) => c.textContent.includes('…') && c.textContent.endsWith(t), tail), true);

  for (const theme of ['light', 'dark']) {
    test(`desktop ${theme}: a board tile middle-truncates a long file name, keeps the extension and titles the full name (Issue #1155)`, async () => {
      const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport });
      try {
        await open(page, theme);
        const chip = chipFor(page, LONG);
        await fitted(chip, '.pdf');
        await page.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes('…'), `${CHIP}[title="${LONG}"]`);
        const got = await chip.evaluate((c) => {
          const dd = c.closest('dd');
          return { text: c.textContent, title: c.title, inside: c.getBoundingClientRect().right <= dd.getBoundingClientRect().right + 1 };
        });
        assert.equal(got.title, LONG, 'the full name sits in the title');
        assert.ok(got.text.endsWith('.pdf'), `the extension stays visible: ${got.text}`);
        assert.ok(got.text.includes('…') && got.text.length < LONG.length, `the stem is middle-truncated: ${got.text}`);
        assert.ok(got.inside, 'the chip stays inside its tile field');
        assert.deepEqual(await chipFindings(page), [], 'the cut-off probe finds nothing on the attachment chip');
        const short = await chipFor(page, SHORT).evaluate((c) => c.textContent);
        assert.ok(short.includes(SHORT), `a name that fits stays whole: ${short}`);
        await page.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes('…'), `${CHIP}[title="${LOST_SHOWN}"]`);
        const lostChip = chipFor(page, LOST_SHOWN);
        await fitted(lostChip, '.html (missing)');
        const lost = await lostChip.evaluate((c) => c.textContent);
        assert.ok(lost.endsWith('.html (missing)') && lost.includes('…'), `a lost file keeps its extension and its missing mark: ${lost}`);
      } finally { await page.close(); }
    });
  }

  test('phone: the board shows no cut-off attachment chip (Issue #1155)', async (t) => {
    const handset = await engineOf(CELLS.phone.engine);
    if (!handset) return t.skip(`${CELLS.phone.engine} cannot launch here`);
    const page = await handset.newPage({ ...phoneProfile().page, viewport: CELLS.phone.viewport });
    try {
      await open(page, 'light');
      assert.deepEqual(await chipFindings(page), []);
    } finally { await page.close(); }
  });
}
