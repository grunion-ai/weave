import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let slide, other;
const s = await launch('slide preview fold', (weave) => {
  weave.createSpace({ name: 'Net' });
  const slides = weave.createTable({ space: 'Net', name: 'Slide' });
  weave.addField(slides, { name: 'Model', type: 'document' });
  slide = weave.createEntity(slides, { name: 'Title slide' });
  other = weave.createEntity(slides, { name: 'Closing slide' });
});

if (s) {
  const { base, browser } = s;
  const visit = async (page, id) => {
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.deck-section .doc-caret');
  };
  const state = (page) => page.$eval('.deck-section', (sec) => {
    const caret = sec.querySelector('.doc-section-head .doc-caret');
    return {
      expanded: caret.getAttribute('aria-expanded'),
      closed: caret.classList.contains('closed'),
      title: caret.title,
      bodyHidden: sec.querySelector('.doc-section-body').classList.contains('hidden'),
    };
  });

  test('the slide preview folds from its head caret, per record, and the fold survives a reload', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await visit(page, slide.id);
    assert.deepEqual(await state(page),
      { expanded: 'true', closed: false, title: 'Collapse section', bodyHidden: false }, 'open by default');
    await page.click('.deck-section .doc-caret');
    assert.deepEqual(await state(page),
      { expanded: 'false', closed: true, title: 'Collapse section', bodyHidden: true }, 'folded: the frame hides and the caret says so');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.deck-section .doc-caret');
    assert.deepEqual(await state(page),
      { expanded: 'false', closed: true, title: 'Collapse section', bodyHidden: true }, 'the fold survives a reload');
    await visit(page, other.id);
    assert.equal((await state(page)).bodyHidden, false, 'another slide keeps its own fold');
    await visit(page, slide.id);
    await page.click('.deck-section .doc-caret');
    assert.deepEqual(await state(page),
      { expanded: 'true', closed: false, title: 'Collapse section', bodyHidden: false }, 'a second click opens it again');
    await page.close();
  });
}
