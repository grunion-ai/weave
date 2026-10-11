import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let people;

const s = await launch('entity body blocks', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  people = weave.createTable({ space: 'Showcase', name: 'Person' });
});
if (s) {
  const { base, browser, weave } = s;
  let n = 0;
  const build = () => {
    const db = weave.createTable({ space: 'Showcase', name: `Part ${++n}` });
    weave.addField(db, { name: 'Vendor', type: 'text' });
    weave.addField(db, { name: 'Batch', type: 'text' });
    weave.addField(db, { name: 'Brief', type: 'document' });
    weave.addField(db, { name: 'Files', type: 'attachments' });
    weave.addRelation(db, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: `Owns ${n}` });
    const id = weave.createEntity(db, { name: 'Sensor board', values: { Vendor: 'Nordic' } }).id;
    return { db, id };
  };

  const open = async (id, width = 1400) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values .fieldrow');
    await page.waitForSelector('[data-block="Peers"]');
    return page;
  };
  const blocks = (page) => page.$$eval('.entity-body > [data-block]', (ns) => ns.map((x) => x.dataset.block));
  const press = async (page, handle) => {
    await handle.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await handle.hover();
    const b = await handle.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 6, { steps: 2 });
  };
  const aim = async (page, target, forward) => {
    const r = await target.boundingBox();
    await page.mouse.move(r.x + 30, forward ? r.y + r.height - 2 : r.y + 2, { steps: 6 });
  };
  const dragBlock = async (page, from, onto) => {
    const order = await blocks(page);
    await press(page, page.locator(`[data-block="${from}"] .opt-grip`).first());
    await aim(page, page.locator(`[data-block="${onto}"]`), order.indexOf(onto) > order.indexOf(from));
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.wv-reorder-slot, .wv-reorder-lift'));
  };

  test('every block on the page carries a reposition anchor', async () => {
    const { id } = build();
    const page = await open(id);
    assert.deepEqual(await blocks(page), ['@values', 'Description', 'Brief', 'Files', 'Peers'],
      'the field block comes first by default, then the documents');
    const anchored = await page.$$eval('[data-block]', (ns) =>
      ns.filter((x) => x.querySelector('.opt-grip.wv-reorder-handle')).map((x) => x.dataset.block));
    assert.deepEqual(anchored, ['@values', 'Description', 'Brief', 'Files', 'Peers'],
      'a document and a related table are as movable as the field block');
    await page.close();
  });

  test('the field block moves below a document and stays there', async () => {
    const { db, id } = build();
    const page = await open(id);
    await dragBlock(page, '@values', 'Brief');
    await page.waitForFunction(() => document.querySelector('[data-block]').dataset.block !== '@values',
      null, { timeout: 4000 });
    assert.deepEqual(await blocks(page), ['Description', 'Brief', '@values', 'Files', 'Peers'],
      'dragging forward lands the block just after the one it was dropped on');
    assert.deepEqual(weave.bodyBlocks(db), ['Description', 'Brief', '@values', 'Files', 'Peers'],
      'the table remembers, so the next reader sees the same page');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-block="Peers"]');
    assert.deepEqual(await blocks(page), ['Description', 'Brief', '@values', 'Files', 'Peers']);
    await page.close();
  });

  test('a related table moves above the field block', async () => {
    const { db, id } = build();
    const page = await open(id);
    await dragBlock(page, 'Peers', '@values');
    await page.waitForFunction(() => document.querySelector('[data-block]').dataset.block === 'Peers',
      null, { timeout: 4000 });
    assert.deepEqual(await blocks(page), ['Peers', '@values', 'Description', 'Brief', 'Files']);
    assert.deepEqual(weave.bodyBlocks(db), ['Peers', '@values', 'Description', 'Brief', 'Files']);
    await page.close();
  });

  test('holding a block opens a placeholder between the blocks, the same one the rows use (Feature #282)', async () => {
    const page = await open(build().id);
    const before = await page.$eval('[data-block="Brief"]', (n) => getComputedStyle(n).backgroundColor);
    await press(page, page.locator('[data-block="@values"] .opt-grip').first());
    await aim(page, page.locator('[data-block="Brief"]'), true);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    const cue = await page.evaluate(() => {
      const body = document.querySelector('.entity-body');
      const onto = body.querySelector(':scope > [data-block="Brief"]');
      const slot = body.querySelector(':scope > .wv-reorder-slot');
      return {
        slots: body.querySelectorAll(':scope > .wv-reorder-slot').length,
        which: slot?.dataset.block ?? null,
        afterBrief: !!slot && !!(onto.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING),
        fill: getComputedStyle(onto).backgroundColor, shadow: getComputedStyle(onto).boxShadow,
      };
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.wv-reorder-slot, .wv-reorder-lift'));
    assert.equal(cue.slots, 1, 'one placeholder among the blocks');
    assert.equal(cue.which, '@values', 'the Fields block waits in it, dimmed');
    assert.ok(cue.afterBrief, 'below the midpoint the placeholder opens beneath the block');
    assert.equal(cue.fill, before, 'the block under the pointer is not tinted');
    assert.equal(cue.shadow, 'none', 'and wears no line: the placeholder is the whole cue');
    assert.deepEqual(await blocks(page), ['@values', 'Description', 'Brief', 'Files', 'Peers'], 'Escape puts the block back');
    await page.close();
  });

  test('the field block folds on a caret, like a document, and stays folded', async () => {
    const { id } = build();
    const page = await open(id);
    const head = '[data-block="@values"] .block-head';
    assert.ok(await page.$(`${head} .doc-caret`), 'the field block head carries the document caret');
    const order = await page.$$eval(`${head} > *`, (ns) => ns.map((n) => n.className.split(' ')[0]));
    assert.deepEqual(order.slice(0, 3), ['opt-grip', 'doc-caret', 'block-name'], 'grip, caret, name — the order a document head uses');
    assert.ok(await page.$(`${head} .opt-grip .wv-icon`), 'and the grip draws the row grip icon — an empty span is not a handle (Issue #210: no ⠿ text glyph)');
    await page.click(`${head} .doc-caret`);
    await page.waitForFunction(() => document.querySelector('.entity-values').classList.contains('hidden'), null, { timeout: 4000 });
    assert.ok(await page.$eval(`${head} .doc-caret`, (n) => n.classList.contains('closed')), 'the caret turns to say it is closed');
    assert.equal(await page.$$eval('[data-block]', (ns) => ns.map((n) => n.dataset.block)).then((b) => b[0]), '@values',
      'folding did not move the block');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values', { state: 'attached' });
    assert.ok(await page.locator('.entity-values').first().evaluate((n) => n.classList.contains('hidden')), 'a reload opens the page folded, as it was left');
    await page.click(`${head} .doc-caret`);
    await page.waitForFunction(() => !document.querySelector('.entity-values').classList.contains('hidden'), null, { timeout: 4000 });
    assert.ok(await page.$eval(`${head} .doc-caret`, (n) => !n.classList.contains('closed')), 'and a second click opens it again');
    await page.close();
  });

  test('a field drag and a block drag do not reach into each other', async () => {
    const { db, id } = build();
    const page = await open(id);
    const before = await blocks(page);
    await press(page, page.locator('.entity-values [data-field="Vendor"] .opt-grip'));
    await aim(page, page.locator('[data-block="Brief"]'), true);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.wv-reorder-slot, .wv-reorder-lift'));
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await blocks(page), before, 'a field cannot become a block');
    assert.equal(weave.getTable(db).bodyOrder, undefined, 'and it writes nothing');
    const order = await page.$$eval('.entity-values [data-field]', (ns) => ns.map((x) => x.dataset.field));
    assert.deepEqual(order, ['Vendor', 'Batch'], 'the field stayed where it was');
    await page.close();
  });
}
