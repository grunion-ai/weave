import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phoneProfile } from './lib/browser.mjs';

const PASSCODE = '11243947';
const prior = process.env.WEAVE_APPLET_PASSCODE;
process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
test.after(() => {
  if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
  else process.env.WEAVE_APPLET_PASSCODE = prior;
});

let task;
const s = await launch('applet autosave', (weave) => {
  const space = weave.createSpace({ name: 'Product' });
  const db = weave.createTable({ space: space.id, name: 'Task' });
  weave.addField(db.id, {
    name: 'State',
    type: 'workflow',
    config: { states: [
      { id: 'open', name: 'Open', category: 'not-started', default: true },
      { id: 'done', name: 'Done', category: 'done' },
    ] },
  });
  task = weave.createEntity(db.id, { Name: 'Call the vendor', State: 'Open' });
});

if (s) {
  const { base, weave } = s;
  const stored = () => weave.readEntity(task.id).doc ?? '';
  const settle = async (want, ms = 5000) => {
    for (let t = 0; t < ms && stored() !== want; t += 50) await new Promise((r) => setTimeout(r, 50));
    return stored();
  };

  const phone = async (colorScheme = 'light') => {
    const ctx = await (await phoneBrowser()).newContext({ ...phoneProfile().page, colorScheme });
    await ctx.request.post(`${base}/t/unlock`, { data: { passcode: PASSCODE } });
    const page = await ctx.newPage();
    await page.goto(`${base}/t`, { waitUntil: 'networkidle' });
    await page.tap('.wv-row');
    await page.waitForSelector('.wv-detail.in [data-doc]');
    return { ctx, page };
  };
  const openSheet = async (page) => {
    await page.tap('.wv-detail.in button[data-doc]');
    await page.waitForSelector('.wv-sheet.up #docedit');
  };
  const tapScrim = (page) => page.tap('#scrim', { position: { x: 195, y: 20 } });

  test('a scrim tap writes the description, and reopening shows it (Issue #247)', async () => {
    const { ctx, page } = await phone();
    await openSheet(page);
    await page.fill('#docedit', 'scrim: ask about lead times');
    await tapScrim(page);
    assert.equal(await settle('scrim: ask about lead times'), 'scrim: ask about lead times', 'the server has it');
    await page.waitForSelector('.wv-sheet:not(.up)');
    await openSheet(page);
    assert.equal(await page.inputValue('#docedit'), 'scrim: ask about lead times', 'the reopened sheet shows it');
    await ctx.close();
  });

  test('Escape closes the sheet and writes the description', async () => {
    const { ctx, page } = await phone();
    await openSheet(page);
    await page.fill('#docedit', 'escape: a keyboard on an iPad');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.wv-sheet:not(.up)');
    assert.equal(await settle('escape: a keyboard on an iPad'), 'escape: a keyboard on an iPad');
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    test(`a pause in typing writes it with the sheet still open, and says so (${scheme})`, async () => {
      const { ctx, page } = await phone(scheme);
      await openSheet(page);
      await page.fill('#docedit', `pause ${scheme}: the sheet stays up`);
      assert.equal(await settle(`pause ${scheme}: the sheet stays up`), `pause ${scheme}: the sheet stays up`, 'saved without a close');
      assert.equal(await page.locator('.wv-sheet.up #docedit').count(), 1, 'the sheet is still open');
      await page.waitForFunction(() => document.querySelector('.wv-docstate')?.textContent === 'Saved');
      const ink = await page.$eval('.wv-docstate', (el) => ({
        color: getComputedStyle(el).color,
        ground: getComputedStyle(document.querySelector('.wv-sheet')).backgroundColor,
        visible: el.getBoundingClientRect().width > 0,
      }));
      assert.ok(ink.visible, 'the saved state is on screen');
      assert.notEqual(ink.color, ink.ground, 'and readable against the sheet');
      await ctx.close();
    });
  }

  test('the page going away writes the description (keepalive)', async () => {
    const { ctx, page } = await phone();
    await openSheet(page);
    await page.fill('#docedit', 'pagehide: switched apps mid-sentence');
    await page.goto('about:blank');
    assert.equal(await settle('pagehide: switched apps mid-sentence'), 'pagehide: switched apps mid-sentence');
    await ctx.close();
  });

  test('a Save that fails keeps the text for the next open, and the next close writes it', async () => {
    const { ctx, page } = await phone();
    const before = stored();
    await page.route('**/t/entity/*/doc', (route) => route.abort());
    await openSheet(page);
    await page.fill('#docedit', 'offline: written on the train');
    await page.tap('.wv-sheet [data-save]');
    await page.waitForSelector('.wv-toast.up');
    assert.match(await page.textContent('.wv-toast .msg'), /Could not save/);
    assert.equal(stored(), before, 'nothing reached the server');
    await openSheet(page);
    assert.equal(await page.inputValue('#docedit'), 'offline: written on the train', 'the text survived the failed save');
    await page.unroute('**/t/entity/*/doc');
    await tapScrim(page);
    assert.equal(await settle('offline: written on the train'), 'offline: written on the train');
    await ctx.close();
  });

  test('an older write answering last does not undo the newer one', async () => {
    const { ctx, page } = await phone();
    let release, firstBack = false;
    const held = new Promise((r) => { release = r; });
    const answered = [];
    await page.route('**/t/entity/*/doc', async (route) => {
      const body = JSON.parse(route.request().postData()).doc;
      const res = await route.fetch();
      if (!firstBack) { firstBack = true; await held; }
      await route.fulfill({ response: res });
      answered.push(body);
    });
    await openSheet(page);
    await page.fill('#docedit', 'race: the older text');
    assert.equal(await settle('race: the older text'), 'race: the older text');
    await page.fill('#docedit', 'race: the newer text');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
    });
    assert.equal(await settle('race: the newer text'), 'race: the newer text', 'the leaving write went out at once');
    for (let i = 0; i < 100 && !answered.includes('race: the newer text'); i++) await page.waitForTimeout(20);
    release();
    for (let i = 0; i < 100 && answered.length < 2; i++) await page.waitForTimeout(20);
    assert.deepEqual(answered, ['race: the newer text', 'race: the older text'], 'the answers came back newest first');
    await page.waitForTimeout(100);
    await tapScrim(page);
    await page.waitForTimeout(400);
    const toast = await page.$eval('.wv-toast', (el) => (el.classList.contains('up') ? el.textContent : ''));
    assert.doesNotMatch(toast, /Could not save/, 'no false alarm');
    assert.equal(stored(), 'race: the newer text');
    await page.waitForFunction(() => /newer text/.test(document.querySelector('.wv-detail.in .wv-doc')?.textContent ?? ''));
    await openSheet(page);
    assert.equal(await page.inputValue('#docedit'), 'race: the newer text', 'the sheet shows the newest text');
    await ctx.close();
  });
}
