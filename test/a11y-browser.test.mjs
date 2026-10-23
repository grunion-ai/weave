import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch, settled, atRest } from './lib/browser.mjs';
import { createForm } from '../src/forms.js';
import { createOidc } from '../src/oidc.js';
import { createBilling } from '../src/billing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AXE = readFileSync(join(HERE, 'vendor/axe-4.10.2.min.js'), 'utf8');
const BASELINE = JSON.parse(readFileSync(join(HERE, 'a11y-baseline.json'), 'utf8')).violations;
const RULES = ['label', 'region', 'color-contrast', 'aria-prohibited-attr', 'label-title-only'];
const EDITOR = '.vditor';
const EDITOR_OFF = {};
const EDITOR_RULES = RULES.filter((r) => !EDITOR_OFF[r]);
const ROW = '.wv-grid tbody tr.entity-row';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const keyOf = ({ route, state, theme, rule, target }) => [route, state, theme, rule, target.replace(UUID, '#')].join(' | ');
const partsOf = (key) => {
  const [route, state, theme, rule, target] = key.split(' | ');
  return { route, state, theme, rule, target };
};

let task, issue, entityId, board, list, form;
const s = await launch('a11y baseline', (weave) => {
  weave.createSpace({ name: 'Work' });
  task = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(task, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In progress', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(task, { name: 'Notes', type: 'text' });
  issue = weave.createTable({ space: 'Work', name: 'Issue' });
  weave.addField(issue, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issue, { name: 'Symptom', type: 'multiselect', config: { options: ['Slow', 'Looks broken'] } });
  weave.addField(issue, { name: 'Points', type: 'number' });
  weave.addField(issue, { name: 'Double', type: 'formula', config: { expression: 'Points * 2' } });
  weave.addField(issue, { name: 'Due', type: 'date' });
  weave.addField(issue, { name: 'Done', type: 'checkbox' });
  weave.addField(issue, { name: 'Link', type: 'url' });
  weave.addField(issue, { name: 'Brief', type: 'document' });
  weave.addRelation(issue, { name: 'Task', targetDb: task, cardinality: 'many-to-one', inverseName: 'Issues' });
  const t1 = weave.createEntity(task, { name: 'Write the plan', values: { Status: 'In progress', Notes: 'first pass' } });
  weave.createEntity(task, { name: 'Ship it', values: { Status: 'Open' } });
  const i1 = weave.createEntity(issue, { name: 'Grid is slow', values: {
    Severity: 'High', Symptom: ['Slow'], Points: 3, Due: '2026-10-01', Done: false, Link: 'https://example.com', Task: t1.id } });
  const gone = weave.createEntity(issue, { name: 'Chip wraps', values: { Severity: 'Low', Points: 1 } });
  weave.createEntity(issue, { name: 'Old note', values: { Severity: 'Low' } });
  weave.deleteEntity(gone.id);
  weave.setDoc(i1.id, `Measured on [[Task#${t1.publicId}]].\n\n## Steps\n\nOpen the grid and scroll.\n`, 'Brief');
  entityId = i1.id;
  board = weave.tableView(`${task.id}/Board`, { layout: 'board', group: ['Status'] });
  list = weave.tableView(`${task.id}/List`, { layout: 'list', group: ['Status'] });
  form = createForm(weave, { name: 'Report a task', table: task.id, fields: [{ field: 'Name', key: 'title', label: 'Title', required: true }, { field: 'Notes', key: 'notes', label: 'Notes' }] });
});

const ISSUER = 'https://clerk.a11y.example.test';
const nobody = async () => new Response('{"errors":[{"code":"resource_not_found"}]}', { status: 404 });
let architect;
const doors = s && await launch('a11y doors', (w) => {
  w.updateWorkspace({ name: 'ada-sales' });
  w.createSpace({ name: 'Sales' });
  architect = w.createAccount({ name: 'ada-sales', role: 'architect' }).account;
  w.redeemIdentityInvite(w.linkIdentity('ada-sales', { issuer: ISSUER }).code, { issuer: ISSUER, subject: 'user_ada' });
  w.accountForIdentity({ issuer: ISSUER, subject: 'user_ada', email: 'ada-sales@example.com' });
  w.setRequireAuth(true);
}, { server: () => ({
  oidc: createOidc({ issuer: 'https://idp.a11y.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }),
  billing: createBilling({ secretKey: 'sk_test_x', soloPlan: 'solo', teamPlan: 'team', issuer: ISSUER, publishableKey: null, fetch: nobody }),
}) });

if (s && doors) {
  const { base, browser } = s;

  const press = (page, sel) => page.locator(`${sel} >> visible=true`).first().click();
  const tableMenu = (label) => async (page) => {
    await press(page, '#main .dots-btn[title="Table actions"]');
    await press(page, `.wv-menu >> visible=true >> text=${label}`);
  };

  const TABLE_STATES = [
    { name: 'field dialog', root: '#tray-back', async open(page) {
      await press(page, '.field-menu[title="Configure Status"]');
      await press(page, '.chip-pop .chip-pop-row >> text=Field settings');
    } },
    { name: 'command palette', root: '#cmdk-back', async open(page) {
      await press(page, '.search-like');
      await page.waitForSelector('#cmdk-input');
    } },
    { name: 'share dialog', root: '#modal-back', open: tableMenu('Share…') },
    { name: 'filter popover', root: '.table-filter-popover', open: (page) => press(page, '#main .table-filter-btn') },
    { name: 'sort popover', root: '.table-sort-popover', open: (page) => press(page, '#main .table-sort-btn') },
    { name: 'row menu', root: '.wv-menu', async open(page) {
      await page.locator(`${ROW} td.pid-cell a.open-link`).first().click();
      await page.waitForSelector('#dock .pose-btn');
      await press(page, '#dock .crumb-actions .dots-btn');
    } },
  ];

  const ROUTES = [
    { name: 'Task table', url: () => `${base}/#/table/${task.id}`, ready: ROW, states: TABLE_STATES },
    { name: 'Issue table', url: () => `${base}/#/table/${issue.id}`, ready: ROW },
    { name: 'Task board', url: () => `${base}/#/table/${task.id}/view/${board.id}`, ready: '.wv-board .tile' },
    { name: 'Task list', url: () => `${base}/#/table/${task.id}/view/${list.id}`, ready: '.wv-list .list-row' },
    { name: 'entity page', url: () => `${base}/#/entity/${entityId}`, ready: '.vditor-ir [contenteditable="true"]', editor: true, states: [
      { name: 'editor open', root: EDITOR, open: (page) => page.locator('.vditor-ir [contenteditable="true"] >> visible=true').first().click() },
    ] },
    { name: 'map', url: () => `${base}/#/map`, ready: '#main .view-title' },
    { name: 'settings', url: () => `${base}/#/settings`, ready: '#main .settings-purge' },
    { name: 'trash', url: () => `${base}/#/trash`, ready: '#main .view-title' },
    { name: 'activity', url: () => `${base}/#/activity`, ready: '.activity-row' },
    { name: 'forms builder', url: () => `${base}/#/table/${task.id}`, ready: ROW, async setup(page) {
      await tableMenu('Forms…')(page);
      await page.getByRole('button', { name: 'Create form', exact: true }).click();
      await page.waitForSelector('[data-form-field]');
    } },
    { name: 'published form', url: () => `${base}/f/${form.id}`, ready: '#wv-form-error' },
    { name: 'start', url: () => `${doors.base}/start`, ready: 'main#start:not(:has([role="status"]))' },
    { name: 'billing', url: () => `${doors.base}/billing`, ready: '#seats li', session: true },
  ];

  const open = async (url, ready, theme, { session = false } = {}) => {
    const ctx = await (session ? doors : s).browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    if (session) await ctx.addCookies([{ name: `wv_session_${doors.weave.state.meta.id}`, value: doors.weave.createSession(architect.id).token, url: doors.base }]);
    const page = await ctx.newPage();
    page.close = () => ctx.close();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready, { state: 'attached' });
    await settled(page.locator('body'));
    return page;
  };

  const axe = async (page, { root = null, editor = false } = {}) => {
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
    const run = (context, rules) => page.evaluate(([c, r]) => window.axe.run(
      c.include ? { include: [[c.include]], exclude: c.exclude ? [[c.exclude]] : [] } : { exclude: c.exclude ? [[c.exclude]] : [] },
      { runOnly: { type: 'rule', values: r }, resultTypes: ['violations'] },
    ).then((res) => res.violations.flatMap((v) => v.nodes.map((n) => ({
      rule: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, target: n.target.join(' '),
      contrast: n.any[0]?.data?.contrastRatio ? `${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}:1` : null,
    })))), [context, rules]);
    if (root === EDITOR) return run({ include: EDITOR }, EDITOR_RULES);
    if (root) return run({ include: root }, RULES);
    const outside = await run({ exclude: EDITOR }, RULES);
    return editor ? [...outside, ...await run({ include: EDITOR }, EDITOR_RULES)] : outside;
  };

  const effectiveTheme = (page) => page.evaluate(() => document.documentElement.dataset.bsTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  const scanRoute = async (route, theme) => {
    const found = [];
    const failed = [];
    const add = (state, list) => { for (const v of list) found.push({ ...v, key: keyOf({ route: route.name, state, theme, rule: v.rule, target: v.target }) }); };
    const fresh = async () => {
      const page = await open(route.url(), route.ready, theme, { session: route.session });
      if (route.setup) await route.setup(page);
      return page;
    };
    let page = await fresh();
    try {
      assert.equal(await effectiveTheme(page), theme, `${route.name} paints the ${theme} theme`);
      if (route.editor) assert.ok(await page.locator(`${EDITOR} >> visible=true`).count() > 0, `${route.name} shows the document editor the scan covers`);
      add('at rest', await axe(page, { editor: await page.locator(EDITOR).count() > 0 }));
      for (const st of route.states ?? []) {
        try {
          await st.open(page);
          const root = page.locator(`${st.root} >> visible=true`).first();
          await root.waitFor({ timeout: 8000 });
          await atRest(root);
          add(st.name, await axe(page, { root: st.root }));
        } catch (err) {
          failed.push(`${st.name}: ${String(err.message).split('\n')[0]}`);
        }
        await page.keyboard.press('Escape');
        const shut = await page.waitForFunction((sel) => ![...document.querySelectorAll(sel)].some((n) => n.getClientRects().length), st.root, { timeout: 2000 }).then(() => true, () => false);
        if (!shut || st.root === EDITOR) { await page.close(); page = await fresh(); }
      }
    } finally { await page.close(); }
    return { found, failed };
  };

  for (const route of ROUTES) {
    for (const theme of ['light', 'dark']) {
      test(`${route.name}, ${theme}: axe finds no violation outside test/a11y-baseline.json, and every baseline entry still reproduces`, async (t) => {
        const { found, failed } = await scanRoute(route, theme);
        assert.deepEqual(failed, [], `an open state could not open: its selectors rotted`);
        const seen = new Map(found.map((f) => [f.key, f]));
        const mine = Object.keys(BASELINE).filter((k) => { const p = partsOf(k); return p.route === route.name && p.theme === theme; });
        const added = [...seen.keys()].filter((k) => !Object.hasOwn(BASELINE, k)).sort();
        const dropped = mine.filter((k) => !seen.has(k)).sort();
        for (const k of added) { const f = seen.get(k); t.diagnostic(`a11y-new ${k} :: ${f.impact} :: ${f.help} :: ${f.contrast ?? ''}`); }
        assert.deepEqual(added, [], `new axe violations: fix them; test/a11y-baseline.json only shrinks`);
        assert.deepEqual(dropped, [], `fixed: remove these from test/a11y-baseline.json in this change`);
      });
    }
  }

  test('every baseline entry names a route, a state, a theme, a scanned rule and the Issue row that tracks it', () => {
    const names = new Set(ROUTES.map((r) => r.name));
    for (const [k, row] of Object.entries(BASELINE)) {
      const p = partsOf(k);
      assert.ok(names.has(p.route), `${k}: unknown route`);
      assert.ok(['light', 'dark'].includes(p.theme), `${k}: unknown theme`);
      assert.ok(RULES.includes(p.rule), `${k}: rule outside the scanned set`);
      assert.ok(p.target, `${k}: no target`);
      assert.ok(Number.isInteger(row) && row > 0, `${k}: needs its Issue row number, got ${row}`);
    }
  });

  test('the editor is scanned, with only the rules Vditor\'s own markup trips switched off inside it', () => {
    assert.deepEqual(Object.keys(EDITOR_OFF).filter((r) => !RULES.includes(r)), [], 'a disabled rule must be one the suite runs');
    assert.ok(EDITOR_RULES.includes('color-contrast') && EDITOR_RULES.includes('label'), 'contrast and labels still run inside the editor');
  });

  const ringContrast = (page, sel) => page.evaluate((selector) => {
    const target = document.querySelector(selector);
    if (!target) return { missing: selector };
    target.focus();
    const rgb = (c) => {
      const cv = document.createElement('canvas').getContext('2d');
      cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }) => {
      const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bg = null;
    for (let n = target.parentElement; n && !bg; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.a > 0.9) bg = c;
    }
    bg ??= rgb(getComputedStyle(document.body).backgroundColor);
    const cs = getComputedStyle(target);
    const inset = cs.boxShadow.match(/^(rgba?\([^)]*\)) 0px 0px 0px ([\d.]+)px inset$/);
    const ring = rgb(inset && cs.outlineStyle === 'none' ? inset[1] : cs.outlineColor);
    const [a, b] = [lum(ring), lum(bg)].sort((x, y) => y - x);
    return {
      inset: inset ? parseFloat(inset[2]) : 0,
      focused: document.activeElement === target,
      visible: target.matches(':focus-visible'),
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
      alpha: ring.a,
      ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100,
    };
  }, sel);

  const at = (hash, ready, theme) => open(`${base}/${hash}`, ready, theme);

  for (const theme of ['light', 'dark']) {
    test(`${theme}: toolbar, dock, sidebar and name field carry one ring at 3:1 or better`, async () => {
      const page = await at(`#/table/${issue.id}`, ROW, theme);
      try {
        await page.keyboard.press('Tab');
        for (const sel of ['.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn']) {
          const r = await ringContrast(page, sel);
          assert.ok(r.focused && r.visible, `${sel} takes keyboard focus (${JSON.stringify(r)})`);
          assert.equal(r.style, 'solid', `${sel} draws the outline ring`);
          assert.ok(r.width >= 2, `${sel} ring is ${r.width}px`);
          assert.equal(r.alpha, 1, `${sel} ring is opaque`);
          assert.ok(r.ratio >= 3, `${sel} ring contrast ${r.ratio}:1 in ${theme}`);
        }
        await page.click('td.pid-cell a.open-link');
        await page.waitForSelector('#dock .pose-btn');
        await page.keyboard.press('Shift+Tab');
        for (const sel of ['#dock .pose-btn', '#dock button[aria-label^="Close"]']) {
          const r = await ringContrast(page, sel);
          assert.ok(r.focused && r.visible, `${sel} takes keyboard focus (${JSON.stringify(r)})`);
          assert.ok(r.style === 'solid' && r.width >= 2 && r.alpha === 1, `${sel} draws the branded ring (${JSON.stringify(r)})`);
          assert.ok(r.ratio >= 3, `${sel} ring contrast ${r.ratio}:1 in ${theme}`);
        }
      } finally { await page.close(); }
      const ent = await at(`#/entity/${entityId}`, '.entity-head', theme);
      try {
        await ent.keyboard.press('Tab');
        const name = await ringContrast(ent, '.entity-head textarea.name-edit');
        assert.ok(name.focused && name.style === 'none' && name.inset === 1.5 && name.alpha === 1, `the name field draws the one .wv-edit ring, no outline (Issue #1030) (${JSON.stringify(name)})`);
        assert.ok(name.ratio >= 3, `name field ring contrast ${name.ratio}:1 in ${theme}`);
        for (const sel of ['#nav .nav-db', '#search-btn']) {
          const r = await ringContrast(ent, sel);
          assert.ok(r.focused && r.visible, `${sel} takes keyboard focus (${JSON.stringify(r)})`);
          assert.ok(r.style === 'solid' && r.width >= 2 && r.alpha === 1, `${sel} draws the branded ring (${JSON.stringify(r)})`);
          assert.ok(r.ratio >= 3, `${sel} ring contrast ${r.ratio}:1 in ${theme}`);
        }
      } finally { await ent.close(); }
    });
  }

  test('the first Tab stop is a skip link that lands on #main', async () => {
    const page = await at(`#/table/${task.id}`, ROW, 'light');
    try {
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => {
        const a = document.activeElement;
        const r = a.getBoundingClientRect();
        return { cls: a.className, href: a.getAttribute('href'), text: a.textContent.trim(), onScreen: r.width > 0 && r.top >= 0 };
      });
      assert.equal(first.cls, 'skip-link');
      assert.equal(first.text, 'Skip to content');
      assert.ok(first.onScreen, 'it shows itself once focused');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', 'Enter moves focus into the content');
      assert.match(await page.evaluate(() => location.hash), /^#\/table\//, 'and leaves the route alone');
    } finally { await page.close(); }
  });

  test('grid inputs are named by column and row', async () => {
    const page = await at(`#/table/${issue.id}`, ROW, 'light');
    try {
      const names = await page.$$eval('.wv-grid tbody tr.entity-row td .inline-edit', (xs) => xs.map((x) => x.getAttribute('aria-label')));
      assert.ok(names.length > 0, 'the grid has inline editors');
      assert.ok(names.includes('Points, Grid is slow'), `a number cell reads "Points, Grid is slow" (got ${JSON.stringify(names)})`);
      assert.ok(names.every(Boolean), 'every inline editor has a name');
    } finally { await page.close(); }
  });

  const hitArea = (page, sels, square = true) => page.evaluate(([list, sq]) => list.map((sel) => {
    const n = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length);
    if (!n) return { sel, missing: true };
    n.scrollIntoView({ block: 'center', inline: 'center' });
    const r = n.getBoundingClientRect();
    const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
    const misses = (sq ? [[-11.5, -11.5], [11.5, -11.5], [-11.5, 11.5], [11.5, 11.5]] : [[0, -11.5], [0, 11.5]])
      .filter(([dx, dy]) => !n.contains(document.elementFromPoint(cx + dx, cy + dy)));
    const why = misses.map(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      return `${dx},${dy} -> ${hit ? hit.tagName + '.' + (hit.className || '') : 'null'}`;
    });
    return { sel, box: `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`, misses: misses.length, why };
  }), [sels, square]);

  test('small controls offer a 24px hit area', async () => {
    const page = await at(`#/table/${issue.id}`, ROW, 'light');
    try {
      await page.hover('#nav .nav-db');
      for (const h of await hitArea(page, ['#nav-collapse', 'button.add-field-btn', '.nav-db-menu .dots-btn', 'td.pid-cell a.open-link', 'button.mention-caret'])) {
        assert.ok(!h.missing, `${h.sel} is on the page`);
        assert.equal(h.misses, 0, `${h.sel} (${h.box}) takes a click across 24px; missed: ${JSON.stringify(h.why)}`);
      }
      assert.equal(await page.$eval('button.mention-caret', (c) => c.closest('a') ? 'inside the link' : 'beside the link'), 'beside the link',
        'the caret is its own target, so the 24px box can claim the pixels around it');
    } finally { await page.close(); }
    const ent = await at(`#/entity/${entityId}`, '.entity-head', 'light');
    try {
      for (const h of await hitArea(ent, ['button.doc-caret'])) {
        assert.ok(!h.missing, `${h.sel} is on the page`);
        assert.equal(h.misses, 0, `${h.sel} (${h.box}) takes a click across 24px; missed: ${JSON.stringify(h.why)}`);
      }
    } finally { await ent.close(); }
  });
}
