import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, settled, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('phone row fields', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data'] } });
  weave.addField(issues, { name: 'Area', type: 'select', config: { options: ['Grid', 'Phone shell'] } });
  for (let i = 0; i < 8; i++) {
    const e = weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: i % 2 ? 'Fixed' : 'Open', Severity: 'High', Symptom: ['Slow'], Area: 'Grid' } });
    weave.setDoc(e.id, `Fixed 2026-08-21 in a long note number ${i}`, 'Description');
  }
  weave.tableView('Development/Issue/Standard', { fields: ['Name', 'Description', 'Status', 'Severity', 'Symptom'] });
  return { id: issues.id };
});

if (s) {
  const { base, browser, id } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const view = (page) => page.evaluate(async (id) => (await (await fetch(`/api/tables/${id}/views/Standard`)).json()), id);
  const write = (page, patch) => page.evaluate(async ([id, patch]) => {
    const r = await fetch(`/api/tables/${id}/views/Standard`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    return r.status;
  }, [id, patch]);
  const open = async (b, profile, theme = 'light') => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
    await page.waitForTimeout(150);
    return page;
  };
  const reset = (page) => write(page, { phoneRow: null, fields: ['Name', 'Description', 'Status', 'Severity', 'Symptom'] });
  const row = (page, n = 0) => page.evaluate((n) => {
    const tr = document.querySelectorAll('#main .wv-list .list-row')[n];
    const r = tr.getBoundingClientRect();
    const box = (x) => { const b = x.getBoundingClientRect(); return { left: b.left, top: b.top - r.top, right: b.right, bottom: b.bottom - r.top }; };
    const lead = tr.querySelector('.phone-lead');
    const pid = tr.querySelector('.list-pid');
    const chips = [...tr.querySelectorAll('.phone-chip[data-field]')].filter((td) => td.getClientRects().length)
      .map((td) => ({ field: td.dataset.field, text: td.textContent.trim(), label: getComputedStyle(td, '::before').content, ...box(td) }))
      .sort((a, b) => a.top - b.top || a.left - b.left);
    return {
      theme: document.documentElement.dataset.bsTheme,
      h: Math.round(r.height),
      lead: lead && lead.getClientRects().length ? { text: lead.textContent.trim(), ...box(lead) } : null,
      pid: box(pid),
      chips,
      more: [...tr.querySelectorAll('.phone-chip[data-more]')].map((td) => td.dataset.more),
    };
  }, n);

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a view nobody set leads with Status before the #id and chips its short fields, never the Description (${engine}, ${theme}, Feature #299)`, async () => {
        const page = await open(b, profile, theme);
        try {
          await reset(page);
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
          const r = await row(page);
          assert.equal(r.theme, theme);
          assert.ok(r.h >= 44, 'a touch row');
          assert.ok(r.lead, 'the lead mark shows');
          assert.equal(r.lead.text, 'Open');
          assert.ok(r.lead.right <= r.pid.left + 0.5 && Math.abs(r.lead.top - r.pid.top) < 6, 'on line one, before the #id');
          assert.deepEqual(r.chips.map((c) => c.field), ['Severity', 'Symptom'], 'Description stays off and Status is not repeated as a chip');
          assert.ok(r.chips.every((c) => c.top > r.pid.top + 10), 'the chips sit on line two');
        } finally { await page.close(); }
      });
    }

    test(`on a phone Fields opens the Phone row sheet, and a slot change autosaves into the view without touching the desktop columns (${engine}, Feature #299)`, async () => {
      const page = await open(b, profile);
      try {
        await reset(page);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
        await page.click('#main .table-tools-btn');
        await settled(page.locator('#main .crumb-actions'));
        await page.click('#main .crumb-actions .eye-btn');
        await page.waitForSelector('.phone-row-popover');
        await settled(page.locator('.phone-row-popover'));
        const sheet = await page.evaluate(() => {
          const pop = document.querySelector('.phone-row-popover');
          return {
            title: pop.querySelector('.table-control-head strong').textContent,
            desktopList: !!pop.querySelector('.table-field-list'),
            rows: [...pop.querySelectorAll('.phone-row-field')].map((r) => `${r.dataset.field}:${r.querySelector('.seg-opt.on')?.dataset.slot}`),
            small: [...pop.querySelectorAll('.phone-row-field .seg-opt, .phone-row-popover .eye-row')].filter((x) => x.getBoundingClientRect().height < 44).length,
          };
        });
        assert.equal(sheet.title, 'Phone row');
        assert.equal(sheet.desktopList, false, 'not the desktop column list');
        assert.deepEqual(sheet.rows, ['Status:lead', 'Severity:chips', 'Symptom:chips', 'Description:off', 'Area:off', 'Chip:off', 'Card:off']);
        assert.equal(sheet.small, 0, 'every control is a 44px target');
        await page.click('.phone-row-field[data-field="Area"] .seg-opt[data-slot="chips"]');
        await page.waitForFunction(() => [...(document.querySelector('#main .wv-list .list-row')?.querySelectorAll('.phone-chip[data-field]') ?? [])].some((td) => td.dataset.field === 'Area' && td.getClientRects().length), null, { timeout: 10000 });
        await page.click('.phone-row-field[data-field="Symptom"] .seg-opt[data-slot="off"]');
        await page.waitForFunction(async (id) => {
          const v = await (await fetch(`/api/tables/${id}/views/Standard`)).json();
          return v.phoneRow && !v.phoneRow.chips.includes('Symptom');
        }, id, { timeout: 10000 });
        const v = await view(page);
        assert.deepEqual(v.phoneRow, { lead: 'Status', chips: ['Severity', 'Area'] });
        assert.deepEqual(v.fields, ['Name', 'Description', 'Status', 'Severity', 'Symptom'], 'the desktop columns are untouched');
        await page.waitForFunction(() => !document.querySelector('#main .wv-list .list-row .phone-chip[data-field="Symptom"]')?.getClientRects().length, null, { timeout: 10000 });
        const r = await row(page);
        assert.deepEqual(r.chips.map((c) => c.field), ['Severity', 'Area'], 'a desktop-hidden field can be a chip');
      } finally { await reset(page); await page.close(); }
    });

    test(`on a phone the chips follow the saved order, name their field when labels are on, and wrap inside the row instead of a +N (${engine}, Feature #299)`, async () => {
      const page = await open(b, profile);
      try {
        assert.equal(await write(page, { phoneRow: { lead: 'Severity', chips: ['Area', 'Symptom', 'Status'], labels: true } }), 200);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
        let r = await row(page);
        assert.equal(r.lead.text, 'High');
        const shown = r.chips.map((c) => c.field);
        assert.deepEqual(shown, ['Area', 'Symptom', 'Status'].slice(0, shown.length), 'drag order, left to right');
        assert.ok(r.chips.every((c) => c.label.includes(c.field)), 'each chip names its field');
        assert.equal(await write(page, { phoneRow: { chips: ['Area', 'Symptom', 'Status', 'Description'], labels: false, wrap: true } }), 200);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
        r = await row(page);
        assert.ok(r.chips.every((c) => c.bottom <= r.h + 0.5), 'every chip sits inside the row');
        assert.equal(r.more.length, 0, 'wrapping shows every chip, so nothing is counted');
        assert.ok(r.chips.length >= 3, 'the chips wrap rather than drop');
      } finally { await reset(page); await page.close(); }
    });
  }

  test('on a desktop the phone row draws nothing: no lead mark, no extra cells, the same columns (Feature #299)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } });
    try {
      await write(page, { phoneRow: { lead: 'Status', chips: ['Area'] } });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
      const seen = await page.evaluate(() => ({
        lead: [...document.querySelectorAll('#main .phone-lead')].filter((x) => x.getClientRects().length).length,
        extra: [...document.querySelectorAll('#main tbody tr.entity-row:first-child > td[data-field]')].filter((x) => x.getClientRects().length).map((x) => x.dataset.field),
        heads: [...document.querySelectorAll('#main thead th.col-head')].map((x) => x.dataset.col),
      }));
      assert.equal(seen.lead, 0);
      assert.deepEqual(seen.extra, ['Name', 'Description', 'Status', 'Severity', 'Symptom']);
      assert.deepEqual(seen.heads, ['Name', 'Description', 'Status', 'Severity', 'Symptom']);
    } finally { await reset(page); await page.close(); }
  });
}
