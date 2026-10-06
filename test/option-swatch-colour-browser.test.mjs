import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('option swatch colour', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createEntity(tasks, { name: 'Ship it' });
});

if (s) {
  const { base, browser } = s;

  const openTray = async (type, theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.click('.add-field-head .add-field-btn');
    await page.waitForSelector('#tray-back .type-tile');
    await page.click(`#tray-back .type-tile[title="${type}"]`);
    await page.waitForSelector('#tray-back .opt-list');
    return page;
  };

  const swatches = (page) => page.locator('#tray-back .opt-list .opt-color').evaluateAll((els) => {
    const resolve = (v) => {
      const probe = document.createElement('div');
      probe.style.color = String(v).trim();
      document.body.appendChild(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    };
    return els.map((e) => {
      const cs = getComputedStyle(e);
      const dot = cs.getPropertyValue('--dot').trim();
      return {
        hue: (e.className.match(/hue-([a-z]+)/) || [])[1],
        background: cs.backgroundColor,
        image: cs.backgroundImage,
        dot,
        dotAsRgb: dot && dot !== 'transparent' ? resolve(dot) : 'transparent',
      };
    });
  });

  for (const theme of ['light', 'dark']) {
    test(`each option's colour swatch wears that option's colour (${theme})`, async () => {
      const page = await openTray('select', theme);
      for (let i = 0; i < 5; i++) await page.click('#tray-back .opt-add');
      const got = await swatches(page);
      assert.deepEqual(got.map((g) => g.hue), ['blue', 'green', 'amber', 'purple', 'red'],
        'the ramp assigns a hue per option');
      for (const g of got) {
        assert.notEqual(g.dot, '', `hue-${g.hue} carries a --dot`);
        assert.equal(g.background, g.dotAsRgb, `the hue-${g.hue} swatch is painted its own --dot`);
      }
      const named = Object.fromEntries(got.map((g) => [g.hue, g.background]));
      assert.equal(named.red, 'rgb(229, 72, 77)', 'a red option reads red');
      assert.equal(named.blue, 'rgb(71, 105, 235)', 'a blue option reads blue');
      assert.equal(new Set(got.map((g) => g.background)).size, 5, 'five options, five colours');
      await page.close();
    });

    test(`a locked state swatch wears its category's colour, and slate is hatched (${theme})`, async () => {
      const page = await openTray('workflow', theme);
      const got = await swatches(page);
      assert.deepEqual(got.map((g) => g.hue), ['slate', 'blue', 'green', 'red'],
        'the four categories wear their own hues');
      for (const g of got.slice(1)) {
        assert.equal(g.background, g.dotAsRgb, `the locked hue-${g.hue} swatch is painted its own --dot`);
      }
      const slate = got[0];
      assert.match(slate.image, /repeating-linear-gradient/, 'slate is hatched, not a flat grey');
      const pickerNeutral = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'swatch-grid';
        const sw = document.createElement('button');
        sw.className = 'sw neutral';
        host.appendChild(sw);
        document.body.appendChild(host);
        const out = getComputedStyle(sw).backgroundImage;
        host.remove();
        return out;
      });
      assert.equal(slate.image, pickerNeutral, 'the row swatch draws slate the way the colour picker does');
      await page.close();
    });
  }

  test('the swatch and the chip the option produces agree on the colour', async () => {
    const page = await openTray('select', 'light');
    for (let i = 0; i < 5; i++) await page.click('#tray-back .opt-add');
    const pairs = await page.locator('#tray-back .opt-list .opt-row').evaluateAll((rows) => {
      const resolve = (v) => {
        const probe = document.createElement('div');
        probe.style.color = String(v).trim();
        document.body.appendChild(probe);
        const out = getComputedStyle(probe).color;
        probe.remove();
        return out;
      };
      return rows.map((r) => ({
        swatch: getComputedStyle(r.querySelector('.opt-color')).getPropertyValue('--dot').trim(),
        chip: getComputedStyle(r.querySelector('.opt-preview .k')).getPropertyValue('--dot').trim(),
        painted: getComputedStyle(r.querySelector('.opt-color')).backgroundColor,
        chipAsRgb: resolve(getComputedStyle(r.querySelector('.opt-preview .k')).getPropertyValue('--dot')),
      }));
    });
    assert.equal(pairs.length, 5);
    for (const p of pairs) {
      assert.equal(p.swatch, p.chip, 'swatch and chip read the same --dot');
      assert.equal(p.painted, p.chipAsRgb, 'the swatch is painted the colour its own chip carries');
    }
    await page.close();
  });
}
