import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { launch, phoneBrowser, phoneProfile } from './lib/browser.mjs';
import { PAINT_PROBE, paintMisses } from './lib/chip-paint.mjs';

await import('../public/chip-core.js');
const core = globalThis.chipCore;

const PAINTERS = ['public/chip.css', 'public/style.css', 'public/app.js', 'public/chip-view.js', 'public/chip-core.js', 'src/applet.js'];

const PASSCODE = '52918374';
const prior = { pass: process.env.WEAVE_APPLET_PASSCODE, table: process.env.WEAVE_APPLET_TABLE };
process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
process.env.WEAVE_APPLET_TABLE = 'Net/Skill';
test.after(() => {
  for (const [key, was] of [['WEAVE_APPLET_PASSCODE', prior.pass], ['WEAVE_APPLET_TABLE', prior.table]]) {
    if (was === undefined) delete process.env[key]; else process.env[key] = was;
  }
});

const STATES = [
  { name: 'Active', category: 'in-progress', hue: 'green', default: true },
  { name: 'Deprecated', category: 'in-progress', hue: 'amber' },
  { name: 'Deactivated', category: 'done', hue: 'slate' },
  { name: 'Draft', category: 'not-started' },
  { name: 'Retired', category: 'canceled' },
];
const TIERS = [{ name: 'Gold', hue: 'amber' }, { name: 'Core', hue: 'purple' }];
const TAGS = [{ name: 'Ops', hue: 'teal' }, { name: 'Web', hue: 'pink' }];
const HUE_OF = Object.fromEntries([
  ...STATES.map((st) => [st.name, core.stateHue(st, st.category)]),
  ...[...TIERS, ...TAGS].map((o) => [o.name, core.hueName(o.hue)]),
]);
const STATE_NAMES = STATES.map((st) => st.name);
const ROWS = [
  { name: 'Search skill', State: 'Active', Tier: 'Gold', Tags: ['Ops', 'Web'] },
  { name: 'Old skill', State: 'Deprecated', Tier: 'Core' },
  { name: 'Gone skill', State: 'Deactivated' },
  { name: 'Draft skill', State: 'Draft' },
  { name: 'Retired skill', State: 'Retired' },
];

let skill;
let plan;
let ids;
const s = await launch('chip surface colour', (weave) => {
  weave.createSpace({ name: 'Net' });
  skill = weave.createTable({ space: 'Net', name: 'Skill' });
  weave.addField(skill.id, { name: 'State', type: 'workflow', config: { states: STATES } });
  weave.addField(skill.id, { name: 'Tier', type: 'select', config: { options: TIERS } });
  weave.addField(skill.id, { name: 'Tags', type: 'multiselect', config: { options: TAGS } });
  ids = ROWS.map((r) => weave.createEntity(skill.id, r).id);
  plan = weave.createTable({ space: 'Net', name: 'Plan' });
  weave.addRelation(plan.id, { name: 'Skills', targetDb: skill.id, cardinality: 'many-to-many', inverseName: 'Plans' });
  weave.createEntity(plan.id, { name: 'Rollout', Skills: ids });
});

if (s) {
  const { base, browser } = s;

  test('every file that paints a chip is one this suite runs against', () => {
    for (const file of PAINTERS) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} exists`);
  });

  const appPage = async (theme, hash) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.evaluate(PAINT_PROBE);
    return page;
  };

  const collect = (page, surface, scope, selector = '.k-state, .k-select, .k-multi') =>
    page.evaluate(({ surface, scope, selector, hueOf }) => [...document.querySelectorAll(scope)].flatMap((root) =>
      [...root.querySelectorAll(selector)].map((chip) => {
        const label = (chip.querySelector('.k-label, .filter-chip-label')?.textContent ?? chip.textContent).trim();
        const hue = hueOf[label];
        return hue ? { where: `${surface} ${label}`, label, hue, got: window.paintOf(chip), want: window.huePaint(hue) } : null;
      }).filter(Boolean)), { surface, scope, selector, hueOf: HUE_OF });

  const expectSurface = (rows, surface, labels) => {
    const seen = new Set(rows.map((r) => r.label));
    const missing = labels.filter((l) => !seen.has(l));
    assert.deepEqual(missing, [], `${surface} rendered a chip for every value`);
    return paintMisses(rows);
  };

  for (const theme of ['light', 'dark']) {
    test(`the grid, its pickers and its filter strip paint what the data names (${theme})`, async () => {
      const page = await appPage(theme, `#/table/${skill.id}`);
      await page.locator('.wv-grid .k-state:visible').first().waitFor();
      const misses = expectSurface(await collect(page, 'grid cell', '.wv-grid'), 'grid cell', Object.keys(HUE_OF));
      await page.locator('.wv-grid tr', { hasText: 'Search skill' }).locator('.k-state:visible').first().click();
      await page.waitForSelector('.picker-pop .picker-row .k');
      misses.push(...expectSurface(await collect(page, 'cell picker row', '.picker-pop'), 'cell picker', STATE_NAMES));
      await page.keyboard.press('Escape');
      await page.waitForSelector('.picker-pop', { state: 'detached' });
      await page.click('.table-filter-btn');
      await page.waitForSelector('.table-filter-popover .filter-chip');
      misses.push(...expectSurface(await collect(page, 'filter chip', '.table-filter-popover', '.filter-chip'), 'filter strip', Object.keys(HUE_OF)));
      assert.deepEqual(misses, []);
      await page.close();
    });

    test(`the Edit field dialog for a saved workflow paints what the data names (${theme})`, async () => {
      const page = await appPage(theme, `#/entity/${ids[0]}`);
      await page.locator('.fieldrow-label', { hasText: 'State' }).first().click();
      await page.waitForSelector('#tray-back .opt-list .opt-preview .k');
      const misses = expectSurface(await collect(page, 'Edit field preview', '#tray-back .opt-list'), 'Edit field preview', STATE_NAMES);
      const swatches = await page.evaluate(() => [...document.querySelectorAll('#tray-back .opt-list .opt-row')].map((r) => ({
        label: r.querySelector('.opt-name').value, swatch: getComputedStyle(r.querySelector('.opt-color')).backgroundColor,
      })));
      for (const sw of swatches) {
        const dot = await page.evaluate((h) => window.huePaint(h).dot, HUE_OF[sw.label]);
        if (sw.swatch !== dot) misses.push(`Edit field swatch ${sw.label}: ${sw.swatch}, want hue-${HUE_OF[sw.label]} dot ${dot}`);
      }
      misses.push(...expectSurface(await collect(page, 'Default face', '#tray-back .choice-default'), 'Default face', ['Active']));
      assert.deepEqual(misses, []);
      await page.close();
    });

    test(`search rows, relation chips and cards paint what the data names (${theme})`, async () => {
      const page = await appPage(theme, `#/table/${plan.id}`);
      await page.waitForFunction((n) => document.querySelectorAll('.wv-grid .k-rel .k-state').length >= n, STATE_NAMES.length);
      const misses = expectSurface(await collect(page, 'relation chip', '.wv-grid .k-rel'), 'relation chip', STATE_NAMES);
      await page.evaluate(async (list) => {
        const host = document.createElement('div');
        host.className = 'card-probe';
        for (const id of list) {
          const v = await (await fetch(`api/entities/${id}/view?shape=card`)).json();
          host.insertAdjacentHTML('beforeend', window.weaveChipView.cardHtml(v));
        }
        document.body.appendChild(host);
      }, ids);
      misses.push(...expectSurface(await collect(page, 'card', '.card-probe'), 'card', STATE_NAMES));
      await page.keyboard.press('ControlOrMeta+k');
      await page.waitForSelector('#cmdk-input');
      await page.fill('#cmdk-input', 'skill');
      await page.waitForFunction(() => document.querySelectorAll('#cmdk-results .result .k-state').length >= 5);
      misses.push(...expectSurface(await collect(page, 'search row', '#cmdk-results'), 'search row', STATE_NAMES));
      assert.deepEqual(misses, []);
      await page.close();
    });

    test(`the phone applet paints the chip.css hue for every value (${theme})`, async () => {
      const engine = await phoneBrowser();
      const ref = await engine.newPage();
      await ref.goto(`${base}/`, { waitUntil: 'networkidle' });
      await ref.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await ref.evaluate(PAINT_PROBE);
      const want = await ref.evaluate((hues) => Object.fromEntries(hues.map((h) => [h, window.huePaint(h)])), core.HUES);
      await ref.close();
      const ctx = await engine.newContext({ ...phoneProfile().page, colorScheme: theme });
      await ctx.request.post(`${base}/t/unlock`, { data: { passcode: PASSCODE } });
      const page = await ctx.newPage();
      await page.goto(`${base}/t`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-row .k');
      const read = (surface, scope) => page.evaluate(({ surface, scope, hueOf }) => [...document.querySelectorAll(`${scope} .k`)].map((chip) => {
        const label = chip.textContent.trim();
        const cs = getComputedStyle(chip);
        return hueOf[label] ? { where: `${surface} ${label}`, label, hue: hueOf[label], got: { fill: cs.backgroundColor, text: cs.color } } : null;
      }).filter(Boolean), { surface, scope, hueOf: HUE_OF });
      const rows = await read('applet row', '.wv-row');
      await page.locator('.wv-row', { hasText: 'Search skill' }).first().tap();
      await page.waitForSelector('.wv-detail.in .wv-vrail .k');
      rows.push(...await read('applet detail', '.wv-detail.in .wv-vrail'));
      const misses = expectSurface(rows.map((r) => ({ ...r, want: want[r.hue] })), 'applet', ['Active', 'Deprecated', 'Gold', 'Core', 'Ops', 'Web']);
      assert.deepEqual(misses, []);
      await ctx.close();
    });
  }
}
