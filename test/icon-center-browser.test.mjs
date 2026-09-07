/* Every lone-icon button draws its glyph on the button's centre (Issue #207).
   `.wv-icon` carries a 5px right margin — the gap between an icon and the
   label it sits beside. A button whose only content is one icon inherited
   that gap and drew its glyph 2.5px left of centre; the rotated nav-caret
   drew 2.5px high. Issue #191 patched `#ws-new` alone and left five siblings
   (theme toggle, New table, ⋮ field menu, add-field, nav-caret) as they were.
   Kyle: "check all similar." So this sweeps every icon that is a button's
   only child on the workspace home and on a table page, in both themes,
   rather than naming the six we know today.
   The guard test is the reason `:only-child` is safe here: it counts element
   siblings only, so an icon followed by a bare text label would still match
   and lose its gap. No button or anchor is built that way; this says so in
   the browser, where a stylesheet grep cannot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('icon centre', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1'] } });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  weave.createEntity(tasks, { name: 'Echo', values: { Priority: 'P0' } });
});

/* Bare anchors are excluded on purpose: .nav-space and .nav-db are an icon
   beside a text label, which :only-child would match. Anchors styled as
   buttons (.btn) are the lone-icon case. */
const LONE = 'button > .wv-icon:only-child, a.btn > .wv-icon:only-child';

/* [{ who, dx, dy }] for every lone icon on the page; `who` names the button
   so a failure says which one drifted. */
const measure = (sel) => Array.from(document.querySelectorAll(sel)).map((icon) => {
  const btn = icon.parentElement;
  const svg = icon.querySelector('svg') ?? icon;
  const b = btn.getBoundingClientRect(); const g = svg.getBoundingClientRect();
  const who = btn.id ? `#${btn.id}` : `.${btn.className.split(' ').filter(Boolean).join('.')}`;
  return { who, dx: (g.left + g.width / 2) - (b.left + b.width / 2), dy: (g.top + g.height / 2) - (b.top + b.height / 2) };
});

/* Buttons/anchors whose icon is the only ELEMENT child but which also carry
   a text label — the case `:only-child` would wrongly strip. */
const labelled = (sel) => Array.from(document.querySelectorAll(sel))
  .filter((icon) => Array.from(icon.parentElement.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))
  .map((icon) => icon.parentElement.outerHTML.slice(0, 80));

if (s) {
  const { base, browser } = s;
  const pages = [
    { name: 'workspace home', url: () => `${base}/`, ready: '#ws-new svg' },
    { name: 'table page', url: () => `${base}/#/table/${tasks.id}`, ready: '.wv-grid tbody tr.entity-row' },
  ];
  for (const theme of ['light', 'dark']) {
    for (const p of pages) {
      test(`every lone-icon button centres its glyph on the ${p.name} (${theme})`, async () => {
        const page = await browser.newPage();
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(p.url(), { waitUntil: 'networkidle' });
        await page.waitForSelector(p.ready);
        await page.waitForSelector('.nav-caret svg');
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme, 'the page must be in the theme under test');
        const seen = await page.evaluate(measure, LONE);
        assert.ok(seen.length >= 4, `expected the theme toggle, caret, New table and ⋮ at least; saw ${seen.length}`);
        const off = seen.filter((m) => Math.abs(m.dx) > 1 || Math.abs(m.dy) > 1)
          .map((m) => `${m.who} dx=${m.dx.toFixed(2)} dy=${m.dy.toFixed(2)}`);
        assert.deepEqual(off, [], `glyphs off their button's centre: ${off.join('; ')}`);
        const eaten = await page.evaluate(labelled, LONE);
        assert.deepEqual(eaten, [], `an icon beside a bare text label would lose its gap: ${eaten.join(' | ')}`);
        await page.close();
      });
    }
  }
}
