import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const MIN = 44;
const STEP = 0.5;
const SPAN = MIN - 1;
const IPHONE = phoneProfile()?.page ?? null;

const SWEEP = (roots) => {
  const SEL = 'a[href], button, [role="button"], summary, input:not([type="hidden"]), select, textarea, tbody tr.entity-row';
  const tops = roots.flatMap((r) => [...document.querySelectorAll(r)]);
  const inRoot = (n) => tops.some((t) => t.contains(n));
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || !n.getClientRects().length) return false;
    const shut = n.closest('details:not([open])');
    if (n.disabled || (shut && n !== shut.querySelector(':scope > summary'))) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  };
  const label = (n) => {
    const cls = [...n.classList].slice(0, 2).join('.');
    const name = (n.getAttribute('aria-label') || n.title || n.dataset.field || (n.textContent || '').trim().slice(0, 32) || '').replace(/\s+/g, ' ');
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${name}"`;
  };
  const owns = (n, hit) => !!hit && (hit === n || n.contains(hit));
  const overlay = (n, hit) => {
    for (let p = hit; p && p !== document.documentElement; p = p.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(p).position)) return !p.contains(n);
    }
    return false;
  };
  const reach = (n, cx, cy, dx, dy) => {
    let far = 0;
    for (let d = 0.5; d <= 22; d += 0.5) {
      const x = cx + dx * d, y = cy + dy * d;
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) return 22;
      const hit = document.elementFromPoint(x, y);
      if (!owns(n, hit)) return overlay(n, hit) ? 22 : far;
      far = d;
    }
    return far;
  };
  const found = tops.flatMap((t) => [...t.querySelectorAll(SEL)]).filter(shown);
  const candidates = new Set(found);
  const out = [];
  for (const n of found) {
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!owns(n, hit)) {
      if (!hit || !inRoot(hit) || overlay(n, hit)) continue;
      let up = hit;
      while (up && !candidates.has(up)) up = up.parentElement;
      if (up && up.contains(n)) continue;
      out.push({ label: label(n), left: 0, right: 0, up: 0, down: 0, over: label(hit) });
      continue;
    }
    out.push({
      label: label(n),
      left: reach(n, cx, cy, -1, 0), right: reach(n, cx, cy, 1, 0),
      up: reach(n, cx, cy, 0, -1), down: reach(n, cx, cy, 0, 1),
    });
  }
  return out;
};

const s = await launch('phone touch targets', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue', description: Array.from({ length: 9 }, (_, i) => `Line ${i + 1} of a table description long enough that the phone header clamps it and offers Show more.`).join('\n\n') });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data'] } });
  weave.addField(issues, { name: 'Notes', type: 'text' });
  weave.addField(issues, { name: 'Due', type: 'date' });
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push(weave.createEntity(issues, {
      name: `Issue ${i}: a phone row name long enough to wrap`,
      values: { Status: 'Open', Severity: 'High', Symptom: ['Looks broken', 'Slow'], Notes: 'a note' },
    }));
  }
  weave.setDoc(rows[0].id, 'Some body text.\n\nAnother paragraph.');
  return { table: issues.id, row: rows[0].id };
});

if (s) {
  const { base, browser, table, row } = s;
  const surfaces = [
    { name: 'workspace home', hash: '#/', roots: ['#main'] },
    { name: 'table list', hash: `#/table/${table}`, ready: '#main .wv-grid tbody tr.entity-row', roots: ['#main'] },
    { name: 'row page', hash: `#/table/${table}?e=${row}`, ready: '#dock .entity-fields .fieldrow', roots: ['#dock'] },
    { name: 'menu', hash: `#/table/${table}`, ready: '#main .nav-menu', roots: ['#sidebar', '#ws-rail'], act: (p) => p.click('#main .nav-menu') },
    { name: 'picker sheet', hash: `#/table/${table}?e=${row}`, ready: '#dock .chip-trigger[title="Status"]', roots: ['.picker-pop'], act: (p) => p.click('#dock .chip-trigger[title="Status"]') },
    { name: 'bug panel', hash: `#/table/${table}`, ready: '.bug-fab', roots: ['#bug-panel'], act: (p) => p.click('.bug-fab') },
  ];
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);

  const open = async (b, profile, theme, surface) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${surface.hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(surface.ready ?? surface.roots[0], { state: 'attached' });
    if (surface.act) {
      await surface.act(page);
      await page.waitForSelector(surface.roots[0]);
    }
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    return page;
  };

  for (const [engine, b, profile] of engines) {
    const themes = engine.startsWith('chromium') ? ['light', 'dark'] : ['light'];
    for (const theme of themes) {
      for (const surface of surfaces) {
        test(`on a phone every control on the ${surface.name} keeps a ${MIN}px hit area (${engine}, ${theme}, Issue #737)`, async () => {
          const page = await open(b, profile, theme, surface);
          try {
            const seen = await page.evaluate(SWEEP, surface.roots);
            assert.ok(seen.length >= 1, `the ${surface.name} offers controls to sweep`);
            const small = seen.filter((c) => c.left + c.right < SPAN || c.up + c.down < SPAN);
            const offenders = small.map((c) => (c.over
              ? `${c.label} is covered by ${c.over}`
              : `${c.label} taps ${c.left + c.right}x${c.up + c.down} of the ${MIN}px minimum`));
            assert.deepEqual(offenders, [], `${small.length} of ${seen.length} controls on the ${surface.name} miss a ${MIN}px hit area:\n${offenders.join('\n')}`);
          } finally { await page.close(); }
        });
      }
    }
  }

  test('on a desktop the same chrome keeps its drawn size (Issue #737)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${table}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
      const h = await page.evaluate(() => {
        const box = (q) => { const n = document.querySelector(q); return n ? Math.round(n.getBoundingClientRect().height) : null; };
        return { title: box('#main .view-title'), crumb: box('#main .crumb-item') };
      });
      assert.ok(h.title !== null && h.title < MIN, `the desktop title stays ${h.title}px`);
      assert.ok(h.crumb !== null && h.crumb < MIN, `the desktop crumb stays ${h.crumb}px`);
    } finally { await page.close(); }
  });
}
