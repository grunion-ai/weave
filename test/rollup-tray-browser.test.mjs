import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let people, teams;
const s = await launch('rollup recipe tray', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  people = weave.createTable({ space: 'Showcase', name: 'People' });
  teams = weave.createTable({ space: 'Showcase', name: 'Field Types' });
  weave.addField(people, { name: 'Skill', type: 'rating', config: { max: 5, icon: 'lucide:star' } });
  weave.addField(people, { name: 'Age', type: 'number' });
  weave.addField(people, { name: 'Score', type: 'number', config: { display: 'bar' } });
  weave.addRelation(teams, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: 'Teams' });
  weave.addField(teams, { name: 'Peer skill', type: 'rollup', config: { relationField: 'Peers', targetField: 'Skill', aggregate: 'avg' } });
  weave.addField(teams, { name: 'Peer skills', type: 'lookup', config: { relationField: 'Peers', targetField: 'Skill' } });
  weave.addField(teams, { name: 'Peer count', type: 'rollup', config: { relationField: 'Peers', aggregate: 'count' } });
  weave.addField(teams, { name: 'Peer age', type: 'rollup', config: { relationField: 'Peers', targetField: 'Age', aggregate: 'avg' } });
  for (const scheme of ['light', 'dark']) weave.addField(teams, { name: `Mean age ${scheme}`, type: 'rollup', config: { relationField: 'Peers', targetField: 'Age', aggregate: 'avg' } });
  weave.addField(teams, { name: 'Peer score', type: 'rollup', config: { relationField: 'Peers', targetField: 'Score', aggregate: 'sum' } });
  const a = weave.createEntity(people, { name: 'Ada', values: { Skill: 4, Age: 30, Score: 3 } });
  const b = weave.createEntity(people, { name: 'Bo', values: { Skill: 2, Age: 40, Score: 5 } });
  weave.createEntity(teams, { name: 'Core', values: { Peers: [a.id, b.id] } });
});

if (s) {
  const { base, browser } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  async function grid(colorScheme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme });
    await page.goto(`${base}/#/table/${teams.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }
  async function openTray(page, field) {
    const th = page.locator('.wv-grid thead th.col-head', { hasText: new RegExp(`^${field}\\W*$`) }).first();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Field settings' }).click();
    await page.waitForSelector('.tray-form');
  }
  const section = (page, label) => page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: new RegExp(`^${label}$`) }) });
  const faceOf = (page, label) => section(page, label).locator('.picker-face').innerText();
  const aggOf = (page) => section(page, 'Aggregate').locator('.seg-opt.on').innerText();
  const cellOf = (page, field) => page.evaluate((name) => {
    const heads = [...document.querySelectorAll('.wv-grid thead th.col-head')];
    const i = heads.findIndex((h) => h.textContent.trim().replace(/\W*$/, '') === name);
    const th = heads[i];
    const row = document.querySelector('.wv-grid tbody tr.entity-row');
    return row.children[th.cellIndex].textContent.trim();
  }, field);

  for (const colorScheme of ['light', 'dark']) {
    test(`a rollup's tray names its relation, field, aggregate and display (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      try {
        await openTray(page, 'Peer skill');
        const text = await page.textContent('.tray-form');
        assert.doesNotMatch(text, /delete and recreate|cannot be changed here/, 'the dead end is gone');
        assert.match(await faceOf(page, 'Relation'), /^Peers → .*People$/, 'the relation names the table it reaches');
        assert.match(await faceOf(page, 'Target field'), /^Skill · rating/);
        assert.equal(await aggOf(page), 'avg');
        for (const label of ['Relation', 'Target field']) {
          const face = section(page, label).locator('.picker-face');
          assert.equal(await face.isEnabled(), true, `${label} can be changed`);
          const box = await face.boundingBox();
          assert.ok(box && box.width > 40 && box.height > 10, `${label} is drawn`);
          const [fg, bg] = await face.evaluate((n) => [getComputedStyle(n).color, getComputedStyle(n).backgroundColor]);
          assert.notEqual(fg, bg, `${label} reads against its ground`);
        }
        await section(page, 'Result').locator('.wv-rating[data-value="3"]').waitFor();
        assert.match(await section(page, 'Result').textContent(), /^ResultCore: /);
        const shows = section(page, 'Shows as');
        assert.match(await shows.textContent(), /rating on People › Skill: 5 stars/);
        const link = shows.locator('a', { hasText: 'Skill' });
        assert.equal(await link.count(), 1, 'a link to the field that owns the display');
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/rollup-tray-${colorScheme}.png` });
        await link.click();
        await page.waitForFunction(() => document.querySelector('.tray-form input[name="name"]')?.value === 'Skill');
        assert.equal(await section(page, 'Relation').count(), 0, 'the rating field\'s own tray is open');
      } finally { await page.close(); }
    });

    test(`a lookup's tray names its relation, field and display, and no aggregate (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      try {
        await openTray(page, 'Peer skills');
        assert.match(await faceOf(page, 'Relation'), /^Peers\b/);
        assert.match(await faceOf(page, 'Target field'), /^Skill\b/);
        assert.equal(await section(page, 'Aggregate').count(), 0);
        assert.match(await section(page, 'Shows as').textContent(), /rating on People › Skill: 5 stars/);
        assert.doesNotMatch(await page.textContent('.tray-form'), /delete and recreate/);
      } finally { await page.close(); }
    });

    test(`a rollup repoints from its tray and the cell redraws (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      const field = `Mean age ${colorScheme}`;
      try {
        assert.equal(await cellOf(page, field), '35');
        await openTray(page, field);
        await section(page, 'Aggregate').locator('.seg-opt', { hasText: /^max$/ }).click();
        assert.equal(await page.locator('.tray-form .recipe-warn').count(), 0, 'a max of a number is still a number');
        await section(page, 'Target field').locator('.picker-face').click();
        await page.locator('.picker-pop .picker-row', { has: page.locator('.picker-label', { hasText: /^Score · number$/ }) }).click();
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        await page.waitForFunction((name) => {
          const heads = [...document.querySelectorAll('.wv-grid thead th.col-head')];
          const th = heads.find((h) => h.textContent.trim().replace(/\W*$/, '') === name);
          return document.querySelector('.wv-grid tbody tr.entity-row').children[th.cellIndex].textContent.trim() === '5';
        }, field);
        await openTray(page, field);
        assert.match(await faceOf(page, 'Target field'), /^Score · number/);
        assert.equal(await aggOf(page), 'max');
        await section(page, 'Aggregate').locator('.seg-opt', { hasText: /^join$/ }).click();
        const warn = page.locator('.tray-form .recipe-warn');
        await warn.waitFor();
        assert.match(await warn.textContent(), new RegExp(`${field} gives text instead of a number after this change`));
        const [fg, bg] = await warn.evaluate((n) => [getComputedStyle(n).color, getComputedStyle(document.querySelector('.tray-form')).backgroundColor]);
        assert.notEqual(fg, bg, 'the warning reads against the tray');
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/rollup-repoint-${colorScheme}.png` });
        await page.locator('.tray-close').click();
      } finally { await page.close(); }
    });
  }

  test('a count reads no field, a bar rollup draws its bar, and a plain number rollup names the field it reads', async () => {
    for (const [field, check] of [
      ['Peer count', async (page) => {
        assert.equal(await section(page, 'Target field').count(), 0, 'a count reads no field');
        assert.equal(await aggOf(page), 'count');
        assert.match(await section(page, 'Shows as').textContent(), /count/i);
      }],
      ['Peer score', async (page) => {
        assert.match(await section(page, 'Shows as').textContent(), /Drawn as a bar from People › Score, on the column max\./);
        await section(page, 'Result').locator('.cg-wrap.cg-bar').waitFor();
        assert.match(await section(page, 'Result').textContent(), /8/, 'the sum, 3 + 5');
      }],
      ['Peer age', async (page) => {
        assert.match(await section(page, 'Shows as').textContent(), /People › Age/);
        await page.fill('.tray-form input[name="name"]', 'Peer mean age');
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        await page.waitForSelector('.wv-grid thead th.col-head:has-text("Peer mean age")');
      }],
    ]) {
      const page = await grid('light');
      try {
        await openTray(page, field);
        await check(page);
      } finally { await page.close(); }
    }
  });
}
