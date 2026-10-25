import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, settled } from './lib/browser.mjs';

const s = await launch('phone chip hit', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addField(issues, { name: 'Milestone', type: 'select', config: { options: ['v0.5', 'v0.6'] } });
  const rows = [
    ['Short name', 'Open'],
    ['A much longer issue name that wraps onto a second line on a phone screen', 'In progress'],
    ['Short name', 'In progress'],
    ['A much longer issue name that wraps onto a second line on a phone screen', 'Open'],
  ];
  for (const [name, Status] of [...rows, ...rows]) weave.createEntity(issues, { name, values: { Status, Severity: 'High', Milestone: 'v0.5' } });
  weave.tableView('Development/Issue/Standard', { fields: ['Name', 'Status', 'Severity', 'Milestone'], phoneRow: { lead: 'Status', chips: ['Severity', 'Milestone'] } });
  return { id: issues.id };
});

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

const geometry = (page, n) => page.evaluate((n) => {
  const tr = document.querySelectorAll('#main tbody tr.entity-row')[n];
  tr.scrollIntoView({ block: 'center' });
  const rect = (x) => { const r = x.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const nodes = {
    lead: tr.querySelector('.phone-lead'),
    severity: tr.querySelector(':scope > td[data-field="Severity"]'),
    milestone: tr.querySelector(':scope > td[data-field="Milestone"]'),
    link: tr.querySelector(':scope > td.pid-cell .open-link:not(.pid-probe)'),
    name: tr.querySelector(':scope > td.pid-cell .list-name'),
  };
  const keys = Object.keys(nodes);
  const hit = globalThis.weavePhoneRow.hitBoxes?.(rect(tr), keys.map((k) => rect(nodes[k]))) ?? keys.map((k) => rect(nodes[k]));
  return {
    row: rect(tr),
    pill: { lead: rect(nodes.lead.firstElementChild), severity: rect(nodes.severity.querySelector('.chip-trigger')), milestone: rect(nodes.milestone.querySelector('.chip-trigger')) },
    drawn: Object.fromEntries(keys.map((k) => [k, rect(nodes[k])])),
    hit: Object.fromEntries(keys.map((k, i) => [k, hit[i]])),
  };
}, n);

const size = (b) => ({ w: Math.round(b.right - b.left), h: Math.round(b.bottom - b.top) });
const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;

if (s) {
  const { base, browser, id } = s;
  const engines = [['chromium', browser]];
  const webkit = await engineOf('webkit');
  if (webkit) engines.push(['webkit', webkit]);
  const open = async (b) => {
    const page = await b.newPage(PHONE);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tbody tr.entity-row td[data-field="Milestone"] .chip-trigger');
    await settled(page.locator('#main .table-wrap'));
    return page;
  };
  const tapOpens = async (page, x, y) => {
    await page.touchscreen.tap(x, y);
    const got = await Promise.race([
      page.waitForSelector('.picker-pop .picker-title', { timeout: 5000 }).then((n) => n.textContent()),
      page.waitForURL(/\?e=/, { timeout: 5000 }).then(() => 'row'),
    ]);
    if (got === 'row') {
      await page.click('#dock button[aria-label="Close"]');
      await page.waitForSelector('#dock', { state: 'hidden' });
    } else {
      await page.click('.picker-pop button:has(.chip-pop-check)');
      await page.waitForSelector('.picker-pop', { state: 'detached' });
    }
    return got.trim();
  };

  for (const [engine, b] of engines) {
    test(`on a 375x812 phone the state chip and each select chip own a hit box of at least 44x44 that keeps the drawn pill and clears the #id link and each other (${engine}, Issue #1032)`, async () => {
      const page = await open(b);
      try {
        for (const n of [0, 1, 2, 3]) {
          const g = await geometry(page, n);
          const report = JSON.stringify({ n, lead: size(g.hit.lead), severity: size(g.hit.severity), milestone: size(g.hit.milestone), pill: size(g.pill.lead) });
          for (const k of ['lead', 'severity', 'milestone']) {
            const { w, h } = size(g.hit[k]);
            const underName = g.drawn.name.left < g.drawn[k].right && g.drawn.name.bottom > g.row.bottom - 44;
            if (k === 'milestone' && underName) {
              assert.ok(w >= 44, `row ${n} ${k} hit box is ${w} wide: ${report}`);
              assert.equal(g.hit[k].top, (g.drawn.name.bottom + g.drawn[k].top) / 2, `row ${n}: a chip under a two-line name splits that gap at its midpoint: ${report}`);
            } else assert.ok(w >= 44 && h >= 44, `row ${n} ${k} hit box is ${w}x${h}: ${report}`);
          }
          assert.ok(size(g.pill.lead).h <= 22, `the drawn state pill keeps its height: ${report}`);
          assert.ok(size(g.pill.severity).h <= 26 && size(g.pill.milestone).h <= 26, `the drawn select pills keep their height: ${report}`);
          for (const k of ['lead', 'severity', 'milestone']) {
            for (const o of ['lead', 'severity', 'milestone', 'link', 'name']) {
              if (o !== k) assert.ok(apart(g.hit[k], g.hit[o]), `row ${n}: the ${k} hit box clears the ${o} hit box`);
            }
            assert.ok(apart(g.hit[k], g.drawn.link), `row ${n}: the ${k} hit box clears the #id link`);
          }
        }
      } finally { await page.close(); }
    });

    test(`on a 375x812 phone a tap at any edge of the state chip's hit box opens the Status picker, and a tap past the gap midpoint opens the row (${engine}, Issue #1032)`, async () => {
      const page = await open(b);
      try {
        for (const n of [1, 2]) {
          const g = await geometry(page, n);
          const hit = g.hit.lead, pill = g.pill.lead;
          const cy = (pill.top + pill.bottom) / 2, cx = (pill.left + pill.right) / 2;
          for (const [where, x, y] of [
            ['right edge', hit.right - 1, cy], ['left edge', hit.left + 1, cy],
            ['bottom edge', cx, hit.bottom - 1], ['bottom right corner', hit.right - 1, hit.bottom - 1], ['top edge', cx, hit.top + 1],
          ]) {
            const now = await geometry(page, n);
            const dy = now.pill.lead.top - pill.top;
            assert.equal(await tapOpens(page, x, y + dy), 'Status', `row ${n}: a tap on the ${where} of the state hit box opens the Status picker`);
          }
          const now = await geometry(page, n);
          assert.equal(await tapOpens(page, now.drawn.link.left - 1, (now.drawn.link.top + now.drawn.link.bottom) / 2), 'row', `row ${n}: a tap just short of the #id opens the row`);
          const ms = (await geometry(page, n)).hit.milestone;
          assert.equal(await tapOpens(page, ms.left + 1, ms.top + 1), 'Milestone', `row ${n}: the top left corner of the Milestone hit box opens its picker`);
          const ms2 = (await geometry(page, n)).hit.milestone;
          assert.equal(await tapOpens(page, ms2.right - 1, ms2.bottom - 1), 'Milestone', `row ${n}: the bottom right corner of the Milestone hit box opens its picker`);
        }
      } finally { await page.close(); }
    });
  }
}
