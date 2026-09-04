/* Inline icons in the editor, driven through a real browser (Kyle,
   2026-09-02: "show fully formatted real icons in the .md — these can replace
   emojis", then: "rebuild from scratch"). The instant-render surface is the
   document, so `:bell:` has to be a node of that surface — Lute's shortcode
   node, drawn from the inventory table that replaces the GitHub emoji table —
   in a table cell as much as in a sentence, and serialised back as the token.
   Playwright is not a dependency; the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let row;
const DOC = 'A :bell: rings and :check: is done, :ring-quarter: along, :smile: stays, :rocket: ours, at 12:30:45.\n\n| Icon | Name |\n| --- | --- |\n| :bug: | bug |\n| :star: | star |\n';
const s = await launch('inline icons', (weave) => {
  weave.createSpace({ name: 'Product' });
  const notes = weave.createTable({ space: 'Product', name: 'Note' });
  row = weave.createEntity(notes, { name: 'Icons inline' }).id;
  weave.setDoc(row, DOC);
});
if (s) {
  const { base, browser, weave } = s;

  const open = async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir .vditor-reset');
    await page.waitForTimeout(700);
    return page;
  };
  const nodes = (page) => page.evaluate(() => [...document.querySelectorAll('.vditor-ir .vditor-reset [data-type="emoji"]')].map((n) => {
    const img = n.querySelector('img');
    return { alt: img?.getAttribute('alt'), src: img?.getAttribute('src')?.split('/').slice(-2).join('/'), loaded: img ? img.complete && img.naturalWidth > 0 : false, inCell: !!n.closest('td') };
  }));

  test('a token is a node of the surface, in prose and in a table cell, drawn from the inventory', async () => {
    const page = await open();
    const found = await nodes(page);
    const by = Object.fromEntries(found.map((n) => [n.alt, n]));
    for (const t of ['bell', 'check', 'ring-quarter', 'rocket', 'bug', 'star']) {
      assert.ok(by[t], `${t} is drawn (got ${found.map((n) => n.alt).join(', ')})`);
      assert.equal(by[t].src, `icons/${t}.svg`, `${t} comes from the inventory's own image`);
      assert.ok(by[t].loaded, `${t}.svg loads`);
    }
    assert.ok(by.bug.inCell && by.star.inCell, 'table cells carry them too');
    assert.equal(found.some((n) => n.alt === 'smile'), false, 'an emoji shortcode is not in the table');
    await page.close();
  });

  test('nothing in the table is an emoji: :smile: stays text, :rocket: is our rocket', async () => {
    const page = await open();
    const text = await page.evaluate(() => document.querySelector('.vditor-ir .vditor-reset').textContent);
    assert.ok(text.includes(':smile:'), 'the unknown shortcode is literal');
    assert.ok(text.includes('12:30:45'), 'a clock time is literal');
    assert.doesNotMatch(text, /🔔|⭐|🐛|🚀|😄/, 'no emoji character is painted from a shortcode');
    await page.close();
  });

  test('the stored markdown keeps the token — the node serialises back to :bell:', async () => {
    const page = await open();
    // Type at the end of the document so Lute serialises the whole surface,
    // nodes included, back through the save path.
    const typed = async () => {
      await page.locator('.vditor-ir .vditor-reset').first().click();
      await page.keyboard.press('End'); await page.keyboard.type(' more');
      return page.waitForFunction(() => document.querySelector('.vditor-ir .vditor-reset').textContent.includes(' more'), null, { timeout: 2000 })
        .then(() => true, () => false);
    };
    // A busy box can drop the first click before the editor takes focus.
    if (!(await typed())) assert.ok(await typed(), 'the keystrokes reach the editor');
    // The autosave lands when the engine holds the typed text; poll that.
    const until = Date.now() + 5000;
    while (!weave.getDoc(row).includes(' more') && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    const stored = weave.getDoc(row);
    assert.ok(stored.includes(' more'), 'the autosave wrote the typed text');
    assert.ok(stored.includes(':bell:') && stored.includes(':check:') && stored.includes(':ring-quarter:'), `tokens survive a round trip: ${stored.slice(0, 80)}`);
    assert.doesNotMatch(stored, /<img|🔔/, 'no image tag and no emoji character was written into the document');
    await page.close();
  });

  test('a dressed text cell and a description preview draw the icon too', async () => {
    const page = await open();
    const drawn = await page.evaluate(() => {
      const tokens = globalThis.WeaveEditorLib.inlineTokens('see :bell: and :ring-half:', inlineIconAccept);
      const host = document.createElement('span');
      dressTokens(host, tokens);
      return { icon: host.querySelectorAll('.md-icon svg').length, text: host.textContent };
    });
    assert.equal(drawn.icon, 2);
    assert.equal(drawn.text.trim().replace(/\s+/g, ' '), 'see and', 'the tokens themselves are gone from the text');
    await page.close();
  });
}
