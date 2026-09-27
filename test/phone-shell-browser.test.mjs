/* The phone shell (Issues #262, #326; design pass F1, 2026-09-26).

   At 390×844 the 52px workspace rail and the 264px sidebar stayed in the
   flow, #main got about 66px, the entity title wrapped a letter per line and
   every view scrolled sideways (document scrollWidth 705 on a Task table,
   622 on a Task record, 573 on the Issue table, 570 on a Guide record, 407
   on the relation map). Below 900px the sidebar is now a drawer — the
   collapsed-nav peek overlay, opened by the crumb bar's menu button — and
   below 600px the rail folds into it.

   Each view loads at 390×844 in both themes and must not scroll the page
   sideways, with #main at least 350px wide. The drawer opens from the menu
   button, holds only 32px tap targets, and closes on Esc, on the scrim and
   on navigation. Tables may scroll inside their own wrapper; the page may
   not. Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('phone shell', (weave) => {
  weave.createSpace({ name: 'Product' });
  const tasks = weave.createTable({ space: 'Product', name: 'Task', description: 'Work in flight, one row per task, with enough words here to wrap the description at phone width.' });
  const projects = weave.createTable({ space: 'Product', name: 'Project' });
  weave.addField(tasks, { name: 'Status', type: 'select', config: { options: ['Backlog', 'Doing', 'Done'] } });
  weave.addField(tasks, { name: 'Due', type: 'date' });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  for (let i = 0; i < 6; i++) weave.addField(tasks, { name: `A long field name ${i}`, type: 'text' });
  weave.addRelation(tasks.id, { name: 'Project', targetDb: projects.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const apollo = weave.createEntity(projects, { name: 'Apollo Launch' });
  const task = weave.createEntity(tasks, { name: 'Wire Stripe webhooks', values: { Status: 'Doing', Due: '2026-09-12', Estimate: 3, 'A long field name 0': 'A value long enough to reach the edge of a phone screen and past it' } });
  weave.link(task.id, 'Project', [apollo.id]);
  for (let i = 0; i < 30; i++) weave.createEntity(tasks, { name: `Task ${i} with a name long enough to clip`, values: { Status: 'Backlog' } });
  weave.createSpace({ name: 'Handbook' });
  const guides = weave.createTable({ space: 'Handbook', name: 'Guide' });
  weave.addField(guides, { name: 'Audience', type: 'select', config: { options: ['Everyone', 'Operators'] } });
  const guide = weave.createEntity(guides, { name: 'Quickstart', values: { Audience: 'Everyone' } });
  weave.setDoc(guide.id, '# Quickstart\n\nThe sidebar lists every space and table. A sentence long enough to wrap twice on a phone screen, so the body is measured with text in it.', 'Description');
  return { views: { 'Task table': `#/table/${tasks.id}`, 'Task record': `#/entity/${task.id}`, 'Guide table': `#/table/${guides.id}`, 'Guide record': `#/entity/${guide.id}`, 'relation map': '#/map' } };
});

if (s) {
  const { base, browser, views } = s;
  const open = async (hash, { width = 390, theme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .nav-menu', { state: 'attached' });
    await page.waitForTimeout(300); // the view header settles on a ResizeObserver
    return page;
  };
  // The drawer slides in over 160ms; measure where it lands, not mid-flight.
  const openDrawer = async (page) => {
    await page.click('#main .nav-menu');
    // A cancelled animation rejects its promise; only the ones that run matter.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  };
  const shell = (page) => page.evaluate(() => {
    const rect = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    return {
      theme: document.documentElement.dataset.bsTheme,
      scrollWidth: document.documentElement.scrollWidth,
      main: rect('#main'), sidebar: rect('#sidebar'), rail: rect('#ws-rail'),
      menu: rect('#main .nav-menu'),
      open: document.querySelector('#app').classList.contains('nav-peek'),
    };
  });

  for (const theme of ['light', 'dark']) {
    for (const [name, hash] of Object.entries(views)) {
      test(`${name} at 390×844 does not scroll sideways (${theme})`, async () => {
        const page = await open(hash, { theme });
        const seen = await shell(page);
        assert.equal(seen.theme, theme, 'the page must be in the theme under test');
        assert.ok(seen.scrollWidth <= 390, `document scrollWidth is ${seen.scrollWidth}`);
        assert.ok(seen.main.width >= 350, `#main is ${seen.main.width}px wide`);
        assert.equal(seen.sidebar.width, 0, 'the sidebar is out of the flow until the drawer opens');
        assert.equal(seen.rail.width, 0, 'below 600px the rail folds into the drawer');
        assert.ok(seen.menu.width >= 32, 'the menu button is visible in the crumb bar');
        await page.close();
      });
    }
  }

  for (const theme of ['light', 'dark']) {
    test(`the drawer opens from the crumb bar and every target in it is 32px (${theme})`, async () => {
      const page = await open(views['Task table'], { theme });
      await openDrawer(page);
      const seen = await shell(page);
      assert.ok(seen.open, 'the menu button opens the drawer');
      assert.equal(seen.rail.left, 0, 'the rail rides in the drawer');
      assert.equal(seen.sidebar.left, seen.rail.right, 'the sidebar sits beside it');
      assert.ok(seen.sidebar.right <= 390, 'the drawer fits the screen');
      assert.ok(seen.scrollWidth <= 390, `the open drawer does not widen the page (${seen.scrollWidth})`);
      const small = await page.evaluate(() => [...document.querySelectorAll('#sidebar a, #sidebar button, #ws-rail a, #ws-rail button')]
        .map((e) => [e, e.getBoundingClientRect()])
        .filter(([e, r]) => r.width && r.height && getComputedStyle(e).visibility !== 'hidden' && (r.width < 32 || r.height < 32))
        .map(([e, r]) => `${e.className || e.tagName} "${e.textContent.trim().slice(0, 20)}" ${Math.round(r.width)}×${Math.round(r.height)}`));
      assert.deepEqual(small, [], 'every drawer tap target is at least 32×32');
      await page.close();
    });
  }

  test('the drawer closes on Esc, on the scrim, on its ‹ and on navigation', async () => {
    const page = await open(views['Task table']);
    const isOpen = () => page.evaluate(() => document.querySelector('#app').classList.contains('nav-peek'));
    await page.click('#main .nav-menu');
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(), false, 'Esc closes it');
    await page.click('#main .nav-menu');
    await page.mouse.click(370, 500); // right of the 316px drawer: the scrim
    assert.equal(await isOpen(), false, 'a tap outside closes it');
    assert.ok(page.url().endsWith(views['Task table']), 'the scrim swallowed the tap: nothing under it opened');
    await openDrawer(page);
    await page.click('#nav-collapse');
    assert.equal(await isOpen(), false, 'the ‹ closes it');
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-nav-collapsed')), '', 'and does not persist a collapsed nav for the desktop');
    await page.click('#main .nav-menu');
    await page.click('#sidebar a.nav-db:has-text("Guide")');
    await page.waitForFunction((h) => location.hash === h, views['Guide table']);
    assert.equal(await isOpen(), false, 'following a nav link closes it');
    await page.close();
  });

  test('between 600 and 900px the rail stays and the drawer opens beside it', async () => {
    const page = await open(views['Task record'], { width: 700 });
    let seen = await shell(page);
    assert.ok(seen.scrollWidth <= 700, `document scrollWidth is ${seen.scrollWidth}`);
    assert.equal(seen.rail.width, 52, 'the rail is in the flow');
    assert.equal(seen.sidebar.width, 0, 'the sidebar is not');
    await openDrawer(page);
    seen = await shell(page);
    assert.equal(seen.sidebar.left, 52, 'the drawer opens beside the rail');
    await page.close();
  });

  test('at desktop width the sidebar is in the flow and the menu button is hidden', async () => {
    const page = await open(views['Task table'], { width: 1280 });
    const seen = await shell(page);
    assert.equal(seen.sidebar.width, 264, 'the sidebar keeps its 264px');
    assert.equal(seen.menu.width, 0, 'no menu button');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#main .nav-menu');
    await page.setViewportSize({ width: 1280, height: 844 });
    // The media query's change event lands after the resize, not with it.
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('nav-peek'), null, { timeout: 3000 }).catch(() => {});
    assert.equal((await shell(page)).open, false, 'widening past 900px shuts an open drawer');
    await page.close();
  });
}
