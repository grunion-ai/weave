/* Feature #248 — the onboarding welcome, in the browser. A new person on an
   empty instance gets one held dialog: welcome, name the workspace (the
   default arrives filled in and focused), then an optional starter. Enter
   takes the primary button, Skip on every step and Esc finish with the
   defaults, and every path lands in a working workspace that never asks
   again. Walked in both themes and at phone width. Playwright is NOT a
   dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

// A second, empty member of the hub holds the name "taken".
const other = new Weave();
other.state.meta.name = 'taken';
const s = await launch('onboarding welcome', (weave) => { weave.state.meta.name = 'workspace'; },
  { server: () => ({ workspaces: { taken: other } }) });

/* Back to a new, empty instance: no spaces of its own, the first name, no mark. */
async function reset() {
  for (const sp of s.weave.listSpaces().filter((x) => !x.system)) s.weave.deleteSpace(sp.id, { hard: true });
  if (s.weave.state.meta.name !== 'workspace') {
    await fetch(`${s.base}/api/workspace`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'workspace' }) });
  }
  delete s.weave.state.meta.onboardedAt;
}

async function open({ theme = 'light', viewport = null } = {}) {
  await reset();
  const page = await s.browser.newPage(viewport ? { viewport } : {});
  await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
  await page.goto(`${s.base}/#/`);
  await page.waitForSelector('.wv-onboard[data-step="1"]');
  return page;
}

const heading = (page) => page.locator('.wv-onboard h2').textContent();
const step = (page, n) => page.waitForSelector(`.wv-onboard[data-step="${n}"]`);

/* Resolves once the page has reloaded into the workspace and asked again:
   the second answer must be no. */
async function landsHome(page, act) {
  const asked = page.waitForResponse((r) => r.url().endsWith('/api/onboarding') && r.request().method() === 'GET');
  await act();
  const again = await (await asked).json();
  assert.equal(again.show, false, 'it does not ask twice');
  await page.waitForSelector('.view-header');
  assert.equal(await page.locator('.wv-onboard').count(), 0);
}

if (s) {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: the welcome reads on its ground, one heading and one primary button per step`, async () => {
      const page = await open({ theme });
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-bs-theme')), theme);
      assert.equal(await heading(page), 'Welcome to weave');
      assert.equal(await page.locator('.wv-onboard [role="dialog"], .wv-onboard[role="dialog"]').count(), 1, 'the shared held dialog');
      assert.equal(await page.locator('.wv-onboard').getAttribute('aria-modal'), 'true');
      for (const n of [1, 2, 3]) {
        if (n > 1) { await page.keyboard.press('Enter'); await step(page, n); }
        assert.equal(await page.locator('.wv-onboard h2').count(), 1);
        assert.equal(await page.locator('.wv-onboard .btn-primary').count(), 1, `step ${n}: one primary button`);
        assert.equal((await page.locator('.wv-onboard-skip').textContent()).trim(), 'Skip setup', `step ${n} carries Skip`);
        assert.equal(await page.locator('.wv-onboard .visually-hidden').textContent(), `Step ${n} of 3`);
        assert.equal(await page.locator('.wv-onboard-dots span.on').count(), n);
        assert.equal(await page.locator('.wv-onboard .wv-onboard-icon svg').count(), 1, 'a Lucide icon');
        const [fg, bg] = await page.locator('.wv-onboard .btn-primary').evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
        assert.notEqual(fg, bg, `${theme} step ${n}: button text and ground differ`);
        const box = await page.locator('#modal.wv-onboard').evaluate((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]);
        assert.notEqual(box[0], box[1], `${theme} step ${n}: dialog text and ground differ`);
        const text = await page.locator('.wv-onboard').innerText();
        assert.ok(!/—/.test(text), 'no em dash');
      }
      await page.close();
    });
  }

  test('happy path: Enter through the welcome, keep the default name, pick Tasks, land on it', async () => {
    const page = await open();
    await page.keyboard.press('Enter');
    await step(page, 2);
    assert.equal(await heading(page), 'Your workspace');
    assert.equal(await page.locator('.wv-onboard-line').textContent(), 'Rename it anytime from the sidebar.');
    // Focus lands in the name field, holding the default.
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Workspace name');
    assert.equal(await page.inputValue('.wv-onboard input'), 'workspace');
    await page.keyboard.press('Enter');
    await step(page, 3);
    assert.equal(await heading(page), 'Your first space');
    assert.deepEqual(await page.locator('.wv-onboard .wv-start-title').allTextContents(), ['Tasks', 'CRM', 'Docs']);
    await page.click('.wv-onboard .wv-start-template[data-template="tasks"]');
    await page.waitForFunction(() => location.hash.startsWith('#/table/'));
    await page.waitForSelector('.view-header');
    const tasks = s.weave.findTable('Work/Tasks');
    assert.ok(tasks, 'the template is built');
    assert.ok(page.url().endsWith(`#/table/${tasks.id}`), 'and opened');
    assert.equal(s.weave.state.meta.name, 'workspace', 'the default name stands');
    assert.ok(s.weave.onboardedAt(), 'marked');
    assert.equal(await page.locator('.wv-onboard').count(), 0);
    await page.close();
  });

  test('rename path: type over the default, Enter, start empty, land home under the new name', async () => {
    const page = await open({ theme: 'dark' });
    await page.click('.wv-onboard .btn-primary');
    await step(page, 2);
    // Typing replaces the selected default.
    await page.keyboard.type('Acme Team');
    await page.keyboard.press('Enter');
    await step(page, 3);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Start with your empty workspace', 'Enter on the last step starts empty');
    await landsHome(page, () => page.keyboard.press('Enter'));
    assert.equal(s.weave.state.meta.name, 'acme-team', 'folded to a workspace name');
    assert.equal(s.weave.userTables().length, 0);
    assert.equal(await page.inputValue('.view-header input.view-title'), 'acme-team', 'the page title reads the new name');
    assert.equal(await page.locator('.wv-start').count(), 1, 'the empty state is still there to build from');
    await page.close();
  });

  for (const at of [1, 2, 3]) {
    test(`skip from step ${at} keeps the defaults and lands in a working workspace`, async () => {
      const page = await open();
      for (let n = 2; n <= at; n++) { await page.keyboard.press('Enter'); await step(page, n); }
      if (at === 2) await page.fill('.wv-onboard input', 'not-this-one');
      // Step 2 skips with Esc, the others with the button.
      await landsHome(page, () => (at === 2 ? page.keyboard.press('Escape') : page.click('.wv-onboard-skip')));
      assert.equal(s.weave.state.meta.name, 'workspace', 'the default name');
      assert.equal(s.weave.userTables().length, 0, 'nothing half made');
      assert.ok(s.weave.onboardedAt(), 'skipped counts as done');
      await page.close();
    });
  }

  test('375 px: every step fits the phone, no sideways scroll', async () => {
    const page = await open({ viewport: { width: 375, height: 812 } });
    for (const n of [1, 2, 3]) {
      if (n > 1) { await page.click('.wv-onboard .btn-primary'); await step(page, n); }
      const fit = await page.evaluate(() => {
        const b = document.querySelector('#modal.wv-onboard').getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, left: b.left, right: b.right };
      });
      assert.ok(fit.scroll <= fit.width, `step ${n}: no horizontal scroll (${fit.scroll} > ${fit.width})`);
      assert.ok(fit.left >= 0 && fit.right <= 375, `step ${n}: the dialog sits inside the screen`);
      const btn = await page.locator('.wv-onboard .btn-primary').boundingBox();
      assert.ok(btn.x >= 0 && btn.x + btn.width <= 375, `step ${n}: the primary button is on screen`);
    }
    await landsHome(page, () => page.click('.wv-onboard-skip'));
    await page.close();
  });

  test('a person who already has a workspace of their own never sees it', async () => {
    await reset();
    s.weave.createSpace({ name: 'Ops' });
    s.weave.createTable({ space: 'Ops', name: 'Runbook' });
    const page = await s.browser.newPage();
    const asked = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/onboarding')) asked.push(r.method()); });
    await page.goto(`${s.base}/#/`);
    await page.waitForSelector('.home-map');
    assert.equal(await page.locator('.wv-onboard').count(), 0);
    assert.deepEqual(asked, [], 'a populated home does not even ask');
    await page.close();
    // Emptied again, but onboarded once already: no second welcome.
    s.weave.deleteSpace('Ops', { hard: true });
    s.weave.markOnboarded();
    const again = await s.browser.newPage();
    const answer = again.waitForResponse((r) => r.url().endsWith('/api/onboarding'));
    await again.goto(`${s.base}/#/`);
    assert.equal((await (await answer).json()).show, false);
    await again.waitForSelector('.wv-start');
    assert.equal(await again.locator('.wv-onboard').count(), 0);
    await again.close();
  });

  test('a taken name is refused in place: a toast, back on the name, nothing built', async () => {
    const page = await open();
    await page.keyboard.press('Enter');
    await step(page, 2);
    await page.fill('.wv-onboard input', 'taken');
    await page.keyboard.press('Enter');
    await step(page, 3);
    await page.click('.wv-onboard .wv-start-template[data-template="docs"]');
    await page.waitForSelector('.wv-toast.err');
    assert.match(await page.locator('.wv-toast.err').textContent(), /taken/);
    await step(page, 2);
    assert.equal(await page.inputValue('.wv-onboard input'), 'taken', 'the typed name is still there to fix');
    assert.equal(s.weave.userTables().length, 0, 'the template was not built');
    assert.equal(s.weave.onboardedAt(), null, 'not marked');
    await page.fill('.wv-onboard input', 'mine');
    await page.keyboard.press('Enter');
    await step(page, 3);
    await landsHome(page, () => page.click('.wv-onboard .btn-primary'));
    assert.equal(s.weave.state.meta.name, 'mine');
    await page.close();
  });
}
