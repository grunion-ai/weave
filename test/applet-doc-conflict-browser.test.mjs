import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch, phoneBrowser, phoneProfile, eventually, atRest } from './lib/browser.mjs';

const PASSCODE = '16821682';
const prior = process.env.WEAVE_APPLET_PASSCODE;
process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
test.after(() => {
  if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
  else process.env.WEAVE_APPLET_PASSCODE = prior;
});

const hash = (text) => createHash('sha256').update(text).digest('hex');

let task;
const s = await launch('applet document base', (weave) => {
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
  const stored = () => weave.getDoc(task.id);
  const writeAs = (actor, text) => { weave.actor = actor; weave.setDoc(task.id, text); };
  const docPut = (page) => page.waitForResponse((r) => r.url().endsWith(`/t/entity/${task.id}/doc`) && r.request().method() === 'PUT');
  const toastSays = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.wv-toast.up .msg')?.textContent ?? ''), re.source);
  const tapScrim = (page) => page.tap('#scrim', { position: { x: 195, y: 20 } });
  const phone = async ({ colorScheme = 'light', subtle = true } = {}) => {
    const ctx = await (await phoneBrowser()).newContext({ ...phoneProfile().page, colorScheme });
    if (!subtle) await ctx.addInitScript(() => Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true }));
    await ctx.request.post(`${base}/t/unlock`, { data: { passcode: PASSCODE } });
    const page = await ctx.newPage();
    await page.goto(`${base}/t`, { waitUntil: 'networkidle' });
    await page.tap('.wv-row');
    await page.waitForSelector('.wv-detail.in [data-doc]');
    await page.tap('.wv-detail.in button[data-doc]');
    await page.waitForSelector('.wv-sheet.up #docedit');
    return { ctx, page };
  };

  test('the applet sends the base of the text it opened, and works out the next one while a write is out, with no crypto.subtle (Issue #1682)', async () => {
    writeAs('web', 'OPENED_TEXT');
    const { ctx, page } = await phone({ subtle: false });
    assert.equal(await page.evaluate(() => typeof globalThis.crypto.subtle), 'undefined', 'the page has no crypto.subtle, as over plain http');
    const sent = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/t/entity/*/doc', async (route) => {
      sent.push(JSON.parse(route.request().postData()));
      const res = await route.fetch();
      if (sent.length === 1) await gate;
      await route.fulfill({ response: res });
    });
    await page.fill('#docedit', 'FIRST_EDIT');
    assert.equal(await eventually(stored, 'FIRST_EDIT'), 'FIRST_EDIT');
    await page.fill('#docedit', 'LEAVING_EDIT');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
    });
    assert.equal(await eventually(stored, 'LEAVING_EDIT'), 'LEAVING_EDIT', 'the leaving write lands on the text whose answer is still out');
    release();
    assert.deepEqual(sent.map((b) => b.base), [hash('OPENED_TEXT'), hash('FIRST_EDIT')], 'the first base came from the server, the second was hashed on the phone');
    await ctx.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`a change made elsewhere is not overwritten: the sheet says Not saved, keeps the text, and Use mine writes it (${colorScheme}, Issue #1682)`, async () => {
      writeAs('web', 'OPENED_TEXT');
      const { ctx, page } = await phone({ colorScheme });
      writeAs('mcp:agent', 'AGENT_TEXT');
      const refused = docPut(page);
      await page.fill('#docedit', 'PHONE_TEXT');
      assert.equal((await refused).status(), 412);
      await page.waitForFunction(() => document.querySelector('.wv-docstate')?.textContent === 'Not saved');
      assert.equal(stored(), 'AGENT_TEXT', 'the agent text survives');
      assert.equal(await page.inputValue('#docedit'), 'PHONE_TEXT', 'and the phone text stays in the sheet');
      await toastSays(page, /changed elsewhere, so yours was not saved/);
      const offer = page.locator('.wv-toast.up button');
      assert.equal(await offer.textContent(), 'Use mine');
      const ink = await offer.evaluate((el) => ({
        color: getComputedStyle(el).color,
        ground: getComputedStyle(el.closest('.wv-toast')).backgroundColor,
        visible: el.getBoundingClientRect().width > 0,
      }));
      assert.ok(ink.visible, 'the choice is on screen');
      assert.notEqual(ink.color, ink.ground, 'and readable against the toast');
      const mine = docPut(page);
      await offer.tap();
      assert.equal((await mine).status(), 200);
      assert.equal(stored(), 'PHONE_TEXT', 'Use mine writes the phone text over the change it was told about');
      await page.waitForFunction(() => document.querySelector('.wv-docstate')?.textContent === 'Saved');
      await ctx.close();
    });
  }

  test('closing and reopening the sheet after a refusal still leaves the other change alone (Issue #1682)', async () => {
    writeAs('web', 'OPENED_TEXT');
    const { ctx, page } = await phone();
    writeAs('mcp:agent', 'AGENT_TEXT');
    const first = docPut(page);
    await page.fill('#docedit', 'PHONE_TEXT');
    assert.equal((await first).status(), 412);
    const onClose = docPut(page);
    await tapScrim(page);
    assert.equal((await onClose).status(), 412, 'closing writes again from the same base, and is refused again');
    await page.waitForSelector('.wv-sheet:not(.up)');
    await toastSays(page, /changed elsewhere/);
    await atRest(page.locator('#toast'));
    assert.equal(await page.evaluate(() => {
      const r = document.querySelector('#toast').getBoundingClientRect();
      return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#toast');
    }), true, 'the toast shows above the task it is about');
    await page.waitForFunction(() => /AGENT_TEXT/.test(document.querySelector('.wv-detail.in .wv-doc')?.textContent ?? ''));
    await page.tap('.wv-detail.in button[data-doc]');
    await page.waitForSelector('.wv-sheet.up #docedit');
    assert.equal(await page.inputValue('#docedit'), 'PHONE_TEXT', 'the phone text waits as a draft');
    const reopened = docPut(page);
    await tapScrim(page);
    assert.equal((await reopened).status(), 412, 'reopening the draft is no consent to overwrite');
    await toastSays(page, /changed elsewhere/);
    assert.equal(stored(), 'AGENT_TEXT');
    await ctx.close();
  });
}
