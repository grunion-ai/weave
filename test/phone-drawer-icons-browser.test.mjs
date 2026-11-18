import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let task;
const s = await launch('phone drawer icons', (weave) => {
  weave.createSpace({ name: 'Projects' });
  weave.createTable({ space: 'Projects', name: 'Project' });
  task = weave.createTable({ space: 'Projects', name: 'Task' });
  weave.createTable({ space: 'Projects', name: 'Person' });
  weave.createSpace({ name: 'Handbook' });
  weave.createTable({ space: 'Handbook', name: 'Guide', icon: 'lucide:file-text' });
  weave.createTable({ space: 'Handbook', name: 'Fields', icon: 'lucide:layout-grid' });
});

if (s) {
  const { base, browser } = s;
  {
    const theme = 'light';
    test(`every row in the phone drawer carries its icon at one size and inset, iconless tables included (Issue #1394, ${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/#/table/${task.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main .nav-menu');
        await page.click('#main .nav-menu');
        await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-held'));
        const rows = await page.$$eval('#sidebar a.nav-db, #sidebar a.nav-space', (els) => els.map((r) => {
          const icon = r.querySelector(':scope > .nav-icon');
          const box = icon?.getBoundingClientRect();
          return {
            kind: r.classList.contains('nav-space') ? 'space' : 'row',
            label: r.textContent.trim(),
            icon: !!icon && box.width > 0 && !!icon.querySelector('svg'),
            left: box ? Math.round(box.left) : null,
            width: box ? Math.round(box.width) : null,
          };
        }));
        for (const want of ['Project', 'Task', 'Person', 'Guide', 'Fields', 'Projects', 'Handbook']) {
          assert.ok(rows.some((r) => r.label === want), `the drawer lists ${want}`);
        }
        for (const r of rows) assert.ok(r.icon, `${r.kind} "${r.label}" shows an icon`);
        for (const kind of ['row', 'space']) {
          const same = rows.filter((r) => r.kind === kind);
          assert.equal(new Set(same.map((r) => r.left)).size, 1, `every ${kind} icon starts at one inset: ${JSON.stringify(same)}`);
          assert.equal(new Set(same.map((r) => r.width)).size, 1, `every ${kind} icon is one size: ${JSON.stringify(same)}`);
        }
      } finally { await page.close(); }
    });
  }

  {
    const theme = 'light';
    test(`every row menu in the phone drawer, the identity row included, draws one glyph (Issue #1395, ${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/#/table/${task.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main .nav-menu');
        await page.click('#main .nav-menu');
        await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-held'));
        const menus = await page.$$eval('#sidebar .dots-btn, #sidebar .nav-identity-more', (els) => els.map((b) => ({
          row: b.classList.contains('nav-identity-more') ? 'identity' : (b.closest('.nav-space-row') ? 'space' : 'table'),
          glyph: [...(b.querySelector('.mi')?.classList ?? [])].find((c) => c.startsWith('mi-')) ?? null,
        })));
        const shown = JSON.stringify(menus);
        assert.ok(menus.some((m) => m.row === 'identity'), `the drawer carries the identity row menu: ${shown}`);
        assert.ok(menus.some((m) => m.row === 'space'), `the drawer carries the space row menus: ${shown}`);
        for (const m of menus) assert.ok(m.glyph, `the ${m.row} row menu draws a glyph: ${shown}`);
        assert.equal(new Set(menus.map((m) => m.glyph)).size, 1, `every row menu draws one glyph: ${shown}`);
      } finally { await page.close(); }
    });
  }

}
