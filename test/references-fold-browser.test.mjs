import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
let target, issue, sibling;
const s = await launch('reference panel fold', (weave) => {
  weave.createSpace({ name: 'Dev' });
  weave.createTable({ space: 'Dev', name: 'Task' });
  weave.createTable({ space: 'Dev', name: 'Issue' });
  target = weave.createEntity('Task', { name: 'Ship the editor' });
  issue = weave.createEntity('Issue', { name: 'Editor loses focus', doc: 'blocks [[Task#1]] until fixed' });
  sibling = weave.createEntity('Issue', { name: 'Editor drops paste', doc: 'also blocks [[Task#1]]' });
});
if (s) {
  const { base, browser } = s;
  const visit = async (page, id) => {
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
  };
  const open = async (id) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await visit(page, id);
    return page;
  };
  const state = (page, sel) => page.$eval(sel, (c) => {
    const caret = c.querySelector('.card-header .doc-caret');
    return {
      caret: !!caret,
      expanded: caret?.getAttribute('aria-expanded') ?? null,
      bodyHidden: c.querySelector('.card-body').classList.contains('hidden'),
      title: c.querySelector('.card-title').textContent,
    };
  });

  test('each reference card folds from a head caret and keeps its count (Issue #993)', async () => {
    const page = await open(issue.id);
    await page.waitForSelector('.ref-outbound-card');
    assert.deepEqual(await state(page, '.ref-outbound-card'),
      { caret: true, expanded: 'true', bodyHidden: false, title: 'References · 1' }, 'open by default');
    await page.click('.ref-outbound-card .doc-caret');
    assert.deepEqual(await state(page, '.ref-outbound-card'),
      { caret: true, expanded: 'false', bodyHidden: true, title: 'References · 1' }, 'folded: the body hides, the count stays');
    assert.equal(await page.isVisible('.ref-outbound-card .card-title'), true, 'the head stays on screen');
    await page.click('.ref-outbound-card .doc-caret');
    assert.equal((await state(page, '.ref-outbound-card')).bodyHidden, false, 'a second click unfolds it');
    await page.close();
  });

  test('the fold is remembered per table and per card (Issue #993)', async () => {
    const page = await open(issue.id);
    await page.waitForSelector('.ref-outbound-card');
    await page.click('.ref-outbound-card .doc-caret');
    await visit(page, sibling.id);
    await page.waitForSelector('.ref-outbound-card');
    assert.equal((await state(page, '.ref-outbound-card')).bodyHidden, true, 'another Issue opens with References folded');
    await visit(page, target.id);
    await page.waitForSelector('.ref-inbound-card');
    assert.deepEqual(await state(page, '.ref-inbound-card'),
      { caret: true, expanded: 'true', bodyHidden: false, title: 'Referenced by · 2' }, 'a Task card in another table stays open');
    await page.click('.ref-inbound-card .doc-caret');
    await visit(page, issue.id);
    await page.waitForSelector('.ref-outbound-card');
    assert.equal((await state(page, '.ref-outbound-card')).bodyHidden, true, 'folding the Task card left the Issue fold alone');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.ref-outbound-card');
    assert.equal((await state(page, '.ref-outbound-card')).bodyHidden, true, 'and it survives a reload');
    await page.close();
  });
}
