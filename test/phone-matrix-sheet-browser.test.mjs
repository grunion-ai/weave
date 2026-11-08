import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneMatrix, eachPhone, atRest, settled } from './lib/browser.mjs';
import { seedDemo, openRecord } from './lib/phone-matrix.mjs';

const s = await launch('phone matrix sheets', (weave) => seedDemo(weave));

const POPOVER = 'the record menu opens as a popover at this width, not as a phone sheet';

if (s) {
  const { base, browser, tasks, t2, t4 } = s;
  const matrix = await phoneMatrix(browser);

  const openMenu = async (page) => {
    await openRecord(page, base, tasks, t2);
    await page.tap('#dock .crumb-actions .dots-btn');
    await page.waitForSelector('.chip-pop.wv-menu[role="menu"]');
    await atRest(page.locator('.chip-pop.wv-menu'));
    return page.evaluate(() => document.querySelector('.chip-pop.wv-menu').classList.contains('wv-menu-sheet'));
  };
  const openFieldDialog = async (page) => {
    await openRecord(page, base, tasks, t4);
    await page.tap('#dock .fieldrow[data-field="Project Budget"] label.fieldrow-label');
    await page.waitForSelector('#tray .tray-form textarea.field-desc');
    await settled(page.locator('#tray'));
  };

  test('dragging the phone record menu sheet down by its handle closes it, as the picker sheets do (Issue #1383)', { todo: 'Issue #1383' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      if (!(await openMenu(page))) return POPOVER;
      const grip = await page.evaluate(() => {
        const pop = document.querySelector('.chip-pop.wv-menu-sheet');
        const r = pop.getBoundingClientRect();
        const real = pop.querySelector('.sheet-grip');
        if (real) { const g = real.getBoundingClientRect(); return { x: g.left + g.width / 2, y: g.top + g.height / 2, h: r.height, kind: 'sheet-grip' }; }
        const b = getComputedStyle(pop, '::before');
        if (b.content === 'none' || b.display === 'none' || !(parseFloat(b.height) > 0)) return null;
        return { x: r.left + r.width / 2, y: r.top + parseFloat(b.marginTop || 0) + parseFloat(b.height) / 2 + 4, h: r.height, kind: '::before' };
      });
      if (!grip) return 'the sheet draws no handle';
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i += 1) await page.mouse.move(grip.x, grip.y + (grip.h * 0.5 * i) / 6);
      await page.mouse.up();
      const closed = await page.waitForSelector('.chip-pop.wv-menu-sheet', { state: 'detached', timeout: 3000 }).then(() => true, () => false);
      assert.ok(closed, `a drag of half the sheet's height from its ${grip.kind} handle left the sheet open`);
    });
  });

  test('a tap on the dimmed page closes the phone record menu without focusing the title under the finger (Issue #1384)', { todo: 'Issue #1384' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      if (!(await openMenu(page))) return POPOVER;
      const title = await page.locator('#dock textarea.name-edit').boundingBox();
      await page.touchscreen.tap(title.x + Math.min(60, title.width / 2), title.y + title.height / 2);
      await page.waitForSelector('.chip-pop.wv-menu-sheet', { state: 'detached' });
      const focused = await page.evaluate(() => document.activeElement?.matches('#dock textarea.name-edit') ?? false);
      assert.equal(focused, false, 'the tap that closed the sheet also put the caret in the record title, so the keyboard opens and a keypress renames the record');
    });
  });

  test('the phone record menu sheet keeps Export Markdown, HTML and PDF out of its top-level rows (Issue #1385)', { todo: 'Issue #1385' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      if (!(await openMenu(page))) return POPOVER;
      const rows = await page.evaluate(() => [...document.querySelectorAll('.chip-pop.wv-menu-sheet > .wv-menu-row')]
        .map((n) => n.querySelector('.wv-menu-label')?.textContent.trim() ?? n.textContent.trim()));
      const formats = rows.filter((r) => ['Markdown', 'HTML', 'PDF'].includes(r));
      assert.deepEqual(formats, [], `the sheet lists ${formats.join(', ')} as drawer rows among ${rows.join(', ')}`);
    });
  });

  test('a phone record menu opened by tap highlights no row (Issue #1389)', { todo: 'Issue #1389' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openMenu(page);
      const lit = await page.evaluate(() => [...document.querySelectorAll('.chip-pop.wv-menu .wv-menu-row')]
        .filter((n) => !/,\s*0\)$|transparent/.test(getComputedStyle(n).backgroundColor))
        .map((n) => `${n.textContent.trim()} (${getComputedStyle(n).backgroundColor}${n.matches(':focus') ? ', focused' : ''})`));
      assert.deepEqual(lit, [], `before any row is touched the menu fills ${lit.join(', ')}`);
    });
  });

  test('the phone record menu says how to move to trash instead of showing a bare HOLD keycap (Issue #1390)', { todo: 'Issue #1390' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openMenu(page);
      const caps = await page.evaluate(() => [...document.querySelectorAll('.chip-pop.wv-menu .wv-menu-danger .hold-hint, .chip-pop.wv-menu .wv-menu-danger kbd')]
        .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; })
        .map((n) => n.textContent.trim()));
      assert.deepEqual(caps, [], `Move to trash carries a keycap that reads ${caps.map((c) => `"${c}"`).join(', ')} on a touch screen`);
    });
  });

  test('the phone field dialog shows the whole Description placeholder inside its box (Issue #1397)', { todo: 'Issue #1397' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openFieldDialog(page);
      const fit = await page.evaluate(() => {
        const ta = document.querySelector('#tray textarea.field-desc');
        const c = getComputedStyle(ta);
        const probe = document.createElement('div');
        const pad = (side) => parseFloat(c[`padding${side}`]) + parseFloat(c[`border${side}Width`]);
        Object.assign(probe.style, {
          position: 'absolute', visibility: 'hidden', left: '0', top: '0', boxSizing: 'content-box',
          width: `${ta.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight)}px`,
          font: c.font, letterSpacing: c.letterSpacing, lineHeight: c.lineHeight, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: c.wordBreak,
        });
        probe.textContent = ta.placeholder;
        document.body.append(probe);
        const need = probe.getBoundingClientRect().height;
        probe.remove();
        const room = ta.getBoundingClientRect().height - pad('Top') - pad('Bottom');
        return { need: Math.round(need), room: Math.round(room), lines: Math.round(need / parseFloat(c.lineHeight)), empty: ta.value === '' };
      });
      assert.ok(fit.empty, 'the Description starts empty, so its placeholder shows');
      assert.ok(fit.need <= fit.room + 1, `the placeholder needs ${fit.lines} lines (${fit.need} px) but the box leaves ${fit.room} px, so its last line is cut by the border`);
    });
  });

  test('the phone field dialog leaves the same gap under the lookup note as under every other field (Issue #1398)', { todo: 'Issue #1398' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openFieldDialog(page);
      const g = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('#tray .dlg-lbl')];
        const note = document.querySelector('#tray .modal-note');
        const below = (n) => labels.find((l) => l.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1);
        const name = [...document.querySelectorAll('#tray .tray-body input')][0];
        const desc = labels.find((l) => l.textContent.trim() === 'Description');
        const next = note && below(note);
        return {
          note: note && next ? Math.round(next.getBoundingClientRect().top - note.getBoundingClientRect().bottom) : null,
          next: next?.textContent.trim(),
          field: Math.round(desc.getBoundingClientRect().top - name.getBoundingClientRect().bottom),
        };
      });
      assert.ok(g.note != null, 'the dialog for a lookup field carries its note above the next label');
      assert.ok(g.note >= g.field - 1, `the lookup note sits ${g.note} px above the ${g.next} label, while a field sits ${g.field} px above the next label`);
    });
  });

  test('the phone field dialog opens with no field focused, so the keyboard stays down (Issue #1399)', { todo: 'Issue #1399' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openFieldDialog(page);
      const focused = await page.evaluate(() => {
        const a = document.activeElement;
        return a?.closest('#tray') && a.matches('input, textarea, select, [contenteditable="true"]') ? (a.getAttribute('aria-label') || a.placeholder || a.name || a.tagName) : null;
      });
      assert.equal(focused, null, `a tap on the field label opens the dialog with ${focused} focused, which raises the keyboard over the settings`);
    });
  });
}
