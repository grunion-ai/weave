import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('document reference chips', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const task = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField('Task', { name: 'Owner', type: 'text' });
  const target = weave.createEntity('Task', { name: 'Ship the editor', Owner: 'Ada' });
  const plain = weave.createEntity('Task', { name: 'Plain target' });
  const md = [
    'Words with no reference at all.',
    '',
    `See [[Task#${plain.publicId}]] for the plain one.`,
    '',
    `And [[Task#${target.publicId}]] carries a field.`,
    '',
    'Gone: [[Task#999]] stays missing.',
    '',
  ].join('\n');
  const doc = weave.createEntity('Task', { name: 'The document' });
  weave.setDoc(doc.id, md);
  weave.updateTable(task.id, { description: md });
  const note = weave.createTable({ space: 'Dev', name: 'Note' });
  weave.addRelation(task.id, { name: 'Blocks', targetDbs: [task.id, note.id], cardinality: 'many-to-many' });
  weave.link(doc.id, 'Blocks', [target.id]);
  return { task, target, plain, doc };
});

if (s) {
  const { base, browser, weave, task, target, plain, doc } = s;

  const chipsIn = (page, scope) => page.evaluate((scope) => {
    const root = document.querySelector(scope);
    return [...root.querySelectorAll('.k.k-rel')].map((chip) => {
      const cs = getComputedStyle(chip);
      const a = chip.querySelector(':scope > a.mention');
      const label = chip.querySelector('.k-label');
      return {
        link: !!a,
        kind: a && [...a.classList].find((c) => /^mention-(entity|table|space|workspace)$/.test(c)),
        href: a?.getAttribute('href'),
        text: chip.textContent,
        markup: chip.outerHTML,
        labelWhole: label ? (() => { const rg = document.createRange(); rg.selectNodeContents(label); return rg.getBoundingClientRect().width <= label.getBoundingClientRect().width + 1; })() : null,
        borderWidth: cs.borderTopWidth,
        borderStyle: cs.borderTopStyle,
        radius: cs.borderTopLeftRadius,
        chipBg: cs.backgroundColor,
        linkBg: a && getComputedStyle(a).backgroundColor,
        mark: getComputedStyle(a ?? chip, '::after').content,
        caret: !!chip.querySelector('.mention-caret'),
        unlink: !!chip.querySelector('.x'),
      };
    });
  }, scope);

  const lineBoxes = (page, scope) => page.evaluate((scope) => {
    const ps = [...document.querySelector(scope).querySelectorAll('p')];
    const h = (p) => p && Math.round(p.getBoundingClientRect().height * 100) / 100;
    return {
      plain: h(ps.find((p) => p.textContent.startsWith('Words with no reference'))),
      chip: h(ps.find((p) => p.textContent.startsWith('See '))),
      caret: h(ps.find((p) => p.textContent.startsWith('And '))),
    };
  }, scope);

  const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

  for (const colorScheme of ['light', 'dark']) {
    test(`the document page draws a reference as the pointer chip, one line tall, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme });
      try {
        await page.goto(`${base}/e/${doc.id}/doc.html`, { waitUntil: 'load' });
        const chips = await chipsIn(page, 'body');
        assert.equal(chips.length, 2, `both live references are chips: ${JSON.stringify(chips)}`);
        for (const c of chips) {
          assert.ok(c.link, 'the link is the chip’s child, as .k-rel > a');
          assert.equal(c.kind, 'mention-entity');
          assert.equal(c.borderWidth, '1px');
          assert.equal(c.borderStyle, 'solid', 'a pointer is an outline');
          assert.equal(c.radius, '4px');
          assert.ok(transparent(c.chipBg) && transparent(c.linkBg), `a pointer has no fill: ${c.chipBg} / ${c.linkBg}`);
          assert.equal(c.mark, 'none', 'Feature #185 dropped the ↗: the chip is the link');
          assert.equal(c.unlink, false, 'a reference is text: no ×');
          assert.ok(c.labelWhole, `the name reads whole: ${c.text}`);
        }
        assert.ok(chips[1].caret, 'the chip with a field keeps its caret, inside the outline');
        assert.equal(await page.$eval('.mention.broken', (n) => [n.textContent, !!n.closest('.k-rel')].join('|')), 'Task#999|false');

        const lines = await lineBoxes(page, 'body');
        assert.equal(lines.chip, lines.plain, `a chip must not grow its line: ${JSON.stringify(lines)}`);
        assert.equal(lines.caret, lines.plain, `nor a chip with a caret: ${JSON.stringify(lines)}`);

        const copied = await page.evaluate(() => {
          const p = [...document.querySelectorAll('p')].find((x) => x.textContent.startsWith('See '));
          getSelection().selectAllChildren(p);
          return getSelection().toString();
        });
        assert.match(copied, /^See Plain targetTask for the plain one\.$/, `copied: ${copied}`);

        await page.click('.mention-caret');
        assert.equal(await page.$eval('.mention-caret', (c) => c.closest('.k-rel').classList.contains('open')), true);
        assert.match(page.url(), new RegExp(`/e/${doc.id}/doc\\.html$`), 'the caret never navigates');
        await Promise.all([page.waitForURL(new RegExp(`/e/${plain.id}/doc\\.html$`)), page.click(`a.mention[href$="/e/${plain.id}/doc.html"]`)]);
      } finally { await page.close(); }
    });

    test(`the app's rendered markdown draws a reference as the grid's pointer chip in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme });
      try {
        await page.goto(`${base}/#/table/${task.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.view-desc-body .k.k-rel');
        assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme);
        await page.$eval('.view-desc-body', (b) => b.classList.remove('clamped'));
        const chips = await chipsIn(page, '.view-desc-body');
        assert.equal(chips.length, 2);
        const grid = await page.evaluate(() => {
          const k = document.createElement('span');
          k.className = 'k k-rel';
          document.body.append(k);
          const cs = getComputedStyle(k);
          const out = { border: cs.borderTopColor, color: cs.color };
          k.remove();
          return out;
        });
        const painted = await page.$eval('.view-desc-body .k.k-rel', (k) => ({ border: getComputedStyle(k).borderTopColor, color: getComputedStyle(k.querySelector('a')).color }));
        assert.deepEqual(painted, grid, 'a document reference wears the grid pointer’s outline and ink');
        for (const c of chips) {
          assert.ok(c.link && c.borderWidth === '1px' && c.borderStyle === 'solid' && c.radius === '4px', JSON.stringify(c));
          assert.ok(transparent(c.chipBg) && transparent(c.linkBg), `no fill: ${c.chipBg} / ${c.linkBg}`);
          assert.equal(c.mark, 'none');
        }
        const lines = await lineBoxes(page, '.view-desc-body');
        assert.equal(lines.chip, lines.plain, `a chip must not grow its line: ${JSON.stringify(lines)}`);
        assert.equal(lines.caret, lines.plain, `nor a chip with a caret: ${JSON.stringify(lines)}`);
      } finally { await page.close(); }
    });

    test(`the editor paints a reference as the pointer chip, opens it on click, and keeps it through typing after it, in ${colorScheme}`, async () => {
      const mine = weave.createEntity('Task', { name: `Typed in ${colorScheme}` });
      weave.setDoc(mine.id, weave.getDoc(doc.id));
      const page = await browser.newPage({ colorScheme });
      try {
        await page.goto(`${base}/#/entity/${mine.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.vditor-ir [contenteditable="true"]');
        await page.waitForSelector('.doc-ref-layer .doc-ref-slot > .k.k-rel', { timeout: 20000 });
        await page.waitForFunction(() => document.querySelectorAll('.doc-ref-layer .k.k-rel').length === 2, null, { timeout: 20000 });
        const chips = await chipsIn(page, '.doc-ref-layer');
        for (const c of chips) {
          assert.ok(c.link && c.borderWidth === '1px' && c.borderStyle === 'solid' && c.radius === '4px', JSON.stringify(c));
          assert.ok(transparent(c.chipBg), 'the pointer carries no fill of its own');
          assert.equal(c.mark, 'none');
          assert.match(c.href, /^#\/entity\//);
          assert.ok(c.labelWhole, `the editor chip is never narrower than its label (Issue #679): ${c.text}`);
        }
        const ground = await page.evaluate(() => {
          const k = document.querySelector('.doc-ref-layer .doc-ref-slot');
          let n = document.querySelector('.vditor-ir .vditor-reset');
          let bg = 'rgba(0, 0, 0, 0)';
          for (; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') { bg = c; break; } }
          return { chip: getComputedStyle(k).backgroundColor, page: bg };
        });
        assert.equal(ground.chip, ground.page, `the slot covers the literal with the editor's own ground: ${JSON.stringify(ground)}`);

        const lines = await lineBoxes(page, '.vditor-ir .vditor-reset');
        assert.equal(lines.chip, lines.plain, `a chip must not grow its line: ${JSON.stringify(lines)}`);
        const fit = await page.evaluate(() => {
          const k = document.querySelector('.doc-ref-layer .k-rel').getBoundingClientRect();
          const p = [...document.querySelectorAll('.vditor-ir .vditor-reset p')].find((x) => x.textContent.startsWith('See '));
          const r = p.getBoundingClientRect();
          return k.top >= r.top - 1 && k.bottom <= r.bottom + 1;
        });
        assert.ok(fit, 'the chip sits inside its line');

        await page.evaluate(() => {
          const root = document.querySelector('.vditor-ir .vditor-reset');
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const at = n.nodeValue.indexOf(']] for');
            if (at < 0) continue;
            root.focus();
            const range = document.createRange();
            range.setStart(n, at + 3); range.collapse(true);
            getSelection().removeAllRanges(); getSelection().addRange(range);
            return;
          }
        });
        await page.keyboard.type('now ');
        await page.waitForFunction(() => window.__weaveEditors.values().next().value.getValue().includes(']] now for'), null, { timeout: 10000 });
        await page.waitForFunction(() => document.querySelectorAll('.doc-ref-layer .k.k-rel').length === 2, null, { timeout: 20000 });
        const value = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
        assert.match(value, new RegExp(`See \\[\\[Task#${plain.publicId}\\|Plain target\\]\\] now for the plain one\\.`), `source: ${value}`);
        assert.equal((await chipsIn(page, '.doc-ref-layer'))[0].text.includes('Plain target'), true, 'the chip is still the resolved record');

        await page.click(`.doc-ref-layer .doc-ref-slot a.mention[href="#/entity/${plain.id}"]`);
        await page.waitForFunction((id) => location.hash.includes(id), plain.id);
        await page.waitForFunction(() => document.querySelector('#dock:not([hidden]) .name-edit')?.value === 'Plain target', null, { timeout: 20000 });
      } finally { await page.close(); }
    });
  }

  test('one row wears one chip: relation cell, document page and HTML export emit the same markup', async () => {
    const bare = (html) => html.replace(/ href="[^"]*"/g, '').replace(/ tabindex="-1"/g, '');
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${doc.id}/doc.html`, { waitUntil: 'load' });
      const docPage = await page.$eval(`.k-rel[data-eid="${target.id}"]`, (k) => k.outerHTML);

      await page.goto(`${base}/e/${doc.id}/entity.html`, { waitUntil: 'load' });
      const exported = await page.$eval(`.k-rel[data-eid="${target.id}"]`, (k) => k.outerHTML);
      assert.equal(exported, docPage, 'the HTML export and the document page are one renderer');

      await page.goto(`${base}/#/table/${task.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`.wv-grid .k-rel[data-eid="${target.id}"]`, { timeout: 20000 });
      const cell = await page.locator(`.wv-grid .k-rel[data-eid="${target.id}"]`).first().evaluate((k) => k.outerHTML);
      assert.equal(bare(cell), bare(docPage),
        'a relation cell draws the far row through the same renderer; only the route differs');
      assert.match(docPage, /class="k-home">Task</, 'and both carry the home badge');
    } finally { await page.close(); }
  });

  test('the stored markdown is untouched by the render', () => {
    assert.match(weave.getDoc(doc.id), new RegExp(`\\[\\[Task#${target.publicId}\\]\\]`));
  });
}
