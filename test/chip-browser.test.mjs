import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let task, tasks;

const s = await launch('chip', (weave) => {
  weave.createSpace({ name: 'Dev' });
  tasks = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.createTable({ space: 'Dev', name: 'Person' });
  weave.addField(tasks, {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }, { name: 'Done', category: 'done' }] },
  });
  weave.addField(tasks, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addField(tasks, { name: 'Due', type: 'date' });
  weave.addRelation(tasks, { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-one' });
  const ada = weave.createEntity('Person', { name: 'Ada' });
  task = weave.createEntity('Task', { name: 'Ship the editor', Severity: 'High', Due: '2026-09-12' });
  weave.setState(task.id, 'State', 'Doing');
  weave.link(task.id, 'Owner', [ada.id]);
  weave.updateTable(tasks, { hiddenFields: [] });
});
if (s) {
  const { base, browser } = s;
  const open = async (id, { colorScheme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-appears-chip .mention-caret');
    return page;
  };
  const CARET = '.wv-appears-chip .mention-caret';
  const caretState = (page) => page.$eval(CARET, (c) => {
    const r = c.getBoundingClientRect();
    return {
      transform: getComputedStyle(c).transform,
      open: c.closest('.mention-wrap').classList.contains('open'),
      expanded: c.getAttribute('aria-expanded'),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  });
  const settle = (page) => settled(page.locator(CARET));
  const angle = (transform) => {
    if (!transform || transform === 'none') return 0;
    const [a, b] = transform.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`the retract caret faces the text: 180° from the expand caret, same box, in ${colorScheme}`, async () => {
      const page = await open(task.id, { colorScheme });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      const closed = await caretState(page);
      assert.equal(closed.open, false);
      assert.equal(closed.expanded, 'false');
      assert.equal(angle(closed.transform), 0, 'at rest the › points right, toward the segments it opens');
      await page.click(CARET);
      await settle(page);
      const opened = await caretState(page);
      assert.equal(opened.open, true, 'the click opened the segments');
      assert.equal(opened.expanded, 'true');
      assert.equal(Math.abs(angle(opened.transform)), 180,
        `open, the › turns to face the label (‹), not down — got ${opened.transform}`);
      assert.deepEqual([opened.width, opened.height], [closed.width, closed.height],
        'the same glyph in the same box: the hit area does not change with the state');
      assert.ok(await page.isVisible('.wv-appears-chip .mention-fields'), 'the segments are showing');
      await page.click(CARET);
      await settle(page);
      const again = await caretState(page);
      assert.equal(again.open, false, 'a second click folds the segments back in');
      assert.equal(angle(again.transform), 0, 'and the caret points right again');
      await page.close();
    });
  }

  const measure = (page, sel) => page.$eval(sel, (n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { height: Math.round(r.height), fontSize: cs.fontSize, radius: cs.borderTopLeftRadius, background: cs.backgroundColor };
  });
  const tokens = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { font: cs.getPropertyValue('--wv-chip-font').trim(), line: cs.getPropertyValue('--wv-chip-line').trim() };
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`every chip surface draws at the shared size — label >= 13px, box >= 24px, 20px in a Comfortable grid — in ${colorScheme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid td .k-state');
      const tok = await tokens(page);
      assert.match(tok.font, /^\d+(\.\d+)?px$/, 'the size is a token on :root, --wv-chip-font');
      assert.match(tok.line, /^\d+(\.\d+)?px$/, 'and so is the line, --wv-chip-line');
      const body = await page.$eval('body', (b) => parseFloat(getComputedStyle(b).fontSize));
      const font = parseFloat(tok.font);
      assert.ok(font >= 13 && font <= body, `the label is body size or one step below: got ${tok.font} under a ${body}px body`);
      const surfaces = {
        'a state cell': '.wv-grid td .k-state',
        'a select cell': '.wv-grid td .k-select',
        'a relation cell': '.wv-grid td .k-rel',
      };
      for (const [what, sel] of Object.entries(surfaces)) {
        const m = await measure(page, sel);
        assert.equal(m.fontSize, tok.font, `${what} reads the token, not its own number`);
        assert.ok(m.height >= 20 && m.height <= 22, `${what} is a Comfortable grid chip: ${m.height}px, want 20 to 22`);
        assert.equal(m.radius, '4px', `${what} keeps the 4px corner`);
      }
      assert.equal((await measure(page, '.wv-grid td .k-rel')).background, 'rgba(0, 0, 0, 0)', 'still no fill behind a pointer chip');
      await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-appears-chip .k-rel');
      const appears = await measure(page, '.wv-appears-chip .k-rel');
      assert.equal(appears.fontSize, tok.font, 'the Appears-as chip reads the token');
      assert.ok(appears.height >= 24, `the Appears-as chip is >= 24px tall, got ${appears.height}`);
      await page.close();
    });
  }
}
