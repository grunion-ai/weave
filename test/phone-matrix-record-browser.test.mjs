import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneMatrix, eachPhone, atRest, settled } from './lib/browser.mjs';
import { seedDemo, openRecord, recordCoversScreen, topBar, WIDE } from './lib/phone-matrix.mjs';

const s = await launch('phone matrix record page', (weave) => seedDemo(weave, { unlinkRows: 12 }));

const COMPUTED = new Set(['formula', 'lookup', 'rollup']);

if (s) {
  const { base, browser, tasks, t2, t4, unlink } = s;
  const matrix = await phoneMatrix(browser);
  const transparent = (c) => /,\s*0\)$|transparent/.test(c);

  test('the phone record page starts every field value at one left edge and keeps the Estimate box off its row edges (Issue #1381)', { todo: 'Issue #1381' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t2);
      if (!(await recordCoversScreen(page))) return WIDE;
      const v = await page.evaluate(() => {
        const clear = (c) => /,\s*0\)$|transparent/.test(c);
        const starts = [...document.querySelectorAll('#dock .entity-values .fieldrow:not(.fieldrow-wide)')].map((row) => {
          const n = [...row.querySelectorAll('input:not([type="hidden"]), .k, .computed')].find((x) => !x.closest('label') && x.getBoundingClientRect().width > 0);
          if (!n) return null;
          const r = n.getBoundingClientRect();
          const c = getComputedStyle(n);
          const boxed = !clear(c.backgroundColor) || (parseFloat(c.borderLeftWidth) > 0 && c.borderLeftStyle !== 'none' && !clear(c.borderLeftColor));
          return { field: row.dataset.field, left: Math.round(boxed ? r.left : r.left + parseFloat(c.borderLeftWidth) + parseFloat(c.paddingLeft)) };
        }).filter(Boolean);
        const est = document.querySelector('#dock .fieldrow[data-field="Estimate"]');
        const box = est.querySelector('input').getBoundingClientRect();
        const row = est.getBoundingClientRect();
        return { starts, above: Math.round(box.top - row.top), below: Math.round(row.bottom - box.bottom) };
      });
      const lefts = v.starts.map((x) => x.left);
      assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 2, `field values start at ${v.starts.map((x) => `${x.field} ${x.left}`).join(', ')} px`);
      assert.ok(v.above >= 4 && v.below >= 4, `the Estimate box sits ${v.above} px under its row's top and ${v.below} px over its divider`);
    });
  });

  test('the phone record top bar leaves Activity and field visibility to the menu-dots sheet (Issue #1382)', { todo: 'Issue #1382' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t2);
      if (!(await recordCoversScreen(page))) return WIDE;
      const bar = await topBar(page, '#dock');
      const crowd = bar.filter((b) => /activity-btn|eye-btn/.test(b.cls)).map((b) => b.label);
      assert.deepEqual(crowd, [], `the top bar still carries ${crowd.join(' and ')}`);
      await page.tap('#dock .crumb-actions .dots-btn');
      await page.waitForSelector('.chip-pop.wv-menu');
      const rows = await page.evaluate(() => [...document.querySelectorAll('.chip-pop.wv-menu .wv-menu-row')].map((n) => n.textContent.trim()));
      assert.ok(rows.some((r) => /activity/i.test(r)) && rows.some((r) => /field/i.test(r)), `the menu sheet offers Activity and field visibility (rows: ${rows.join(', ')})`);
    });
  });

  test('the phone record chip sets #4 at the size of its table name (Issue #1391)', { todo: 'Issue #1391' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      const f = await page.evaluate(() => {
        const read = (q) => { const c = getComputedStyle(document.querySelector(q)); return { size: c.fontSize, spacing: c.letterSpacing }; };
        return { id: read('#dock .crumb-cur .crumb-pid'), table: read('#dock .crumb-cur .crumb-tbl') };
      });
      assert.equal(f.id.size, f.table.size, `#4 is set at ${f.id.size} beside Task at ${f.table.size}`);
      assert.ok(['normal', '0px'].includes(f.id.spacing), `#4 is tracked at ${f.id.spacing}`);
    });
  });

  test('a phone relation chip spaces its state, name, open and remove parts with one gap (Issue #1392)', { todo: 'Issue #1392' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      const parts = await page.evaluate(() => [...document.querySelector('#dock .fieldrow[data-field="Project"] .k-rel').children]
        .map((n) => ({ cls: n.className, r: n.getBoundingClientRect() }))
        .filter((p) => p.r.width > 0 && p.r.height > 0)
        .sort((a, b) => a.r.left - b.r.left)
        .map((p) => ({ cls: String(p.cls).split(' ').at(-1), left: p.r.left, right: p.r.right })));
      const gaps = parts.slice(1).map((p, i) => ({ between: `${parts[i].cls} and ${p.cls}`, gap: Math.round(p.left - parts[i].right) }));
      const spread = Math.max(...gaps.map((g) => g.gap)) - Math.min(...gaps.map((g) => g.gap));
      assert.ok(spread <= 2, `the chip's gaps differ by ${spread} px: ${gaps.map((g) => `${g.between} ${g.gap}`).join(', ')}`);
    });
  });

  test('the phone record page draws no hairline under each field row (Issue #1393)', { todo: 'Issue #1393' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t2);
      if (!(await recordCoversScreen(page))) return WIDE;
      const ruled = await page.evaluate(() => {
        const clear = (c) => /,\s*0\)$|transparent/.test(c);
        return [...document.querySelectorAll('#dock .entity-values .fieldrow')].filter((n) => {
          const c = getComputedStyle(n);
          const after = getComputedStyle(n, '::after');
          const border = parseFloat(c.borderBottomWidth) > 0 && c.borderBottomStyle !== 'none' && !clear(c.borderBottomColor);
          const shadow = c.boxShadow !== 'none' && /inset/.test(c.boxShadow) && !clear(c.boxShadow.match(/rgba?\([^)]*\)/)?.[0] ?? 'transparent');
          const line = after.content !== 'none' && parseFloat(after.height) > 0 && parseFloat(after.height) <= 2 && !clear(after.backgroundColor);
          return border || shadow || line;
        }).map((n) => n.dataset.field);
      });
      assert.ok(ruled.length <= 1, `${ruled.length} field rows end in a hairline: ${ruled.join(', ')}`);
    });
  });

  test('a tap on the caret of a phone relation chip opens no search and keeps the row at content height with the name in view (Issue #1401)', { todo: 'Issue #1401' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      if (!(await recordCoversScreen(page))) return WIDE;
      await page.tap('#dock .fieldrow[data-field="Project"] .k-rel .mention-caret');
      await settled(page.locator('#dock'));
      const v = await page.evaluate(() => {
        const title = document.querySelector('#dock textarea.name-edit')?.value;
        const search = [...document.querySelectorAll('#cmdk-back, .picker-pop, .cell-pop')].some((n) => !n.hidden && n.getBoundingClientRect().height > 0)
          || !!document.activeElement?.matches('input[type="search"], .search-bare, .picker-pop input');
        const row = document.querySelector('#dock .fieldrow[data-field="Project"]');
        const chip = row?.querySelector('.k-rel');
        const name = chip?.querySelector('.k-label');
        const box = (n) => n?.getBoundingClientRect();
        const c = box(chip), l = box(name);
        return {
          title, search, row: row ? Math.round(box(row).height) : null,
          name: l ? { width: Math.round(l.width), inside: l.width > 0 && l.left >= c.left - 1 && l.right <= c.right + 1 } : null,
        };
      });
      assert.equal(v.search, false, 'the tap opened a search');
      if (v.title === 'Hermes Docs') return;
      assert.ok(v.row < 80, `the Project row grew to ${v.row} px`);
      assert.ok(v.name?.inside, `the related name is out of the chip's view (${JSON.stringify(v.name)})`);
    });
  });

  test('every editable field on the phone record page is a form control in field order, and each but the last says Next (Issue #1402)', { todo: 'Issue #1402' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      const v = await page.evaluate((computed) => {
        const rows = [...document.querySelectorAll('#dock .entity-values .fieldrow')];
        const control = (row) => [...row.querySelectorAll('input:not([type="hidden"]):not([type="button"]), textarea, select, [contenteditable="true"]')]
          .find((n) => n.getBoundingClientRect().width > 0 && !n.disabled && n.tabIndex >= 0);
        const editable = rows.filter((r) => !computed.includes(r.dataset.ftype)).map((r) => r.dataset.field);
        const reached = rows.filter((r) => control(r)).map((r) => r.dataset.field);
        const hints = rows.map(control).filter(Boolean).map((n) => n.getAttribute('enterkeyhint'));
        return { editable, reached, hints };
      }, [...COMPUTED]);
      assert.deepEqual(v.reached, v.editable, `Safari's next arrow reaches ${v.reached.join(', ')} of ${v.editable.join(', ')}`);
      assert.deepEqual(v.hints.slice(0, -1), v.hints.slice(0, -1).map(() => 'next'), `the return key hints read ${JSON.stringify(v.hints)}`);
    });
  });

  test('the phone record top bar never overlaps its items on a record reached from another record (Issue #1403)', { todo: 'Issue #1403' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      if (!(await recordCoversScreen(page))) return WIDE;
      await page.tap('#dock .fieldrow[data-field="Project"] .k-rel a.mention');
      await page.waitForFunction(() => document.querySelector('#dock textarea.name-edit')?.value === 'Hermes Docs');
      await settled(page.locator('#dock'));
      const items = await page.evaluate(() => [...document.querySelectorAll('#dock .crumb-row button, #dock .crumb-row a.crumb-item, #dock .crumb-row .crumb-cur')]
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .map(({ n, r }, i, all) => ({ i, label: n.getAttribute('aria-label') || n.title || n.textContent.trim().slice(0, 20) || n.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom, inside: all.filter((o) => o.n !== n && o.n.contains(n)).map((o) => all.indexOf(o)) })));
      const hits = [];
      for (const a of items) for (const b of items) {
        if (b.i <= a.i || a.inside.includes(b.i) || b.inside.includes(a.i)) continue;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0.5 && h > 0.5) hits.push(`${a.label} and ${b.label} overlap by ${Math.round(w)} px`);
      }
      assert.deepEqual(hits, [], hits.join('; '));
    });
  });

  test('phone relation chip controls sit 44 px apart and unlinking offers Undo (Issue #1404)', { todo: 'Issue #1404' }, async (t) => {
    await eachPhone(t, matrix, async (page, run, i) => {
      await openRecord(page, base, tasks, unlink[i]);
      if (!(await recordCoversScreen(page))) return WIDE;
      const sel = '#dock .fieldrow[data-field="Project"] .k-rel';
      const spacing = () => page.evaluate((sel) => {
        const chip = document.querySelector(sel);
        const controls = [...chip.querySelectorAll('button, a')].map((n) => ({ n, r: n.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0).sort((a, b) => a.r.left - b.r.left);
        return controls.slice(1).map(({ n, r }, k) => {
          const p = controls[k];
          const d = Math.hypot(r.left + r.width / 2 - (p.r.left + p.r.width / 2), r.top + r.height / 2 - (p.r.top + p.r.height / 2));
          return { between: `${p.n.title || p.n.textContent.trim() || p.n.className} and ${n.title || n.textContent.trim() || n.className}`, d: Math.round(d) };
        });
      }, sel);
      const tight = (await spacing()).filter((g) => g.d < 44);
      if (await page.locator(`${sel} .mention-caret`).count()) {
        await page.tap(`${sel} .mention-caret`);
        await settled(page.locator('#dock'));
        if (await page.locator(sel).count()) tight.push(...(await spacing()).filter((g) => g.d < 44).map((g) => ({ ...g, between: `${g.between} (expanded)` })));
      }
      assert.deepEqual(tight, [], `adjacent chip controls sit closer than 44 px: ${tight.map((g) => `${g.between} ${g.d} px`).join(', ')}`);
      const x = page.locator(`${sel} .x`);
      if (!(await x.count())) return;
      await x.tap();
      const undo = await page.waitForFunction(() => [...document.querySelectorAll('#wv-toasts .wv-toast-action')].some((b) => /undo/i.test(b.textContent)), null, { timeout: 3000 })
        .then(() => true, () => false);
      assert.ok(undo, 'one tap on the chip x unlinked the project with no Undo toast');
    });
  });

  test('the phone record title shows no spellcheck underline while it is not being edited (Issue #1405)', { todo: 'Issue #1405' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openRecord(page, base, tasks, t4);
      const title = page.locator('#dock textarea.name-edit');
      await title.tap();
      await page.evaluate(() => document.activeElement?.blur());
      await atRest(title);
      const v = await title.evaluate((n) => ({ focused: n === document.activeElement, spellcheck: n.spellcheck }));
      assert.equal(v.focused, false, 'the title let go of focus');
      assert.equal(v.spellcheck, false, 'the title keeps spellcheck on outside edit mode, so Safari underlines "quickstart"');
    });
  });
}
