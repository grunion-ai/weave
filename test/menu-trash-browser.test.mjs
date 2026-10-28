import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, hold } from './lib/browser.mjs';

const s = await launch('menu trash', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createSpace({ name: 'Ops' });
  weave.createTable({ space: 'Product', name: 'Task' });
  weave.createTable({ space: 'Ops', name: 'Log' });
});

if (s) {
  const { base, browser, weave } = s;
  const MENU = '.chip-pop.wv-menu[role="menu"]';
  let n = 0;
  const uniq = (stem) => `${stem}${++n}`;

  const open = async (hash, theme) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
    return page;
  };

  const openMenu = async (page, trigger, how) => {
    await page.waitForSelector(trigger, { state: 'attached' });
    if (how === 'right') await page.locator(trigger).first().click({ button: 'right', force: true });
    else await page.locator(trigger).first().click({ force: true });
    await page.waitForSelector(MENU);
    return page.locator(`${MENU} .wv-menu-row`, { hasText: 'Move to trash' });
  };

  const trashOnce = async (page, trigger, how = 'click') => {
    const row = await openMenu(page, trigger, how);
    assert.equal(await row.count(), 1, 'the menu ends in one Move to trash row');
    assert.equal(await row.evaluate((r) => r.classList.contains('hold-btn') && !!r.querySelector('.hold-fill')), true, 'the row is a hold');
    assert.equal((await row.locator('.hold-hint').textContent()).trim().toLowerCase(), 'hold', 'and says so');
    assert.equal(await row.evaluate((r) => r.classList.contains('wv-menu-danger')), true, 'and it reads as destructive');
    await row.click();
    assert.equal(await row.evaluate((r) => r.isConnected && !r.classList.contains('holding')), true, 'a click lets go before the sweep, and the menu stays open');
    await hold(row);
    const toast = page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();
    await toast.waitFor();
    assert.equal((await toast.locator('.wv-toast-msg').textContent()).trim(), 'Moved to trash');
    const undo = toast.locator('.wv-toast-action');
    assert.equal((await undo.textContent()).trim(), 'Undo');
    assert.ok(await undo.isVisible(), 'the Undo button shows');
    const ink = await undo.evaluate((b) => {
      const bg = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
      return [getComputedStyle(b).color, bg(b)];
    });
    assert.notEqual(ink[0], ink[1], 'Undo reads against its toast');
    return undo;
  };

  const navTables = (page, space) => page.evaluate((sp) => {
    const out = [];
    let on = false;
    for (const n of document.querySelectorAll('#nav > *')) {
      if (n.classList.contains('nav-space-row')) { on = n.querySelector('a.nav-space')?.textContent.trim() === sp; continue; }
      if (on && n.matches('a.nav-db')) out.push(n.textContent.trim());
    }
    return out;
  }, space);
  const navSpaces = (page) => page.$$eval('#nav .nav-space-row a.nav-space', (as) => as.map((a) => a.textContent.trim()));
  const hashIs = (page, want) => page.waitForFunction((w) => location.hash === w, want, { timeout: 5000 });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: a table goes to the trash with a hold and Undo puts it back in its space (Feature #296, Feature #346)`, async () => {
      const name = uniq('Doomed');
      const db = weave.createTable({ space: 'Product', name });
      weave.createTable({ space: 'Product', name: uniq('After') });
      const page = await open(`#/table/${db.id}`, theme);
      try {
        await page.waitForSelector('#main .wv-grid');
        const before = await navTables(page, 'Product');
        assert.ok(before.includes(name));
        const undo = await trashOnce(page, '#main .crumb-row .dots-btn[title="Table actions"]');
        assert.ok(await eventually(() => !!weave.state.tables[db.id]?.deletedAt, true), 'the table is in the trash');
        await page.waitForFunction((nm) => ![...document.querySelectorAll('#nav a.nav-db')].some((a) => a.textContent.trim() === nm), name);
        await undo.click();
        await hashIs(page, `#/table/${db.id}`);
        await page.waitForFunction((nm) => [...document.querySelectorAll('#nav a.nav-db')].some((a) => a.textContent.trim() === nm), name);
        assert.ok(!weave.state.tables[db.id].deletedAt, 'the table is live again');
        assert.deepEqual(await navTables(page, 'Product'), before, 'at its old place in the space');
        await page.waitForSelector('#main .wv-grid');
      } finally { await page.close(); }
    });

    test(`${theme}: a space goes to the trash with a hold from its nav ⋮ and Undo puts it back in the sidebar (Feature #296, Feature #346)`, async () => {
      const name = uniq('Gone');
      weave.createSpace({ name });
      weave.createTable({ space: name, name: uniq('Inside') });
      const sp = weave.getSpace(name);
      const page = await open('', theme);
      try {
        await page.waitForSelector('#nav .nav-space-row');
        const before = await navSpaces(page);
        assert.ok(before.includes(name));
        const undo = await trashOnce(page, `#nav .nav-space-row:has(a.nav-space[href="#/space/${sp.id}"]) .nav-space-menu .dots-btn`);
        assert.ok(await eventually(() => !!weave.state.spaces[sp.id]?.deletedAt, true), 'the space is in the trash');
        await page.waitForFunction((nm) => ![...document.querySelectorAll('#nav a.nav-space')].some((a) => a.textContent.trim() === nm), name);
        await undo.click();
        await page.waitForFunction((nm) => [...document.querySelectorAll('#nav a.nav-space')].some((a) => a.textContent.trim() === nm), name);
        assert.ok(!weave.state.spaces[sp.id].deletedAt, 'the space is live again');
        assert.deepEqual(await navSpaces(page), before, 'at its old place in the sidebar');
        assert.equal((await navTables(page, name)).length, 1, 'with its table');
      } finally { await page.close(); }
    });

    test(`${theme}: a space trashed from its own page reopens on Undo (Feature #296, Feature #346)`, async () => {
      const name = uniq('Open');
      weave.createSpace({ name });
      const sp = weave.getSpace(name);
      const page = await open(`#/space/${sp.id}`, theme);
      try {
        const undo = await trashOnce(page, '#main .view-header .crumb-row .dots-btn');
        await page.waitForFunction((h) => location.hash !== h, `#/space/${sp.id}`);
        await undo.click();
        await hashIs(page, `#/space/${sp.id}`);
        assert.ok(!weave.state.spaces[sp.id].deletedAt);
      } finally { await page.close(); }
    });

    test(`${theme}: a record goes to the trash with a hold and Undo reopens it (Feature #296, Feature #346)`, async () => {
      const db = weave.getTable('Task');
      const e = weave.createEntity(db, { name: uniq('Row') });
      const page = await open(`#/entity/${e.id}`, theme);
      try {
        await page.waitForSelector('#main textarea.name-edit');
        const undo = await trashOnce(page, '#main .view-header .crumb-row .dots-btn');
        assert.ok(await eventually(() => !!weave.state.entities[e.id]?.deletedAt, true), 'the record is in the trash');
        await hashIs(page, `#/table/${db.id}`);
        await undo.click();
        await hashIs(page, `#/entity/${e.id}`);
        assert.ok(!weave.state.entities[e.id].deletedAt, 'the record is live again');
      } finally { await page.close(); }
    });

    test(`${theme}: a share page goes to the trash with a hold and Undo puts it back on the workspace page (Feature #296, Feature #346, Issue #768)`, async () => {
      const name = uniq('Focus');
      weave.createView({ name: uniq('Before'), blocks: [{ table: 'Task' }] });
      const v = weave.createView({ name, blocks: [{ table: 'Task' }] });
      weave.createView({ name: uniq('Later'), blocks: [{ table: 'Task' }] });
      const order = () => weave.listViews().map((x) => x.name);
      const before = order();
      const page = await open(`#/view/${v.id}`, theme);
      try {
        const undo = await trashOnce(page, '#main .share-page-head .dots-btn');
        assert.ok(await eventually(() => !order().includes(name), true), 'the share page left the live list');
        assert.ok(weave.listViews({ trash: true }).some((x) => x.id === v.id), 'and sits in the trash');
        await page.waitForSelector('#main .view-header .dots-btn[title="Workspace actions"]');
        assert.equal(await page.locator('#main .list-row', { hasText: name }).count(), 0, 'the workspace page no longer lists it');
        await undo.click();
        await hashIs(page, `#/view/${v.id}`);
        await page.waitForSelector('#main .share-page-head h1');
        assert.deepEqual(order(), before, 'back at its old place in the list');
      } finally { await page.close(); }
    });

    test(`${theme}: a share page trashed from its workspace page row comes back to that row on Undo (Feature #296, Feature #346)`, async () => {
      const name = uniq('Row');
      const v = weave.createView({ name, blocks: [{ table: 'Task' }] });
      const page = await open('', theme);
      try {
        const rows = () => page.$$eval('#main .list-rows .list-row', (rs) => rs.map((r) => r.dataset.href));
        await page.waitForSelector(`#main .list-row[data-href="#/view/${v.id}"]`);
        const before = await rows();
        const undo = await trashOnce(page, `#main .list-row[data-href="#/view/${v.id}"]`, 'right');
        await page.waitForSelector(`#main .list-row[data-href="#/view/${v.id}"]`, { state: 'detached' });
        await undo.click();
        await page.waitForSelector(`#main .list-row[data-href="#/view/${v.id}"]`);
        assert.deepEqual(await rows(), before, 'the row is back where it was');
      } finally { await page.close(); }
    });

    test(`${theme}: a field goes to the trash with a hold and Undo puts the column back in place (Feature #296, Feature #346, Issue #768)`, async () => {
      const db = weave.createTable({ space: 'Ops', name: uniq('Grid') });
      weave.addField(db, { name: 'Stage', type: 'select', config: { options: ['Now', 'Later'] } });
      weave.addField(db, { name: 'Owner', type: 'text' });
      weave.createEntity(db, { name: 'One', values: { Stage: 'Now', Owner: 'Ana' } });
      const page = await open(`#/table/${db.id}`, theme);
      try {
        const cols = () => page.$$eval('#main .wv-grid thead th.col-head[data-col]', (ths) => ths.map((t) => t.dataset.col));
        await page.waitForSelector('#main .wv-grid thead th.col-head[data-col="Stage"]');
        const before = await cols();
        const undo = await trashOnce(page, '#main .wv-grid thead th.col-head[data-col="Stage"] .field-menu');
        const live = () => Object.values(weave.getTable(db.id).fields).some((f) => f.name === 'Stage');
        assert.equal(await eventually(live, false), false, 'the field left the table');
        await page.waitForSelector('#main .wv-grid thead th.col-head[data-col="Stage"]', { state: 'detached' });
        await undo.click();
        await page.waitForSelector('#main .wv-grid thead th.col-head[data-col="Stage"]');
        assert.ok(live(), 'the field is live again');
        assert.deepEqual(await cols(), before, 'the column is back where it was');
        assert.match(await page.locator('#main .wv-grid tbody tr.entity-row td[data-field="Stage"]').first().textContent(), /Now/, 'with its values');
      } finally { await page.close(); }
    });
  }

  for (const kind of ['table', 'space', 'share page']) {
    test(`a ${kind} trashed while open restores in place on Undo after the reader moved on, with Open in the toast (Issue #856)`, async () => {
      let href;
      let trigger;
      let gone;
      if (kind === 'table') {
        const db = weave.createTable({ space: 'Product', name: uniq('Left') });
        href = `#/table/${db.id}`;
        trigger = '#main .crumb-row .dots-btn[title="Table actions"]';
        gone = () => !weave.state.tables[db.id]?.deletedAt;
      } else if (kind === 'space') {
        const name = uniq('Away');
        weave.createSpace({ name });
        const sp = weave.getSpace(name);
        href = `#/space/${sp.id}`;
        trigger = '#main .view-header .crumb-row .dots-btn';
        gone = () => !weave.state.spaces[sp.id]?.deletedAt;
      } else {
        const v = weave.createView({ name: uniq('Elsewhere'), blocks: [{ table: 'Task' }] });
        href = `#/view/${v.id}`;
        trigger = '#main .share-page-head .dots-btn';
        gone = () => weave.listViews().some((x) => x.id === v.id);
      }
      const other = weave.getTable('Log');
      const page = await open(href, 'light');
      try {
        const undo = await trashOnce(page, trigger);
        await page.waitForFunction((h) => location.hash !== h, href);
        await page.evaluate((h) => { location.hash = h; }, `#/table/${other.id}`);
        await page.waitForSelector('#main .wv-grid');
        await undo.click();
        assert.ok(await eventually(gone, true), `the ${kind} is live again`);
        const restored = page.locator('.wv-toast', { hasText: 'Restored' }).last();
        await restored.waitFor();
        assert.equal(await page.evaluate(() => location.hash), `#/table/${other.id}`, 'Undo leaves the reader where they are');
        const openBtn = restored.locator('.wv-toast-action');
        assert.equal((await openBtn.textContent()).trim(), 'Open', 'the Restored toast offers Open');
        await openBtn.click();
        await hashIs(page, href);
      } finally { await page.close(); }
    });
  }

  test('the multi-select trash and the record menu give the same toast and the same Undo (Feature #296, Feature #346)', async () => {
    const db = weave.createTable({ space: 'Ops', name: uniq('Pair') });
    const a = weave.createEntity(db, { name: 'Alpha' });
    const b = weave.createEntity(db, { name: 'Bravo' });
    const page = await open(`#/table/${db.id}`, 'light');
    const read = async () => {
      const t = page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();
      await t.waitFor();
      const seen = await t.evaluate((n) => ({
        msg: n.querySelector('.wv-toast-msg').firstChild.textContent.trim(),
        kind: [...n.classList].filter((c) => c !== 'wv-toast').join(' '),
        actions: [...n.querySelectorAll('.wv-toast-action')].map((x) => x.textContent.trim()),
      }));
      return { t, seen };
    };
    try {
      await page.waitForSelector(`.wv-grid tr[data-eid="${a.id}"] .sel-box`, { state: 'attached' });
      await page.locator(`.wv-grid tr[data-eid="${a.id}"] .sel-box`).check();
      await hold(page.locator('.sel-puck .sel-act.danger'));
      const bulk = await read();
      assert.ok(await eventually(() => !!weave.state.entities[a.id].deletedAt, true));
      await bulk.t.locator('.wv-toast-action').click();
      assert.ok(await eventually(() => !weave.state.entities[a.id].deletedAt, true), 'the toolbar Undo restores');
      await page.locator('.wv-toast', { hasText: 'Moved to trash' }).waitFor({ state: 'detached' });

      await page.goto(`${base}/#/table/${db.id}?e=${b.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await page.locator('#dock .view-header .crumb-row .dots-btn').click();
      await hold(page.locator(`${MENU} .wv-menu-row`, { hasText: 'Move to trash' }));
      const one = await read();
      assert.ok(await eventually(() => !!weave.state.entities[b.id].deletedAt, true));
      await one.t.locator('.wv-toast-action').click();
      assert.ok(await eventually(() => !weave.state.entities[b.id].deletedAt, true), 'the record menu Undo restores');

      assert.match(bulk.seen.msg, /^Moved to trash\b/, `the toolbar says ${bulk.seen.msg}`);
      assert.match(one.seen.msg, /^Moved to trash\b/, `the record menu says ${one.seen.msg}`);
      assert.equal(bulk.seen.msg.replace(/ 1 \w+$/, ''), one.seen.msg, 'one verb, the toolbar adds only the count');
      assert.deepEqual(bulk.seen.actions, ['Undo']);
      assert.deepEqual(one.seen.actions, bulk.seen.actions, 'the same single Undo action');
      assert.equal(one.seen.kind, bulk.seen.kind, 'the same toast kind');
      await page.locator('.wv-toast', { hasText: 'Restored' }).last().waitFor();
    } finally { await page.close(); }
  });
}
