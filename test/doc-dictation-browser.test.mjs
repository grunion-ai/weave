import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('dictation into a document', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Note' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;

  const open = async (doc = '') => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const surface = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    const cdp = await page.context().newCDPSession(page);
    return { id, page, surface, cdp };
  };

  const saved = async (page, id, want) => {
    for (let i = 0; i < 100 && (weave.getDoc(id, 'Description') ?? '') !== want; i++) await page.waitForTimeout(50);
    return weave.getDoc(id, 'Description') ?? '';
  };

  const caretAfter = (surface, word) => surface.evaluate((root, w) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const at = t.data.indexOf(w);
      if (at < 0) continue;
      root.focus();
      const r = document.createRange();
      r.setStart(t, at + w.length);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return true;
    }
    return false;
  }, word);

  const offsetOf = (surface, word) => surface.evaluate((root, w) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const at = t.data.indexOf(w);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(root, 0);
      r.setEnd(t, at);
      return r.toString().length;
    }
    return -1;
  }, word);

  const dictate = async (cdp, hypotheses) => {
    for (const text of hypotheses) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.insertText', { text: hypotheses.at(-1) });
  };

  const replaceWord = (surface, word, by) => surface.evaluate((root, [w, b]) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const at = t.data.indexOf(w);
      if (at < 0) continue;
      root.focus();
      const r = document.createRange();
      r.setStart(t, at);
      r.setEnd(t, at + w.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', b);
      const init = { inputType: 'insertReplacementText', dataTransfer, bubbles: true, cancelable: true, composed: true };
      if (!t.parentElement.dispatchEvent(new InputEvent('beforeinput', init))) return 'prevented';
      t.replaceData(at, w.length, b);
      const caret = document.createRange();
      caret.setStart(t, at + b.length);
      caret.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(caret);
      t.parentElement.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', dataTransfer, bubbles: true, composed: true }));
      return 'replaced';
    }
    return 'missing';
  }, [word, by]);

  test('two dictated sentences land in order and save as spoken (Issue #1882)', async () => {
    const { id, page, surface, cdp } = await open();
    try {
      await surface.click();
      await dictate(cdp, ['Send', 'Send the', 'Send the report', 'Send the report to Dana.']);
      await dictate(cdp, [' She', ' She asked', ' She asked for it', ' She asked for it by Friday.']);
      const want = 'Send the report to Dana. She asked for it by Friday.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('a hypothesis the engine revises mid-sentence saves only the final words (Issue #1882)', async () => {
    const { id, page, surface, cdp } = await open();
    try {
      await surface.click();
      await dictate(cdp, ['Write', 'Right to', 'Write to the', 'Write to the team today.']);
      const want = 'Write to the team today.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('a slow dictation keeps its words while autosaves run under it (Issue #1882)', async () => {
    const { id, page, surface, cdp } = await open('Status:\n');
    const puts = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/doc')) puts.push(r.postData()); });
    try {
      assert.ok(await caretAfter(surface, 'Status:'));
      await dictate(cdp, [' Shipped', ' Shipped the fix.']);
      for (let i = 0; i < 80 && !puts.length; i++) await page.waitForTimeout(50);
      assert.ok(puts.length, 'an autosave went out after the first sentence');
      for (const text of [' Next', ' Next we', ' Next we test', ' Next we test it.']) {
        await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
        await page.waitForTimeout(400);
        assert.match(await surface.evaluate((root) => root.textContent), new RegExp(`Shipped the fix\\.${text.replace('.', '\\.')}`), 'the marked text stays while it is spoken');
      }
      await cdp.send('Input.insertText', { text: ' Next we test it.' });
      const want = 'Status: Shipped the fix. Next we test it.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('a sentence dictated after existing text lands at the caret (Issue #1882)', async () => {
    const { id, page, surface, cdp } = await open('Agenda: budget. Notes follow.\n');
    try {
      assert.ok(await caretAfter(surface, 'budget.'));
      await dictate(cdp, [' Hiring', ' Hiring plan', ' Hiring plan next.']);
      const want = 'Agenda: budget. Hiring plan next. Notes follow.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('a dictation correction over a replacement range replaces only that word (Issue #1882)', async () => {
    const { id, page, surface, cdp } = await open('Meet me at noon tomorrow.\n');
    try {
      assert.ok(await caretAfter(surface, 'tomorrow.'));
      const start = await offsetOf(surface, 'noon');
      assert.ok(start >= 0, 'the word to correct is on the page');
      await cdp.send('Input.imeSetComposition', { text: 'nine', selectionStart: 4, selectionEnd: 4, replacementStart: start, replacementEnd: start + 4 });
      await cdp.send('Input.insertText', { text: 'nine' });
      assert.equal(await saved(page, id, 'Meet me at nine tomorrow.\n'), 'Meet me at nine tomorrow.\n');
      assert.ok(await caretAfter(surface, 'tomorrow.'));
      await dictate(cdp, [' Bring', ' Bring the', ' Bring the slides.']);
      const want = 'Meet me at nine tomorrow. Bring the slides.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('insertReplacementText over one word replaces only that word in the save (Issue #1882)', async () => {
    const { id, page, surface } = await open('The quarterly numbers look grate this time.\n');
    try {
      assert.equal(await replaceWord(surface, 'grate', 'great'), 'replaced');
      const want = 'The quarterly numbers look great this time.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('insertReplacementText inside a list item keeps the list and saves the word (Issue #1882)', async () => {
    const { id, page, surface } = await open('- Call the vender\n- Book the room\n');
    try {
      assert.equal(await replaceWord(surface, 'vender', 'vendor'), 'replaced');
      const want = '- Call the vendor\n- Book the room\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });

  test('dictation into a list item stays in that item (Issue #1882)', async () => {
    const { id, page, surface, cdp } = await open('- Call the vendor\n- Book the room\n');
    try {
      assert.ok(await caretAfter(surface, 'room'));
      await dictate(cdp, [' for', ' for Tuesday', ' for Tuesday. Order lunch.']);
      const want = '- Call the vendor\n- Book the room for Tuesday. Order lunch.\n';
      assert.equal(await saved(page, id, want), want);
    } finally { await page.close(); }
  });
}
