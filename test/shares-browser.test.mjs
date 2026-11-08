import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

let task;
let one;
let space;
let view;
const s = await launch('share pane', (weave) => {
  space = weave.createSpace({ name: 'Dev' });
  task = weave.createTable({ space: 'Dev', name: 'Task' });
  one = weave.createEntity(task.id, { name: 'One' });
  weave.createEntity(task.id, { name: 'Two' });
  view = weave.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (hash, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    return page;
  };
  const reset = () => { for (const g of weave.listShares()) weave.revokeShare(g.id); };
  const pages = () => [
    ['workspace', '', '#main .view-header', /Entire workspace: /],
    ['space', `#/space/${space.id}`, '#main .view-header', /Entire space: Dev/],
    ['table', `#/table/${task.id}`, '#main .view-header', /Entire table: Task/],
    ['record', `#/entity/${one.id}`, '#main .view-header', /This record: One/],
    ['docked record', `#/table/${task.id}?e=${one.id}`, '#dock .view-header', /This record: One/],
    ['share page', `#/view/${view.id}`, '#main .share-page-head', /This share page: Focus/],
  ];

  for (const theme of ['light', 'dark']) {
    test(`every shareable page carries one share button that opens the one share pane, never a modal (${theme}, Issue #765)`, async () => {
      for (const [kind, hash, header, scope] of pages()) {
        const page = await open(hash, theme);
        try {
          const button = page.locator(`${header} .table-share-btn`);
          await button.waitFor();
          assert.equal(await button.count(), 1, `${kind}: one share button in its header`);
          assert.equal(await page.locator(`${header} .share-btn`).count(), 0, `${kind}: no retired text button`);
          const look = await page.evaluate((sel) => {
            const head = document.querySelector(sel);
            const pick = (n) => { const cs = getComputedStyle(n); return { border: cs.borderTopColor, bg: cs.backgroundColor, shadow: cs.boxShadow }; };
            const dots = head.querySelector('.dots-btn');
            return { share: pick(head.querySelector('.table-share-btn')), dots: dots && pick(dots) };
          }, header);
          if (look.dots) assert.deepEqual(look.share, look.dots, `${kind}: the share button wears the ⋮ ghost style`);
          else assert.equal(kind, 'workspace', 'only a workspace nobody here can delete has no ⋮ (Feature #347)');
          await button.click();
          await page.locator('#share-pane:not([hidden]) .share-add').waitFor();
          assert.match(await page.locator('#share-pane').innerText(), scope, `${kind}: the pane names its scope`);
          assert.equal(await button.getAttribute('aria-expanded'), 'true');
          assert.equal(await page.locator('#modal').count(), 0, `${kind}: no modal`);
          await button.click();
          assert.equal(await page.locator('#share-pane').isVisible(), false, `${kind}: the button closes the pane again`);
        } finally { await page.close(); }
      }
    });
  }

  test('no table or record menu offers a Share… row (Issue #765)', async () => {
    for (const [hash, title] of [[`#/table/${task.id}`, 'Table actions'], [`#/entity/${one.id}`, 'Record actions']]) {
      const page = await open(hash);
      try {
        await page.locator(`#main .dots-btn[title="${title}"]`).click();
        await page.locator('.wv-menu .wv-menu-row').first().waitFor();
        const rows = await page.locator('.wv-menu .wv-menu-row').allInnerTexts();
        assert.equal(rows.some((r) => r.trim() === 'Share…'), false, `${title}: ${rows}`);
      } finally { await page.close(); }
    }
  });

  test('the record pane mints a link scoped to the record and lists the table links that reach it', async () => {
    reset();
    weave.mintShare({ scope: { kind: 'table', id: task.id }, label: 'whole table' });
    const page = await open(`#/entity/${one.id}`);
    try {
      await page.locator('#main .view-header .table-share-btn').click();
      await page.locator('#share-pane .share-link', { hasText: 'whole table' }).waitFor();
      await page.getByRole('button', { name: 'Add link', exact: true }).click();
      assert.equal(await page.getByLabel('Link purpose', { exact: true }).locator('option').count(), 1, 'a record link only reads');
      await page.getByLabel('Link name', { exact: true }).fill('vendor');
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      assert.equal(await eventually(() => weave.listShares({ kind: 'entity', id: one.id }).length, 1), 1);
      const [g] = weave.listShares({ kind: 'entity', id: one.id });
      assert.deepEqual([g.mode, g.visibility, g.label], ['read', 'public', 'vendor']);
      await page.locator('#share-pane .share-link', { hasText: 'vendor' }).waitFor();
    } finally { await page.close(); }
  });

  test('the share page pane mints a link scoped to that page', async () => {
    reset();
    const page = await open(`#/view/${view.id}`);
    try {
      await page.locator('#main .share-page-head .table-share-btn').click();
      await page.getByRole('button', { name: 'Add link', exact: true }).click();
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      assert.equal(await eventually(() => weave.listShares({ kind: 'view', id: view.id }).length, 1), 1);
      await page.locator('#share-pane .share-link').first().waitFor();
    } finally { await page.close(); }
  });

  test('a second page\'s share button opens its own scope over an open pane', async () => {
    const page = await open(`#/table/${task.id}?e=${one.id}`);
    try {
      await page.locator('#main .view-header .table-share-btn').click();
      await painted(page, '#share-pane .share-add');
      assert.match(await page.locator('#share-pane').innerText(), /Entire table: Task/);
      await page.locator('#dock .view-header .table-share-btn').click();
      await page.waitForFunction(() => /This record: One/.test(document.querySelector('#share-pane')?.innerText ?? ''));
      assert.equal(await page.locator('#main .view-header .table-share-btn').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#dock .view-header .table-share-btn').getAttribute('aria-expanded'), 'true');
    } finally { await page.close(); }
  });

  test('on a phone the header share button answers a 44px tap on every axis, like the ⋮ beside it (Issue #1222)', async () => {
    for (const [kind, hash, header] of [['workspace', '', '#main .view-header'], ['space', `#/space/${space.id}`, '#main .view-header'], ['docked record', `#/table/${task.id}?e=${one.id}`, '#dock .view-header']]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
        const button = page.locator(`${header} .table-share-btn`);
        await button.waitFor();
        const reachOf = (b) => {
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const hit = (x, y) => { const n = document.elementFromPoint(x, y); return !!n && (n === b || b.contains(n)); };
          const span = (dx, dy) => { let d = 0; while (d < 30 && hit(cx - dx * (d + 0.5), cy - dy * (d + 0.5)) && hit(cx + dx * (d + 0.5), cy + dy * (d + 0.5))) d += 0.5; return 2 * d; };
          return { w: span(1, 0), h: span(0, 1), left: r.left, right: r.right };
        };
        const reach = await button.evaluate(reachOf);
        assert.ok(reach.w >= 43 && reach.h >= 43, `${kind}: the share button answers ${reach.w}x${reach.h}px of taps`);
        const kebab = page.locator(`${header} .crumb-row .dots-btn`);
        if (!(await kebab.count())) { assert.equal(kind, 'workspace', 'only a workspace nobody here can delete has no ⋮ (Feature #347)'); continue; }
        const dots = await kebab.first().evaluate(reachOf);
        assert.ok(dots.w >= 43 && dots.h >= 43, `${kind}: the ⋮ beside it still answers ${dots.w}x${dots.h}px of taps`);
        assert.ok(reach.right <= dots.left, `${kind}: the two tap areas do not overlap (share ends at ${reach.right}, ⋮ starts at ${dots.left})`);
      } finally { await page.close(); }
    }
  });

  test('the space toolbar creates a link for the entire space', async () => {
    reset();
    const page = await open(`#/space/${space.id}`);
    try {
      await page.getByRole('button', { name: 'Share (Beta)', exact: true }).click();
      await page.locator('#share-pane:not([hidden])').waitFor();
      await page.getByRole('button', { name: 'Add link', exact: true }).click();
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      await page.locator('#share-pane .share-link').first().waitFor();
      const grants = weave.listShares({ kind: 'space', id: space.id });
      assert.equal(grants.length, 1);
      assert.equal(grants[0].mode, 'read');
      await page.getByRole('button', { name: 'Close share panel', exact: true }).click();
      assert.equal(await page.locator('#share-pane').isVisible(), false);
    } finally { await page.close(); }
  });
}
