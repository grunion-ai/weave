import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';
let acme;
const s = await launch('workspace rail first paint', (root) => {
  root.updateWorkspace({ name: 'net' });
  root.createSpace({ name: 'Work' });
  const tasks = root.createTable({ space: 'Work', name: 'Task' });
  root.createEntity(tasks, { name: 'Write the brief' });
  acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
  acme.createSpace({ name: 'Sales' });
}, { server: () => ({ workspaces: { acme } }) });
if (s) {
  const { base, browser } = s;
  const WORKSPACES = /\/api\/workspaces(\?|$)/;
  const CHIP = '#ws-list .ws-icon';
  const acmeHome = () => `/w/${acme.state.meta.id}/`;
  const railOf = (page) => page.$$eval(CHIP, (as) => as.map((a) => [a.getAttribute('title'), a.getAttribute('href'), a.textContent.trim(), a.className].join(' | ')));
  const wordmark = (page) => page.$eval('#ws-name', (a) => [a.textContent, a.getAttribute('href')]);
  async function holdRail(page) {
    const held = [];
    let holding = true;
    await page.route(WORKSPACES, (route) => {
      if (holding && route.request().method() === 'GET') held.push(route);
      else route.continue();
    });
    return {
      count: () => held.length,
      release: async () => { holding = false; for (const r of held.splice(0)) await r.continue(); },
    };
  }
  const warm = async (page) => {
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#ws-list .ws-icon').length === 2);
    await page.waitForFunction(() => document.querySelector('#ws-name')?.textContent === 'net');
  };
  test('switching workspaces paints the rail and the wordmark before /api/workspaces answers (Issue #1283)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await warm(page);
    const hold = await holdRail(page);
    await page.goto(`${base}${acmeHome()}`, { waitUntil: 'commit' });
    await page.waitForSelector(`${CHIP}.active`, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.weaveWsRail.painted), 'acme', 'the script that runs before first paint drew the rail, with no answer to read');
    assert.deepEqual(await wordmark(page), ['acme', `/w/${acme.state.meta.id}/`], 'the wordmark names the workspace being opened');
    const before = await railOf(page);
    assert.equal(before.length, 2, 'both chips are drawn from the cache');
    assert.match(before[0], /^acme /, 'the workspace being opened leads the rail');
    const answered = page.waitForResponse(WORKSPACES);
    await hold.release();
    await answered;
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
    assert.deepEqual(await railOf(page), before, 'the answered rail names the same chips in the same order, so nothing moves');
    await page.close();
  });
  test('a first visit has no cache to paint, and the rail fills when the answer lands (Issue #1283)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const hold = await holdRail(page);
    await page.goto(`${base}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!document.querySelector('#ws-list'));
    assert.equal(await page.locator(CHIP).count(), 0, 'nothing is drawn before the first answer');
    assert.equal((await wordmark(page))[0], '', 'the wordmark waits for the first answer');
    await hold.release();
    await page.waitForFunction(() => document.querySelectorAll('#ws-list .ws-icon').length === 2);
    await page.close();
  });
  test('a workspace the server no longer lists leaves the rail, and the chips that stay do not move (Issue #1283)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await warm(page);
    await page.goto(`${base}${acmeHome()}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#ws-name')?.textContent === 'acme');
    const hold = await holdRail(page);
    await page.goto(`${base}${acmeHome()}`, { waitUntil: 'commit' });
    await page.waitForSelector(`${CHIP}.active`, { timeout: 5000 });
    const before = await railOf(page);
    assert.equal(before.length, 2, 'the cache still holds both chips');
    await page.unroute(WORKSPACES);
    await page.route(WORKSPACES, async (route) => {
      const res = await route.fetch();
      const list = await res.json();
      await route.fulfill({ response: res, json: list.filter((w) => w.name === 'acme') });
    });
    await hold.release();
    await page.waitForFunction(() => document.querySelectorAll('#ws-list .ws-icon').length === 1);
    const after = await railOf(page);
    assert.deepEqual(after, [before[0]], 'the workspace that went away is gone and the survivor keeps its place');
    await page.close();
  });
  test('a cache that does not name the workspace being opened paints no chip (Issue #1283)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('weave-ws-rail', JSON.stringify({ chips: [{ id: 'gone', name: 'gone', href: '/w/gone/', bare: false, cls: 'ws-icon ws-letter hue-1', fallback: 'ws-letter hue-1', title: 'gone — 1 tables, 1 entities', logo: null, letter: 'G' }] }));
      } catch {}
    });
    const hold = await holdRail(page);
    await page.goto(`${base}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!document.querySelector('#ws-list'));
    assert.equal(await page.locator(CHIP).count(), 0, 'a chip the URL contradicts is never drawn');
    await hold.release();
    await page.waitForFunction(() => document.querySelectorAll('#ws-list .ws-icon').length === 2);
    assert.deepEqual((await railOf(page)).length, 2);
    await page.close();
  });
}
