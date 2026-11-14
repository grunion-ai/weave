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
  for (const theme of ['light', 'dark']) {
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
}
