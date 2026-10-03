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

await import('../public/starter-core.js');
const { TEMPLATES, spec, firstTable } = globalThis.WeaveStarters;

/* The server builds before it answers; poll the engine until it has. */
async function waitFor(get, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    const v = get();
    if (v) return v;
  }
  throw new Error('timed out');
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

  test('happy path: Enter through the welcome, keep the default name, pick Work, land on it', async () => {
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
    assert.deepEqual(await page.locator('.wv-onboard .wv-start-title').allTextContents(), ['Money', 'Work', 'People']);
    assert.equal(await page.locator('.wv-onboard .wv-start-template').count(), 3, 'exactly three cards');
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

  for (const [id, space, first] of [['finance', 'Money', 'Transactions'], ['crm', 'People', 'Companies']]) {
    test(`picking ${space} builds it and lands on ${first}`, async () => {
      const page = await open();
      for (const n of [2, 3]) { await page.keyboard.press('Enter'); await step(page, n); }
      await page.click(`.wv-onboard .wv-start-template[data-template="${id}"]`);
      await page.waitForFunction(() => location.hash.startsWith('#/table/'));
      await page.waitForSelector('.view-header');
      const table = s.weave.findTable(`${space}/${first}`);
      assert.ok(table, `${space}/${first} is built`);
      assert.ok(page.url().endsWith(`#/table/${table.id}`), 'and opened');
      assert.ok(s.weave.listEntities(table.id).length > 0, 'with its sample rows');
      await page.close();
    });
  }

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

  /* Every finished path: the name kept or edited, times starting empty or
     each template. Each lands in the workspace under the right name, with
     exactly the template's tables, opened on its first, marked, and with
     nothing left to ask. */
  for (const edit of [false, true]) {
    for (const template of [null, ...TEMPLATES]) {
      test(`path: ${edit ? 'edit the name' : 'keep the name'}, then ${template ? `the ${template.id} starter` : 'start empty'}`, async () => {
        const page = await open();
        await page.keyboard.press('Enter');
        await step(page, 2);
        if (edit) await page.keyboard.type('Acme Team');
        await page.keyboard.press('Enter');
        await step(page, 3);
        if (template) {
          await page.click(`.wv-onboard .wv-start-template[data-template="${template.id}"]`);
          const first = await waitFor(() => s.weave.findTable(`${template.space}/${firstTable(template)}`));
          await page.waitForFunction((id) => location.hash === `#/table/${id}`, first.id);
          await page.waitForSelector('.view-header');
        } else {
          await landsHome(page, () => page.click('.wv-onboard .btn-primary'));
          assert.equal(await page.locator('.wv-start').count(), 1, 'the empty state is there to build from');
        }
        assert.equal(s.weave.state.meta.name, edit ? 'acme-team' : 'workspace');
        assert.deepEqual(s.weave.userTables().map((t) => s.weave.qualifiedName(t)).sort(),
          (template ? spec(template).spaces[0].tables : []).map((t) => `${template.space}/${t.name}`).sort(), 'exactly the template\'s tables');
        assert.ok(s.weave.onboardedAt(), 'marked');
        assert.equal(await page.locator('.wv-onboard').count(), 0);
        assert.equal((await (await fetch(`${s.base}/api/onboarding`)).json()).show, false, 'never asks again');
        await page.close();
      });
    }
  }

  /* Every way out early: Skip setup or Esc, on each step, after typing a
     name where there is one to type. Leaving keeps the defaults, builds
     nothing, and counts as done. On step 3 that drops a name already
     confirmed with Continue; Issue #615 asks whether it should, and these
     two step-3 cases change with its answer. */
  for (const at of [1, 2, 3]) {
    for (const how of ['Skip setup', 'Esc']) {
      test(`leave with ${how} on step ${at}: the defaults, nothing built, done`, async () => {
        const page = await open();
        if (at >= 2) { await page.keyboard.press('Enter'); await step(page, 2); await page.keyboard.type('not-this-one'); }
        if (at === 3) { await page.keyboard.press('Enter'); await step(page, 3); }
        await landsHome(page, () => (how === 'Esc' ? page.keyboard.press('Escape') : page.click('.wv-onboard-skip')));
        assert.equal(s.weave.state.meta.name, 'workspace', 'the default name');
        assert.equal(s.weave.userTables().length, 0, 'nothing half made');
        assert.ok(s.weave.onboardedAt(), 'leaving counts as done');
        await page.close();
      });
    }
  }

  test('a cleared name continues with the default', async () => {
    const page = await open();
    await page.keyboard.press('Enter');
    await step(page, 2);
    await page.keyboard.press('Backspace');
    assert.equal(await page.inputValue('.wv-onboard input'), '');
    await page.keyboard.press('Enter');
    await step(page, 3);
    await landsHome(page, () => page.keyboard.press('Enter'));
    assert.equal(s.weave.state.meta.name, 'workspace');
    await page.close();
  });

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
    await page.click('.wv-onboard .wv-start-template[data-template="crm"]');
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
