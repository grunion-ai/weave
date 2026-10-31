import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled, phoneBrowser, phonePage, engineOf, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('phone row field list', (weave) => {
  weave.createSpace({ name: 'Development' });
  const releases = weave.createTable({ space: 'Development', name: 'Release' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data'] } });
  weave.addField(issues, { name: 'Area', type: 'select', config: { options: ['Layout', 'Grid'] } });
  weave.addField(issues, { name: 'Tags', type: 'multiselect', config: { options: ['phone', 'desktop'] } });
  weave.addRelation(issues, { name: 'Fixed in', targetDb: releases, cardinality: 'many-to-one', inverseName: 'Fixes' });
  weave.addRelation(issues, { name: 'Seen in', targetDb: releases, cardinality: 'many-to-one', inverseName: 'Sightings' });
  const seen = weave.createEntity(releases, { name: 'v0.4.82' });
  const row = weave.createEntity(issues, {
    name: 'Looks broken: the fields block keeps the desktop two-column form',
    values: { Status: 'Open', Severity: 'Medium', Symptom: ['Looks broken'], Area: 'Layout', 'Seen in': seen.id },
  });
  weave.setDoc(row.id, 'Reported by Kyle on his iPhone. The fields section keeps the desktop form.', 'Description');
  return { docked: `#/table/${issues.id}?e=${row.id}` };
});

if (s) {
  const { base, browser, docked } = s;

  const open = async ({ width = null, theme = 'light' } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${docked}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .entity-fields .fieldrow .chip-trigger[title="Status"]');
    await settled(page.locator('#dock .entity-fields .entity-values'));
    return page;
  };

  const read = (page) => page.evaluate(() => {
    const seen = (n) => !!n && getComputedStyle(n).display !== 'none' && n.getClientRects().length > 0;
    const px = (n) => { const b = n.getBoundingClientRect(); return {
      left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
      bottom: Math.round(b.bottom), h: Math.round(b.height), mid: Math.round(b.top + b.height / 2) }; };
    const group = document.querySelector('#dock .entity-fields .entity-values');
    const gs = getComputedStyle(group);
    const rows = [...group.querySelectorAll('.fieldrow')].filter(seen);
    return {
      theme: document.documentElement.dataset.bsTheme,
      group: { ...px(group), radius: parseFloat(gs.borderTopLeftRadius), bg: gs.backgroundColor,
        border: gs.borderTopStyle === 'none' ? 0 : parseFloat(gs.borderTopWidth) + parseFloat(gs.borderLeftWidth) },
      heads: [...document.querySelectorAll('#dock .entity-body > .doc-section .doc-section-head')].filter(seen).map((n) => px(n)),
      pageBg: getComputedStyle(document.body).backgroundColor,
      grips: [...document.querySelectorAll('#dock .entity-fields .opt-grip')].filter(seen).length,
      docSections: [...document.querySelectorAll('#dock .entity-body > .doc-section')].filter(seen).map((n) => px(n)),
      rows: rows.map((n) => {
        const label = n.querySelector('.fieldrow-label');
        const value = n.querySelector(':scope > :not(.opt-grip):not(label):not(.fieldrow-note):not(.fieldrow-chev)');
        const chev = n.querySelector('.fieldrow-chev');
        return {
          field: n.dataset.field ?? label?.textContent.trim() ?? '',
          divider: getComputedStyle(n).boxShadow,
          ftype: n.dataset.ftype ?? null,
          wide: n.classList.contains('fieldrow-wide'),
          cols: getComputedStyle(n).gridTemplateColumns,
          box: px(n),
          label: label ? px(label) : null,
          value: value ? px(value) : null,
          chev: seen(chev) ? px(chev) : null,
          empties: [...n.querySelectorAll('.k-add, .ms-box > .btn')].filter(seen)
            .map((c) => ({ text: c.textContent.trim(), add: c.classList.contains('k-add'), dashed: getComputedStyle(c).borderTopStyle, ...px(c) })),
        };
      }),
    };
  });

  const engines = [['chromium 390x844', { width: 390 }]];
  if ((await engineOf('webkit')) && IPHONE) engines.push(['webkit iPhone 15', {}]);

  for (const [engine, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the fields block is one list of 50px rows, label left and value right (${engine}, ${theme}, Issue #741)`, async () => {
        const page = await open({ ...profile, theme });
        try {
          const r = await read(page);
          assert.equal(r.theme, theme);
          assert.ok(r.rows.length >= 6, `every field keeps a row, got ${r.rows.length}`);
          assert.ok(r.group.left >= 8 && r.group.left <= 24, `the list sits on the pane padding, got ${r.group.left}px`);
          assert.equal(r.grips, 0, 'no drag grip shows on a phone');
          for (const row of r.rows) {
            assert.ok(row.box.h >= 50, `${row.field} is a 50px target, got ${row.box.h}px`);
          }
          for (const row of r.rows.filter((x) => !x.wide)) {
            assert.ok(Math.abs(row.label.mid - row.value.mid) <= 2,
              `${row.field} keeps label and value on one line, label mid ${row.label.mid} vs value mid ${row.value.mid}`);
            assert.ok(row.label.right <= row.value.left, `${row.field} puts the label left of its value`);
          }
          const stacked = r.rows.map((x) => x.box).sort((a, b) => a.top - b.top);
          for (let i = 1; i < stacked.length; i += 1) {
            assert.equal(stacked[i].top, stacked[i - 1].bottom, 'the rows sit flush, divided by a hairline, never spaced');
          }
        } finally { await page.close(); }
      });

      test(`on a phone the fields list sits flush on the page with no outlined panel, its rows split by hairlines (${engine}, ${theme}, Issue #1285)`, async () => {
        const page = await open({ ...profile, theme });
        try {
          const r = await read(page);
          assert.equal(r.theme, theme);
          assert.equal(r.group.border, 0, `the fields list draws no outline, got ${r.group.border}px`);
          assert.equal(r.group.radius, 0, `and no rounded corners, got ${r.group.radius}px`);
          assert.equal(r.group.bg, 'rgba(0, 0, 0, 0)', 'and no panel surface of its own, so the page shows through');
          const [first, ...rest] = r.rows;
          assert.match(first.divider, /inset/, `${first.field} keeps its hairline divider, got ${first.divider}`);
          for (const row of rest.slice(0, -1)) assert.match(row.divider, /inset/, `${row.field} keeps its hairline divider`);
          assert.equal(r.rows.at(-1).divider, 'none', 'the last row closes the list with no divider');
          assert.ok(r.heads.length >= 1, 'the Description section heading shows under the list');
          for (const row of r.rows) {
            assert.ok(Math.abs(row.label.left - r.heads[0].left) <= 1,
              `${row.field} label starts on the section heading's edge, label ${row.label.left} vs heading ${r.heads[0].left}`);
          }
        } finally { await page.close(); }
      });

      test(`on a phone every picker field carries a chevron and the whole row opens its sheet (${engine}, ${theme}, Issue #741)`, async () => {
        const page = await open({ ...profile, theme });
        try {
          const r = await read(page);
          assert.equal(r.theme, theme);
          const sheetKinds = r.rows.filter((x) => ['workflow', 'select', 'multiselect', 'relation'].includes(x.ftype));
          assert.ok(sheetKinds.length >= 6, `the picker fields are marked by kind, got ${sheetKinds.map((x) => x.field).join(', ')}`);
          for (const row of sheetKinds) {
            assert.ok(row.chev, `${row.field} shows a chevron`);
            assert.ok(row.box.right - row.chev.right <= 16, `${row.field} puts its chevron at the right edge`);
          }
          const status = r.rows.find((x) => x.field === 'Status');
          assert.ok(status.label.h >= 44, `the label itself is a real target, got ${status.label.h}px`);
          const fresh = async () => {
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForSelector('#dock:not([hidden]) .entity-fields .fieldrow .chip-trigger[title="Status"]');
            await settled(page.locator('#dock .entity-fields .entity-values'));
          };
          const sheetTitle = async () => {
            await settled(page.locator('.picker-pop'));
            return page.evaluate(() => {
              const p = document.querySelector('.picker-pop');
              return p && { bottom: Math.round(p.getBoundingClientRect().bottom), vh: innerHeight,
                title: p.querySelector('.picker-title')?.textContent.trim() ?? '' };
            });
          };
          await page.click('#dock .entity-fields .fieldrow[data-field="Status"] .fieldrow-chev');
          const byChevron = await sheetTitle();
          assert.ok(byChevron, 'tapping the chevron opens the field sheet');
          assert.equal(byChevron.title, 'Status', 'and the sheet names the field it edits');
          assert.ok(Math.abs(byChevron.bottom - byChevron.vh) <= 2, 'and it comes up from the bottom of the screen');

          await fresh();
          const statusBox = await page.locator('#dock .entity-fields .fieldrow[data-field="Status"]').boundingBox();
          await page.mouse.click(statusBox.x + statusBox.width - 30, statusBox.y + statusBox.height / 2);
          const byRow = await sheetTitle();
          assert.ok(byRow, 'and so does the empty width of the row');
          assert.equal(byRow.title, 'Status', 'naming the same field');

          await fresh();
          await page.click('#dock .entity-fields .fieldrow[data-field="Status"] .fieldrow-label');
          await page.waitForSelector('#tray-back .opt-list .opt-row');
          assert.equal(await page.evaluate(() => !!document.querySelector('.picker-pop')), false,
            'while the label still opens the field editor, the way Feature #282 reaches it on a phone');
        } finally { await page.close(); }
      });

      test(`on a phone an empty field is one + chip and a filled relation takes a full-width row (${engine}, ${theme}, Issue #741)`, async () => {
        const page = await open({ ...profile, theme });
        try {
          const r = await read(page);
          assert.equal(r.theme, theme);
          for (const field of ['Tags', 'Fixed in']) {
            const row = r.rows.find((x) => x.field === field);
            assert.ok(row, `${field} has a row`);
            assert.equal(row.empties.length, 1, `${field} is empty, so it draws one chip and nothing else`);
            const chip = row.empties[0];
            assert.ok(chip.add || /^\+/.test(chip.text), `${field} offers one + chip, got ${JSON.stringify(chip.text)}`);
            assert.equal(chip.dashed, 'dashed', `${field} draws it as the board's dashed chip`);
            assert.ok(Math.abs(chip.mid - row.label.mid) <= 2, `${field} keeps the chip on the label's line`);
          }
          const filled = r.rows.find((x) => x.field === 'Seen in');
          assert.ok(filled.wide, 'a relation that carries chips takes its own full-width row');
          assert.ok(filled.label.bottom <= filled.value.top, 'with the label above the chips');
          const linksBefore = await page.evaluate(() => document.querySelectorAll('#dock .fieldrow[data-field="Seen in"] .ms-box > :not(button)').length);
          await page.click('#dock .entity-fields .fieldrow[data-field="Seen in"] .fieldrow-chev');
          await page.waitForSelector('#cmdk-back');
          assert.equal(await page.evaluate(() => document.querySelectorAll('#dock .fieldrow[data-field="Seen in"] .ms-box > :not(button)').length), linksBefore,
            'tapping a filled relation row opens its search and unlinks nothing');
          await page.keyboard.press('Escape');
          await page.waitForSelector('#cmdk-back', { state: 'detached' });
          assert.ok(r.docSections.length >= 1, 'long text stays in its own full-width section under the group');
          assert.ok(r.docSections[0].top >= r.group.bottom, 'below the group, never inside it');
        } finally { await page.close(); }
      });
    }
  }

  for (const theme of ['light', 'dark']) {
    test(`a desktop row page keeps the grip column and the two-column form (${theme}, Issue #741)`, async () => {
      const page = await open({ width: 1280, theme });
      try {
        const r = await read(page);
        assert.equal(r.theme, theme);
        assert.equal(r.group.bg, 'rgba(0, 0, 0, 0)', 'the fields list never draws a panel');
        assert.ok(r.grips > 0, 'the drag grips stay on a desktop');
        const status = r.rows.find((x) => x.field === 'Status');
        assert.match(status.cols, /^16px /, 'and the row keeps its grip column');
        assert.equal(status.chev, null, 'with no chevron');
      } finally { await page.close(); }
    });
  }
}
