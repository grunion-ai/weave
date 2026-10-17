import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { PAINT_PROBE, paintMisses } from './lib/chip-paint.mjs';

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

  const pickHue = async (page, i, hue) => {
    const row = page.locator('#tray-back .opt-list .opt-row').nth(i);
    await row.locator('.opt-color').click();
    await page.waitForSelector('.chip-pop .swatch-grid');
    await page.click(`.chip-pop .swatch-grid .sw.hue-${hue}`);
    await row.locator(`.opt-color.hue-${hue}`).waitFor();
    await page.click('#tray-back input[name="name"]');
    await page.waitForSelector('.chip-pop', { state: 'detached' });
  };

  const rowPaint = (page) => page.evaluate(() => [...document.querySelectorAll('#tray-back .opt-list .opt-row')].map((r) => ({
    name: r.querySelector('.opt-name').value,
    swatch: getComputedStyle(r.querySelector('.opt-color')).backgroundColor,
    chip: window.paintOf(r.querySelector('.opt-preview .k')),
  })));

  const AGREEMENT = {
    select: { rows: 5, picks: [[0, 'teal']], want: ['teal', 'green', 'amber', 'purple', 'red'] },
    multiselect: { rows: 5, picks: [[0, 'teal']], want: ['teal', 'green', 'amber', 'purple', 'red'] },
    workflow: { rows: 0, picks: [[1, 'green'], [2, 'amber']], want: ['slate', 'green', 'amber', 'red'] },
  };

  for (const theme of ['light', 'dark']) {
    for (const [type, plan] of Object.entries(AGREEMENT)) {
      test(`the swatch, the preview chip and the Default chip paint the colour the ${type} data names (${theme})`, async () => {
        const page = await openTray(type, theme);
        await page.evaluate(PAINT_PROBE);
        for (let i = 0; i < plan.rows; i++) {
          await page.click('#tray-back .opt-add');
          await page.locator('#tray-back .opt-name').last().fill(`Option ${i + 1}`);
        }
        for (const [i, hue] of plan.picks) await pickHue(page, i, hue);
        const rows = await rowPaint(page);
        assert.equal(rows.length, plan.want.length);
        const want = await page.evaluate((hues) => hues.map((h) => window.huePaint(h)), plan.want);
        const misses = [];
        rows.forEach((r, i) => {
          const hue = plan.want[i];
          if (r.swatch !== want[i].dot) misses.push(`${type} row ${i} swatch ${r.swatch}, want hue-${hue} dot ${want[i].dot}`);
        });
        misses.push(...paintMisses(rows.map((r, i) => ({ where: `${type} row ${i} preview chip`, hue: plan.want[i], got: r.chip, want: want[i] }))));
        const target = plan.picks[0][0];
        await page.click('#tray-back .choice-default');
        await page.waitForSelector('.picker-pop');
        const listed = await page.evaluate((name) => {
          const row = [...document.querySelectorAll('.picker-pop .picker-list .picker-row')]
            .find((x) => x.textContent.trim().includes(name));
          const chip = row?.querySelector('.k');
          return chip ? window.paintOf(chip) : null;
        }, rows[target].name);
        if (!listed) misses.push(`${type} Default picker lists no chip for ${rows[target].name}`);
        else misses.push(...paintMisses([{ where: `${type} Default picker row`, hue: plan.want[target], got: listed, want: want[target] }]));
        await page.locator('.picker-pop .picker-list').getByText(rows[target].name, { exact: true }).first().click();
        if (type === 'multiselect') await page.click('.picker-pop .picker-done');
        await page.locator('#tray-back .choice-default .k').first().waitFor();
        const face = await page.evaluate(() => window.paintOf(document.querySelector('#tray-back .choice-default .k')));
        misses.push(...paintMisses([{ where: `${type} Default face`, hue: plan.want[target], got: face, want: want[target] }]));
        assert.deepEqual(misses, [], 'every dialog surface paints what the data names');
        await page.close();
      });
    }
  }
}
