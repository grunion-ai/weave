import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch, settled, atRest } from './lib/browser.mjs';
import { ROUTES, SEEDS, readyOf, walked } from './lib/states.mjs';
import { createOidc } from '../src/oidc.js';
import { createBilling } from '../src/billing.js';
import { Weave } from '../src/engine.js';
import { Store } from '../src/store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AXE = readFileSync(join(HERE, 'vendor/axe-4.10.2.min.js'), 'utf8');
const BASELINE = JSON.parse(readFileSync(join(HERE, 'a11y-baseline.json'), 'utf8')).violations;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const EDITOR = '.vditor';
const EDITOR_OFF = {};
const disabled = (off) => Object.fromEntries(Object.keys(off).map((r) => [r, { enabled: false }]));
const VIEWPORTS = { desktop: { viewport: { width: 1280, height: 800 } }, phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
const ROW = '.wv-grid tbody tr.entity-row';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const keyOf = ({ route, state, theme, cell, rule, target }) => [route, state, theme, cell, rule, target.replace(UUID, '#')].join(' | ');
const partsOf = (key) => {
  const [route, state, theme, cell, rule, target] = key.split(' | ');
  return { route, state, theme, cell, rule, target };
};

await import('../public/chip-core.js');
const chips = globalThis.chipCore;
const WORKSPACE = {
  baseline: { id: '00000000-0000-4000-8000-000000000008', hue: 'blue' },
  doors: { id: '00000000-0000-4000-8000-000000000004', hue: 'cyan' },
};
const pinnedWeave = (id) => () => {
  const state = { version: 2, meta: { id, name: 'personal-workspace', createdAt: new Date().toISOString(), percentFractional: true }, spaces: {}, tables: {}, entities: {}, automations: {} };
  const store = new Store(null);
  store.load = () => state;
  return new Weave({ store });
};

test('both a11y workspaces hold a pinned id, so axe sees the same selector pool every run (Issue #1232)', () => {
  for (const [which, want] of Object.entries(WORKSPACE)) {
    assert.equal(chips.hueForName(want.id), want.hue, `${which}'s pinned id has to hash to ${want.hue}`);
    assert.notEqual(want.hue, 'green', `${which} must not take the hue the Done chip already carries`);
  }
});

test('no a11y baseline key is coupled to a workspace hue (Issue #1232)', () => {
  for (const key of Object.keys(BASELINE)) {
    assert.doesNotMatch(key, /hue-/, `${key} pins a hue class, which moves with the seed workspace id`);
  }
});

const s = await launch('a11y baseline', SEEDS.a11y, { weave: pinnedWeave(WORKSPACE.baseline.id) });

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
}, { weave: pinnedWeave(WORKSPACE.doors.id), server: () => ({
  oidc: createOidc({ issuer: 'https://idp.a11y.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }),
  billing: createBilling({ secretKey: 'sk_test_x', plan: 'seat', issuer: ISSUER, publishableKey: null, fetch: nobody }),
}) });

if (s && doors) {
  test('each a11y launch runs on its pinned workspace id, so no run draws a different hue (Issue #1232)', () => {
    assert.equal(s.weave.state.meta.id, WORKSPACE.baseline.id, 'the baseline workspace is not pinned');
    assert.equal(doors.weave.state.meta.id, WORKSPACE.doors.id, 'the doors workspace is not pinned');
  });

  const { base, browser } = s;

  const { task, issue, entityId } = s;
  const ctx = { ...s, doors };
  const plan = walked('a11y');
  const routes = plan.filter((p) => p.state.open === 'rest');
  const statesOn = (route, theme, cell) => plan.filter((p) => p.state.open === 'overlay' && p.state.route === route && p.theme === theme && p.cell === cell).map((p) => p.state);

  const open = async (url, ready, theme, { session = false, cell = 'desktop' } = {}) => {
    const ctx = await (session ? doors : s).browser.newContext({ ...VIEWPORTS[cell], colorScheme: theme });
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
    const run = (context, rules) => page.evaluate(([c, r, tags]) => window.axe.run(
      c.include ? { include: [[c.include]], exclude: c.exclude ? [[c.exclude]] : [] } : { exclude: c.exclude ? [[c.exclude]] : [] },
      { runOnly: { type: 'tag', values: tags }, rules: r, resultTypes: ['violations'] },
    ).then((res) => res.violations.flatMap((v) => v.nodes.map((n) => ({
      rule: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, target: n.target.join(' '),
      contrast: n.any[0]?.data?.contrastRatio ? `${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}:1` : null,
    })))), [context, rules, TAGS]);
    if (root === EDITOR) return run({ include: EDITOR }, disabled(EDITOR_OFF));
    if (root) return run({ include: root }, {});
    const outside = await run({ exclude: EDITOR }, {});
    return editor ? [...outside, ...await run({ include: EDITOR }, disabled(EDITOR_OFF))] : outside;
  };

  const effectiveTheme = (page) => page.evaluate(() => document.documentElement.dataset.bsTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  const scanRoute = async (state, theme, cell) => {
    const found = [];
    const failed = [];
    const route = ROUTES[state.route];
    const add = (name, list) => { for (const v of list) found.push({ ...v, key: keyOf({ route: state.name, state: name, theme, cell, rule: v.rule, target: v.target }) }); };
    const fresh = async () => {
      const page = await open(route.url(ctx, cell), readyOf(state, cell), theme, { session: route.session, cell });
      if (route.setup) await route.setup(page, ctx, cell);
      return page;
    };
    let page = await fresh();
    try {
      assert.equal(await effectiveTheme(page), theme, `${state.name} paints the ${theme} theme`);
      if (route.editor) assert.ok(await page.locator(`${EDITOR} >> visible=true`).count() > 0, `${state.name} shows the document editor the scan covers`);
      add('at rest', await axe(page, { editor: await page.locator(EDITOR).count() > 0 }));
      for (const st of statesOn(state.route, theme, cell)) {
        try {
          await st.act(page, ctx, cell);
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

  for (const { state, theme, cell } of routes) {
    test(`${state.name}, ${theme}, ${cell}: axe finds no violation outside test/a11y-baseline.json, and every baseline entry still reproduces`, async (t) => {
      const { found, failed } = await scanRoute(state, theme, cell);
      assert.deepEqual(failed, [], `an open state could not open: its selectors rotted`);
      const seen = new Map(found.map((f) => [f.key, f]));
      const mine = Object.keys(BASELINE).filter((k) => { const p = partsOf(k); return p.route === state.name && p.theme === theme && p.cell === cell; });
      const added = [...seen.keys()].filter((k) => !Object.hasOwn(BASELINE, k)).sort();
      const dropped = mine.filter((k) => !seen.has(k)).sort();
      for (const k of added) { const f = seen.get(k); t.diagnostic(`a11y-new ${k} :: ${f.impact} :: ${f.help} :: ${f.contrast ?? ''}`); }
      assert.deepEqual(added, [], `new axe violations: fix them; test/a11y-baseline.json only shrinks`);
      assert.deepEqual(dropped, [], `fixed: remove these from test/a11y-baseline.json in this change`);
    });
  }

  test('every baseline entry names a route, a state, a theme, a width band, a scanned rule and the Issue row that tracks it', () => {
    const names = new Set(routes.map((p) => p.state.name));
    const bands = new Set(routes.map((p) => p.cell));
    for (const [k, row] of Object.entries(BASELINE)) {
      const p = partsOf(k);
      assert.ok(names.has(p.route), `${k}: unknown route`);
      assert.ok(['light', 'dark'].includes(p.theme), `${k}: unknown theme`);
      assert.ok(bands.has(p.cell), `${k}: unknown width band`);
      assert.ok(p.rule, `${k}: no rule`);
      assert.ok(p.target, `${k}: no target`);
      assert.ok(Number.isInteger(row) && row > 0, `${k}: needs its Issue row number, got ${row}`);
    }
  });

  test('the scan runs every WCAG A and AA rule axe carries, so a rule nobody listed still fails the gate (Issue #1449)', async () => {
    const page = await open(ROUTES.home.url(ctx, 'desktop'), readyOf({ route: 'home' }, 'desktop'), 'light');
    try {
      const ids = await page.evaluate(async (axeSrc) => {
        if (!window.axe) { const el = document.createElement('script'); el.textContent = axeSrc; document.head.appendChild(el); }
        return window.axe.getRules(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).map((r) => r.ruleId);
      }, AXE);
      assert.ok(ids.length >= 60, `axe carries ${ids.length} WCAG A and AA rules; the scan used to run five of them`);
      for (const id of ['meta-viewport', 'button-name', 'image-alt', 'link-name', 'html-has-lang', 'frame-title']) {
        assert.ok(ids.includes(id), `${id} is one of the rules the tag set now runs`);
      }
    } finally { await page.close(); }
  });

  test('a planted unlabelled button fails the scan, so the gate is proven to catch a violation nobody baselined (Issue #1449)', async () => {
    const page = await open(ROUTES.home.url(ctx, 'desktop'), readyOf({ route: 'home' }, 'desktop'), 'light');
    try {
      const clean = await axe(page);
      assert.deepEqual(clean.filter((v) => v.rule === 'button-name'), [], 'the home route has no unlabelled button of its own');
      await page.evaluate(() => {
        const b = document.createElement('button');
        b.id = 'wv-planted-a11y-failure';
        document.body.appendChild(b);
      });
      const planted = await axe(page);
      const hit = planted.filter((v) => v.rule === 'button-name');
      assert.equal(hit.length, 1, `the scan reports the planted button; it reported ${JSON.stringify(planted.map((v) => v.rule))}`);
      assert.match(hit[0].target, /wv-planted-a11y-failure/);
      assert.ok(!Object.keys(BASELINE).some((k) => partsOf(k).rule === 'button-name'), 'no baseline entry would have swallowed it');
    } finally { await page.close(); }
  });

  test('the editor is scanned, with only the rules Vditor\'s own markup trips switched off inside it', () => {
    assert.deepEqual(Object.keys(EDITOR_OFF), [], 'every rule the scan runs outside the editor also runs inside it');
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
        for (const sel of ['#main .table-view-btn']) {
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
        assert.ok(name.focused && name.style === 'none' && name.inset === 2 && name.alpha === 1, `the name field draws the one .wv-edit ring, no outline (Issue #1030) (${JSON.stringify(name)})`);
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
