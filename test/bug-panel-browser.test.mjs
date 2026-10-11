import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedWeaver } from '../src/weaver-seed.js';

const s = await launch('bug panel', (weave) => { seedWeaver(weave); }, { server: (weave) => ({ workspaces: { weave } }) });
if (s) {
  const { base, browser, weave } = s;

  async function open() {
    const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.bug-fab');
    await page.click('.bug-fab');
    await page.waitForSelector('#bug-panel .bug-note');
    return page;
  }

  const note = (page) => page.locator('#bug-panel .bug-note').first().evaluate((n) => n.value);
  const picked = (page) => page.$$eval('#bug-panel .bug-cat.picked', (ns) => ns.map((n) => n.dataset.cat));
  const clickBehind = (page) => page.click('main#main', { position: { x: 8, y: 8 }, force: true });

  test('a started report survives a click on the page behind it', async () => {
    const page = await open();
    try {
      await page.fill('#bug-panel .bug-note', 'the peers cell drops what I picked');
      await clickBehind(page);
      assert.equal(await page.locator('#bug-panel').count(), 1, 'the panel is still open');
      assert.equal(await note(page), 'the peers cell drops what I picked', 'and still holds the note');
    } finally { await page.close(); }
  });

  test('an untouched panel still closes when you click the page', async () => {
    const page = await open();
    try {
      await clickBehind(page);
      await page.waitForSelector('#bug-panel', { state: 'detached' });
    } finally { await page.close(); }
  });

  test('Escape puts the report away, and reopening brings it back', async () => {
    const page = await open();
    try {
      await page.fill('#bug-panel .bug-note', 'forty-nine seconds of typing');
      await page.click('#bug-panel .bug-cat[data-cat="wrong-data"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#bug-panel', { state: 'detached' });
      await page.click('.bug-fab');
      await page.waitForSelector('#bug-panel .bug-note');
      assert.equal(await note(page), 'forty-nine seconds of typing', 'the note came back');
      assert.deepEqual(await picked(page), ['wrong-data'], 'and so did the symptom');
      assert.equal(await page.locator('#bug-panel .bug-send').isDisabled(), false, 'Send is live on a restored draft');
    } finally { await page.close(); }
  });

  test('a sent report leaves nothing behind for the next one', async () => {
    const page = await open();
    try {
      await page.fill('#bug-panel .bug-note', 'this one gets filed');
      await page.click('#bug-panel .bug-send');
      await page.waitForSelector('#bug-panel', { state: 'detached', timeout: 5000 });
      await page.click('.bug-fab');
      await page.waitForSelector('#bug-panel .bug-note');
      assert.equal(await note(page), '', 'a fresh panel');
      assert.deepEqual(await picked(page), [], 'and no symptoms carried over');
    } finally { await page.close(); }
  });

  test('the email link carries the report as written and no workspace name', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/w/weave/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.bug-fab');
      await page.click('.bug-fab');
      await page.waitForSelector('#bug-panel .bug-note');
      await page.fill('#bug-panel .bug-note', 'the grid never loaded');
      await page.click('#bug-panel .bug-cat[data-cat="error"]');
      const href = await page.$eval('#bug-panel a.bug-mail', (a) => a.getAttribute('href'));
      assert.match(href, /^mailto:weave@grunion\.ai\?subject=/);
      const subject = decodeURIComponent(href.match(/subject=([^&]*)/)[1]);
      const body = decodeURIComponent(href.match(/body=(.*)$/)[1]);
      assert.equal(subject, '[weave] Error: the grid never loaded');
      assert.match(body, /Page: \/w\/<ws>\/#\//, 'the route shape of the page under test');
      assert.match(body, /weave v\d+\.\d+\.\d+/, 'the version came from /api/health');
      assert.match(body, /Browser: Chrome \d+ on /, 'headless Chromium reduced to a family');
      assert.ok(!body.includes('/w/weave/'), 'the workspace segment never rides');
      assert.ok(!body.includes('Workspace:'), 'nor a workspace line');
      assert.ok(!body.includes('Mozilla'), 'nor the raw user agent');
      assert.equal(await page.$eval('#bug-panel .bug-addr', (n) => n.textContent), 'weave@grunion.ai', 'the address is printed for a device with no mail handler');
    } finally { await page.close(); }
  });
}
