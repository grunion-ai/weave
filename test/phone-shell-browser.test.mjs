import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

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
  return { dockHash: `#/table/${tasks.id}?e=${task.id}`, views: { 'Task table': `#/table/${tasks.id}`, 'Task record': `#/entity/${task.id}`, 'Guide table': `#/table/${guides.id}`, 'Guide record': `#/entity/${guide.id}`, 'relation map': '#/map' } };
});

if (s) {
  const { base, browser, views, dockHash } = s;
  const open = async (hash, { width = 390, theme = 'light', engine = browser } = {}) => {
    const page = await engine.newPage({ viewport: { width, height: 844 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .nav-menu', { state: 'attached' });
    await page.waitForTimeout(300);
    return page;
  };
  const openDrawer = async (page) => {
    await page.click('#main .nav-menu');
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
      assert.equal(seen.sidebar.left, 0, 'the menu covers the screen (Feature #269)');
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
    await page.mouse.click(680, 500);
    assert.equal((await shell(page)).open, false, 'a tap outside closes it');
    assert.ok(page.url().endsWith(views['Task record']), 'the scrim swallowed the tap: nothing under it opened');
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
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('nav-peek'), null, { timeout: 3000 }).catch(() => {});
    assert.equal((await shell(page)).open, false, 'widening past 900px shuts an open drawer');
    await page.close();
  });

  const pw = await import('playwright');
  const engines = { chromium: null, webkit: null };
  test.after(() => Promise.all(Object.values(engines).map((b) => b?.close())));
  const engineOf = async (name) => (engines[name] ??= await pw[name].launch());
  const sheet = (page) => page.evaluate(() => {
    const rect = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const dock = document.querySelector('#dock');
    return {
      theme: document.documentElement.dataset.bsTheme,
      scrollWidth: document.documentElement.scrollWidth,
      hidden: dock.hidden,
      dock: rect(dock),
      position: getComputedStyle(dock).position,
      name: dock.querySelector('textarea.name-edit') && rect(dock.querySelector('textarea.name-edit')),
      gutter: rect(document.querySelector('#dock-gutter')),
      main: rect(document.querySelector('#main')),
      hit: !!document.elementFromPoint(195, 420)?.closest('#dock'),
    };
  });
  const openDock = async (opts) => {
    const page = await open(dockHash, opts);
    await page.waitForSelector('#dock textarea.name-edit');
    await settled(page.locator('#dock'));
    return page;
  };

  for (const name of Object.keys(engines)) {
    for (const theme of ['light', 'dark']) {
      test(`a docked record at 390×844 is a full-screen sheet (${name}, ${theme})`, async () => {
        const page = await openDock({ theme, engine: await engineOf(name) });
        const seen = await sheet(page);
        assert.equal(seen.theme, theme, 'the page must be in the theme under test');
        assert.equal(seen.position, 'fixed', 'the dock leaves the flex row');
        assert.deepEqual([seen.dock.left, seen.dock.top, seen.dock.width, seen.dock.height], [0, 0, 390, 844], 'and covers the viewport');
        assert.ok(seen.name.width >= 200, `the name field is ${seen.name.width}px wide`);
        assert.ok(seen.name.height < 120, `the name "Wire Stripe webhooks" takes a line or two, not ${seen.name.height}px`);
        assert.equal(seen.gutter.width, 0, 'there is no divider to drag');
        assert.equal(seen.scrollWidth, 390, 'the page does not scroll sideways');
        assert.ok(seen.hit, 'the sheet is on top: a tap mid-screen lands in it');
        await page.close();
      });
    }

    test(`the sheet's close and Esc hand the table back (${name})`, async () => {
      const page = await openDock({ engine: await engineOf(name) });
      await page.click('#dock button[aria-label="Close"]');
      let seen = await sheet(page);
      assert.ok(seen.hidden, 'the close button shuts the sheet');
      assert.ok(seen.main.width >= 350, `the table is back at ${seen.main.width}px`);
      assert.ok(!page.url().includes('?e='), 'and the URL forgets the record');
      await page.close();
      const again = await openDock({ engine: await engineOf(name) });
      await again.keyboard.press('Escape');
      await again.waitForFunction(() => document.querySelector('#dock').hidden);
      seen = await sheet(again);
      assert.ok(seen.main.width >= 350, `Esc gives the table back at ${seen.main.width}px`);
      assert.equal(seen.scrollWidth, 390);
      await again.close();
    });
  }

  test('past 600px the dock is still a column beside its table', async () => {
    const page = await openDock({ width: 1280 });
    const seen = await sheet(page);
    assert.equal(seen.position, 'relative');
    assert.equal(seen.gutter.width, 16, 'with the divider between them');
    assert.ok(seen.main.width >= 320 && seen.dock.left > seen.main.left + seen.main.width, `the table keeps its floor (${seen.main.width}px) and the dock sits to its right`);
    await page.close();
  });
}
