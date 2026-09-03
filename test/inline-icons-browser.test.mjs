/* Inline icons in the editor, driven through a real browser (Kyle,
   2026-09-02: "show fully formatted real icons in the .md — these can
   replace emojis"). The instant-render surface is the document, so the icon
   has to be painted over the literal `:bell:` there, in a table cell as much
   as in a sentence, and Lute's own emoji shortcodes — which would have drawn
   🔔 for the same text — have to be off, or the two vocabularies fight.
   Playwright is not a dependency; the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright').then((pw) => pw.chromium).catch(() => null);

if (!chromium) {
  test('inline icons (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, row;
  const DOC = 'A :bell: rings and :✓: is done, :smile: stays, at 12:30:45.\n\n| Icon | Name |\n| --- | --- |\n| :bug: | bug |\n| :star: | star |\n';

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Product' });
    const notes = weave.createTable({ space: 'Product', name: 'Note' });
    row = weave.createEntity(notes, { name: 'Icons inline' }).id;
    weave.setDoc(row, DOC);
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });
  test.after(async () => { await browser?.close(); server?.close(); });

  const open = async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir .vditor-reset');
    await page.waitForTimeout(700); // the decoration pass is debounced
    return page;
  };

  test('an icon token is painted as its icon, in prose and in a table cell', async () => {
    const page = await open();
    const chips = await page.evaluate(() => [...document.querySelectorAll('.doc-icon-chip')].map((c) => [c.title, c.querySelectorAll('svg').length, c.className]));
    const titles = chips.map((c) => c[0]);
    for (const t of ['bell', '✓', 'bug', 'star']) assert.ok(titles.includes(t), `${t} is drawn (got ${titles.join(', ')})`);
    assert.ok(chips.every((c) => c[1] === 1), 'every chip carries the icon as an svg');
    assert.ok(!titles.includes('smile') && !titles.includes('30'), 'an unknown token and a clock time stay literal');
    assert.equal(await page.locator('.doc-icon-chip .mi-bell').count(), 1, 'the bell is the moving Lucide bell');
    await page.close();
  });

  test('Lute no longer turns :bell: into an emoji — the icon set owns the shortcode', async () => {
    const page = await open();
    const emoji = await page.evaluate(() => {
      const root = document.querySelector('.vditor-ir .vditor-reset');
      return { nodes: root.querySelectorAll('[data-type="emoji"]').length, text: root.textContent.includes(':bell:'), bell: /🔔|⭐|🐛/.test(root.textContent) };
    });
    assert.equal(emoji.nodes, 0, 'no emoji node in the surface');
    assert.equal(emoji.bell, false, 'no emoji character painted from a shortcode');
    assert.ok(emoji.text, 'the literal stays in the surface, under the chip');
    await page.close();
  });

  test('the caret inside a token degrades it to literal text, like a reference', async () => {
    const page = await open();
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.querySelector('.vditor-ir .vditor-reset'), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue.indexOf(':bell:');
        if (i < 0) continue;
        const r = document.createRange(); r.setStart(n, i + 2); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return;
      }
    });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.doc-icon-chip[title="bell"]').count(), 0, 'the bell steps aside for the writer');
    assert.ok(await page.locator('.doc-icon-chip[title="bug"]').count() >= 1, 'the others stay drawn');
    await page.close();
  });

  test('a dressed text cell and a description preview draw the icon too', async () => {
    const page = await open();
    const drawn = await page.evaluate(() => {
      const tokens = globalThis.WeaveEditorLib.inlineTokens('see :bell:', inlineIconAccept);
      const host = document.createElement('span');
      dressTokens(host, tokens);
      return { icon: host.querySelectorAll('.md-icon svg').length, text: host.textContent };
    });
    assert.equal(drawn.icon, 1);
    assert.equal(drawn.text.trim(), 'see', 'the token itself is gone from the text');
    await page.close();
  });
}
