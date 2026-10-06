import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed } from '../scripts/seed.mjs';
import { launch } from './lib/browser.mjs';

let crm;
const s = await launch('⌘K grouped results', (weave) => {
  weave.state.meta.name = 'demo';
  seed(weave);
  crm = new Weave();
  crm.state.meta.name = 'crm';
  crm.createSpace({ name: 'Sales' });
  const calls = crm.createTable({ space: 'Sales', name: 'Onboarding' });
  crm.createEntity(calls, { name: 'Onboarding call with Acme' });
  const find = (name) => Object.values(weave.state.entities).find((e) => weave.entityName(e) === name);
  return { wizard: find('Design onboarding wizard'), apollo: find('Apollo Launch') };
}, { server: () => ({ workspaces: { crm } }) });

if (s) {
  const { base, browser } = s;

  async function open(theme = 'light') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('weave-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    return { ctx, page };
  }
  async function palette(page, text = null) {
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForSelector('#cmdk-input');
    if (text != null) {
      await page.fill('#cmdk-input', text);
      await page.waitForFunction((t) => document.querySelector('#cmdk-results')?.dataset.query === t, text);
    }
  }
  const groups = (page) => page.$$eval('#cmdk-results [role="group"]', (gs) => gs.map((g) => ({
    label: document.getElementById(g.getAttribute('aria-labelledby'))?.textContent,
    rows: [...g.querySelectorAll('[role="option"] .cmdk-name')].map((n) => n.textContent),
  })));
  const activeName = (page) => page.$eval('#cmdk-results .result.active .cmdk-name', (n) => n.textContent);

  test('an empty palette opens on Recent once two records have been opened', async () => {
    const { ctx, page } = await open();
    await palette(page);
    assert.match(await page.locator('#cmdk-results').innerText(), /Records and tables you open show up here/,
      'with no history the empty palette says what will fill it');
    await page.keyboard.press('Escape');
    await page.goto(`${base}/#/entity/${s.wizard.id}`);
    await page.waitForFunction(() => /Design onboarding wizard/.test(document.querySelector('#main')?.textContent));
    await page.goto(`${base}/#/entity/${s.apollo.id}`);
    await page.waitForFunction(() => /Apollo Launch/.test(document.querySelector('#main')?.textContent));
    await palette(page);
    const g = await groups(page);
    assert.equal(g.length, 1);
    assert.match(g[0].label, /^Recent/);
    assert.deepEqual(g[0].rows.slice(0, 2), ['Apollo Launch', 'Design onboarding wizard'], 'newest first');
    const first = page.locator('#cmdk-results [role="option"]').first();
    assert.equal(await first.locator('.cmdk-where').textContent(), 'Project #1');
    assert.match(await first.locator('.k-state').getAttribute('class'), /cat-in-progress/);
    assert.equal(await first.locator('.k-state').textContent(), 'Building');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.hash.includes(id), s.apollo.id);
    await ctx.close();
  });

  test('typing "onboard" gives one plain line per hit, grouped Records → In documents → Tables', async () => {
    const { ctx, page } = await open();
    await palette(page, 'onboard');
    const g = await groups(page);
    assert.deepEqual(g.map((x) => x.label.replace(/\s*·?\s*\d+$/, '')), ['Records', 'In documents', 'Tables']);
    assert.deepEqual(g.map((x) => x.label.match(/\d+$/)?.[0]), g.map((x) => String(x.rows.length)), 'each header carries its count');
    assert.deepEqual(g[0].rows, ['Design onboarding wizard', 'Onboarding call with Acme']);
    assert.deepEqual(g[1].rows, ['Apollo Launch']);
    assert.deepEqual(g[2].rows, ['Onboarding']);
    const rows = await page.$$eval('#cmdk-results [role="option"]', (rs) => rs.map((r) => ({
      text: r.innerText, height: r.getBoundingClientRect().height,
      marks: [...r.querySelectorAll('.cmdk-name mark')].map((m) => m.textContent.toLowerCase()),
      prose: [...r.querySelectorAll('.cmdk-name, .cmdk-ctx')].map((n) => n.textContent).join(' '),
    })));
    for (const r of rows) {
      assert.equal(r.height, 36, `one 36px line per hit: ${r.text}`);
      assert.doesNotMatch(r.text, /http/, `no permalink in a row: ${r.text}`);
      assert.doesNotMatch(r.prose, /#|\*\*|\]\(|`/, `no markdown in a row: ${r.prose}`);
      assert.ok(r.marks.every((m) => m === 'onboard'), `the match is marked: ${r.marks}`);
    }
    assert.match(rows[2].prose, /Apollo Launch … Tracks the new onboarding flow and billing revamp/,
      'a body match shows the record name and one plain excerpt');
    await ctx.close();
  });

  test('a hit from another workspace carries that workspace as an outlined tag', async () => {
    const { ctx, page } = await open();
    await palette(page, 'onboard');
    const acme = page.locator('#cmdk-results [role="option"]', { hasText: 'Onboarding call with Acme' });
    assert.equal(await acme.locator('.cmdk-ws').textContent(), 'crm');
    const wizard = page.locator('#cmdk-results [role="option"]', { hasText: 'Design onboarding wizard' });
    assert.equal(await wizard.locator('.cmdk-ws').count(), 0, 'a hit at home has no tag');
    assert.equal(await page.locator('#cmdk .cmdk-inp .cmdk-ws').textContent(), 'demo', 'the input row names this workspace');
    assert.equal(await page.getAttribute('#cmdk-input', 'placeholder'), 'Search demo');
    await ctx.close();
  });

  test('↑ ↓ move, Tab jumps to the next group, ↵ opens, Esc closes; the combobox names the selected option', async () => {
    const { ctx, page } = await open();
    await palette(page, 'onboard');
    const input = page.locator('#cmdk-input');
    assert.equal(await input.getAttribute('role'), 'combobox');
    assert.equal(await input.getAttribute('aria-expanded'), 'true');
    assert.equal(await input.getAttribute('aria-controls'), 'cmdk-results');
    assert.equal(await page.getAttribute('#cmdk-results', 'role'), 'listbox');
    const selected = async () => {
      const id = await input.getAttribute('aria-activedescendant');
      return page.$eval(`#${id}`, (o) => ({ name: o.querySelector('.cmdk-name').textContent, sel: o.getAttribute('aria-selected'), active: o.classList.contains('active') }));
    };
    assert.deepEqual(await selected(), { name: 'Design onboarding wizard', sel: 'true', active: true });
    await page.keyboard.press('ArrowDown');
    assert.equal(await activeName(page), 'Onboarding call with Acme');
    await page.keyboard.press('ArrowUp');
    assert.equal(await activeName(page), 'Design onboarding wizard');
    await page.keyboard.press('ArrowUp');
    assert.equal(await activeName(page), 'Onboarding', '↑ from the top wraps to the last row');
    await page.keyboard.press('Tab');
    assert.equal(await activeName(page), 'Design onboarding wizard', 'Tab from the last group wraps to the first');
    await page.keyboard.press('Tab');
    assert.match(await activeName(page), /^Apollo Launch/, 'Tab lands on the first row of the next group');
    assert.equal((await selected()).active, true, 'aria-activedescendant follows the selection');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'cmdk-input', 'Tab never leaves the input');
    const shadow = await page.$eval('#cmdk-results .result.active', (r) => getComputedStyle(r).boxShadow);
    assert.match(shadow, /inset/);
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.hash.includes(id), s.apollo.id);
    assert.equal(await page.locator('#cmdk-back').count(), 0, 'a pick closes the palette');
    await palette(page, 'onboard');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cmdk-back').count(), 0, 'Esc closes');
    await palette(page);
    const keys = await page.$$eval('#cmdk .cmdk-foot kbd', (ks) => ks.map((k) => k.textContent));
    assert.deepEqual(keys, ['↑', '↓', '↵', 'tab', 'esc']);
    await ctx.close();
  });

  test('copy link stays on a hit, shown on the selected row', async () => {
    const { ctx, page } = await open();
    await palette(page, 'onboard');
    const btn = page.locator('#cmdk-results .result.active .copy-btn');
    assert.equal(await btn.getAttribute('title'), 'Copy link');
    assert.equal(await btn.evaluate((b) => getComputedStyle(b).opacity), '1', 'visible on the selected row');
    const idle = page.locator('#cmdk-results .result:not(.active) .copy-btn').first();
    assert.equal(await idle.evaluate((b) => getComputedStyle(b).opacity), '0', 'hidden on a row at rest');
    await ctx.close();
  });

  test('the dark theme draws the palette on the dark tokens', async () => {
    const light = await open('light');
    await palette(light.page, 'onboard');
    const paint = (page) => page.evaluate(() => {
      const box = getComputedStyle(document.querySelector('#cmdk'));
      const where = getComputedStyle(document.querySelector('#cmdk .cmdk-where'));
      return { theme: document.documentElement.dataset.bsTheme, bg: box.backgroundColor, where: where.color };
    });
    const l = await paint(light.page);
    await light.ctx.close();
    const dark = await open('dark');
    await palette(dark.page, 'onboard');
    const d = await paint(dark.page);
    assert.equal(l.theme, 'light');
    assert.equal(d.theme, 'dark');
    assert.equal(l.where, 'rgb(95, 100, 116)', 'muted text is the post-F2 #5f6474 in light');
    assert.notEqual(d.bg, l.bg, 'the dark palette is not the light surface');
    assert.notEqual(d.where, l.where, 'the muted text follows the dark token');
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    assert.ok(lum(d.bg) < 80, `dark surface is dark: ${d.bg}`);
    assert.ok(lum(d.where) > lum(d.bg) + 60, `muted text stays legible on it: ${d.where} on ${d.bg}`);
    await dark.ctx.close();
  });
}
