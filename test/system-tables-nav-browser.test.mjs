import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let wfId, usersId, member, other;
const s = await launch('system tables nav', (weave) => {
  weave.createSpace({ name: 'Work' });
  for (let i = 1; i <= 16; i += 1) {
    weave.createSpace({ name: `Filler ${i}` });
    weave.createTable({ space: `Filler ${i}`, name: `Sheet ${i}` });
  }
  const t = weave.createTable({ space: 'Work', name: 'Tasks' });
  const e = weave.createEntity(t.id, { Name: 'binned' });
  weave.deleteEntity(e.id);
  wfId = weave.getTable('System/Workflows').id;
  usersId = weave.getTable('System/Users').id;
  member = new Weave();
  member.updateWorkspace({ name: 'member' });
  member.createSpace({ name: 'Notes' });
  member.createTable({ space: 'Notes', name: 'Ideas' });
  other = new Weave();
  other.updateWorkspace({ name: 'other' });
  other.createSpace({ name: 'Ops' });
  other.createTable({ space: 'Ops', name: 'Pages' });
}, { server: () => ({ workspaces: { member, other } }) });

if (s) {
  const { base, browser } = s;

  const repaintGap = (page) => page.evaluate(() => new Promise((emptied) => {
    const main = document.querySelector('#main');
    const held = [...main.children];
    main.replaceChildren();
    emptied();
    requestAnimationFrame(() => requestAnimationFrame(() => main.replaceChildren(...held)));
  }));

  const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const heldGap = (page) => page.evaluate(() => {
    const main = document.querySelector('#main');
    const held = [...main.children];
    main.replaceChildren();
    window.__refill = () => { main.replaceChildren(...held); delete window.__refill; };
  });
  const refill = (page) => page.evaluate(() => window.__refill());

  test('browser: five fixed rows under the spaces; Trash opens the workspace trash', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#sidebar .nav-system a');
    const rows = await page.locator('#sidebar .nav-system a').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href'), !!a.querySelector('.nav-db-menu')]));
    assert.deepEqual(rows, [['Workflows', `#/table/${wfId}`, false], ['Users', `#/table/${usersId}`, false], ['Activity', '#/activity', false], ['Trash', '#/trash', false]]);
    const inList = await page.$$eval('#nav .nav-db', (as) => as.map((a) => a.textContent.trim()));
    assert.ok(!inList.includes('Workflows') && !inList.includes('Users'), 'Workflows and Users are not listed twice');
    const below = await page.evaluate(() => {
      const group = document.querySelector('#sidebar .nav-system');
      const nav = document.querySelector('#nav').getBoundingClientRect();
      return { outside: !document.querySelector('#nav').contains(group), under: group.getBoundingClientRect().top >= nav.top };
    });
    assert.deepEqual(below, { outside: true, under: true }, 'the group sits under the space list, outside it, in the pinned strip');
    await page.click('#sidebar .nav-system a[href="#/trash"]');
    await page.waitForSelector('#main .trash-when');
    assert.match(await page.textContent('#main'), /binned/);
    assert.equal(await page.$eval('#sidebar .nav-system a[href="#/trash"]', (a) => a.classList.contains('active')), true);
    await page.click(`#sidebar .nav-system a[href="#/table/${wfId}"]`);
    await page.waitForSelector('#main input.view-title');
    assert.equal(await page.locator('#main input.view-title').first().evaluate((i) => i.readOnly), true, 'Workflows cannot be renamed from its page');
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`browser: the name and search hold the top, New space and the system tables hold the bottom, however far the nav scrolls (${theme}, Issue #854)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#sidebar .nav-system a');
      const spare = await page.evaluate(() => { const n = document.querySelector('#sidebar'); return n.scrollHeight - n.clientHeight; });
      assert.ok(spare > 200, `the nav has more spaces than room, so anything unpinned would scroll away: ${spare}`);

      const SEEN = ['#ws-name', '#search-btn', '#sidebar .nav-foot button', '#sidebar .nav-system a[href="#/trash"]', '#sidebar .nav-identity .nav-identity-more'];
      const look = () => page.evaluate((sels) => {
        const box = document.querySelector('#sidebar').getBoundingClientRect();
        const out = {};
        for (const sel of sels) {
          const r = document.querySelector(sel).getBoundingClientRect();
          out[sel] = { top: Math.round(r.top), within: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 };
        }
        return out;
      }, SEEN);

      const atTop = await look();
      for (const sel of SEEN) assert.ok(atTop[sel].within, `${sel} is in the sidebar's window unscrolled: ${JSON.stringify(atTop[sel])}`);
      await page.evaluate(() => { const n = document.querySelector('#sidebar'); n.scrollTo({ top: n.scrollHeight, behavior: 'instant' }); });
      await page.waitForTimeout(150);
      const atEnd = await look();
      for (const sel of SEEN) {
        assert.ok(atEnd[sel].within, `${sel} is still in the sidebar's window at the nav's end: ${JSON.stringify(atEnd[sel])}`);
        assert.ok(Math.abs(atEnd[sel].top - atTop[sel].top) <= 20,
          `${sel} held its place while the nav ran ${spare}px: ${atTop[sel].top} -> ${atEnd[sel].top}`);
      }

      const stack = await page.evaluate(() => {
        const y = (sel) => document.querySelector(sel).getBoundingClientRect().top;
        return {
          order: [...document.querySelectorAll('#sidebar > :not(#nav-resize)')].map((n) => n.id || n.className.split(' ')[0]),
          strip: [...document.querySelectorAll('#sidebar .nav-pinned > *')].filter((n) => !n.hidden).map((n) => n.className.split(' ')[0]),
          newSpaceAboveSystem: y('#sidebar .nav-foot') < y('#sidebar .nav-system'),
          systemBelowNav: y('#sidebar .nav-system') > y('#nav'),
          opaque: getComputedStyle(document.querySelector('.nav-head')).backgroundColor,
          canvas: getComputedStyle(document.querySelector('#sidebar')).getPropertyValue('--wv-canvas').trim(),
        };
      });
      assert.deepEqual(stack.order, ['nav-head', 'nav', 'nav-pinned'], 'head, scrolling list, pinned strip');
      assert.deepEqual(stack.strip, ['nav-foot', 'nav-system', 'nav-identity'], 'New space, then the System space, then the identity panel (Feature #333)');
      assert.ok(stack.newSpaceAboveSystem, 'New space sits above the system tables');
      assert.ok(stack.systemBelowNav, 'the system tables sit below the spaces');
      assert.notEqual(stack.opaque, 'rgba(0, 0, 0, 0)', `the head is opaque, so rows scroll under it: ${stack.opaque}`);
      await page.close();
    });
  }

  test('browser: the root workspace keeps its System registry off the sidebar and lists it on the workspace page (Issue #874)', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#nav .nav-space');
    const spaces = await page.locator('#nav .nav-space').evaluateAll((as) => as.map((a) => a.textContent.trim()));
    assert.ok(spaces.includes('Work'), 'user spaces stay in the sidebar');
    assert.ok(!spaces.includes('System') && !spaces.includes('Workspace'), 'the registry space is not a scrolling sidebar space');
    const listed = await page.locator('#nav .nav-db').evaluateAll((as) => as.map((a) => a.textContent.trim()));
    for (const name of ['Spaces', 'Tables', 'Fields', 'Views', 'Workspaces', 'Forms']) {
      assert.ok(!listed.includes(name), `${name} is not a sidebar row`);
    }
    const registry = await page.locator('#main .system-tables .list-row[data-registry]').evaluateAll((rows) => rows.map((r) => [r.dataset.registry, r.dataset.href]));
    const spacesId = registry.find(([kind]) => kind === 'spaces')?.[1];
    assert.deepEqual(registry.map(([kind]) => kind).sort(), ['fields', 'forms', 'spaces', 'tables', 'users', 'views', 'workflows', 'workspaces'],
      'the workspace page lists every registry table');
    assert.match(spacesId ?? '', /^#\/table\//);
    await page.click('#main .system-tables .list-row[data-registry="spaces"]');
    await page.waitForURL(new RegExp(`${spacesId.replace(/[/#]/g, '\\$&')}$`));
    await page.waitForSelector('#main .wv-grid tbody tr');
    assert.match(await page.locator('#main .wv-grid').first().textContent(), /Work/, 'the Spaces registry still opens and lists the spaces');
    await page.close();
  });

  test('browser: a member workspace served by the hub still pins Workflows, Users, Activity and Trash (Issue #872)', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/w/${member.state.meta.id}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#sidebar .nav-system a');
    const rows = await page.locator('#sidebar .nav-system a').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
    assert.deepEqual(rows, [['Workflows', `#/table/${wfId}`], ['Users', `/#/table/${usersId}`], ['Activity', '#/activity'], ['Trash', '#/trash']]);
    await page.close();
  });

  test('browser: each member workspace\'s Workflows view lists only its own workflows (Issue #875)', async () => {
    const rule = { trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'seen' }] };
    member.createAutomation('Notes/Ideas', { name: 'member idea rule', ...rule });
    other.createAutomation('Ops/Pages', { name: 'other page rule', ...rule });
    const listed = async (ws) => {
      const page = await browser.newPage();
      await page.goto(`${base}/w/${ws.state.meta.id}/#/`, { waitUntil: 'networkidle' });
      await page.click('#sidebar .nav-system a[href^="#/table/"]');
      await page.waitForURL(new RegExp(`/w/${ws.state.meta.id}/#/table/${wfId}$`));
      await page.waitForSelector('#main .wv-grid tbody tr');
      const text = await page.textContent('#main .wv-grid');
      await page.close();
      return text;
    };
    const mine = await listed(member);
    assert.match(mine, /member idea rule/);
    assert.doesNotMatch(mine, /other page rule/);
    const theirs = await listed(other);
    assert.match(theirs, /other page rule/);
    assert.doesNotMatch(theirs, /member idea rule/);
  });

  test('browser: the view title read waits out a repaint, where a read taken once does not', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${wfId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main input.view-title');
    await heldGap(page);
    await twoFrames(page);
    await assert.rejects(() => page.$eval('#main input.view-title', (i) => i.readOnly), /Failed to find element/,
      'a selector resolved once lands in the gap the repaint opens and throws, however long the read takes to arrive');
    await refill(page);
    await page.waitForSelector('#main input.view-title');
    await repaintGap(page);
    assert.equal(await page.locator('#main input.view-title').first().evaluate((i) => i.readOnly), true,
      'the locator re-resolves on each attempt, so the repaint costs the read nothing');
    await page.close();
  });
}
