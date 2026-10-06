import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, pulse, row;

const s = await launch('icon vocabulary', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  pulse = weave.createTable({ space: 'Product', name: 'Pulse', icon: 'lucide:activity' });
  weave.createTable({ space: 'Product', name: 'Inbox', icon: 'lucide:bell' });
  weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: [
    { name: 'Urgent', icon: 'iconly:danger' },
    { name: 'Later', icon: '○' },
  ] } });
  weave.addField(tasks, { name: 'Stage', type: 'workflow', config: { states: [
    { name: 'Building', icon: 'lucide:activity', category: 'in-progress', default: true },
    { name: 'Shipped', icon: '✓', category: 'done' },
  ] } });
  row = weave.createEntity(tasks, { name: 'Icon case', values: { Priority: 'Urgent' } }).id;
});
if (s) {
  const { base, browser, weave } = s;
  const entityPage = async () => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    return page;
  };

  test('an option wearing a flat icon draws the icon, not its name', async () => {
    const page = await entityPage();
    const chip = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first();
    assert.doesNotMatch(await chip.textContent(), /iconly:/, 'the stored value leaked into the chip as text');
    assert.equal(await chip.locator('svg').count(), 1, 'the flat icon must draw as an svg');
    await page.close();
  });

  test('a state wearing a flat icon draws it too', async () => {
    const page = await entityPage();
    const chip = page.locator('.entity-fields .fieldrow', { hasText: 'Stage' }).first().locator('.k-state, .k-select').first();
    assert.doesNotMatch(await chip.textContent(), /iconly:/);
    assert.equal(await chip.locator('svg').count(), 1);
    await page.close();
  });

  test('a mark still draws as itself — old rows keep their glyph', async () => {
    const page = await entityPage();
    const picked = await page.evaluate(() => {
      const choices = iconCatalogue();
      return { total: choices.length, marks: choices.filter((c) => c.mark).length, flat: choices.filter((c) => c.lucide).length, set: fieldDialogCore.ICON_INVENTORY.length };
    });
    assert.equal(picked.marks, 18, 'thirteen originals plus the five Kyle accepted');
    assert.equal(picked.flat, picked.set, `the whole inventory is offered, got ${picked.flat} of ${picked.set}`);
    await page.close();
  });

  test('a mark draws as a vector, at the size a flat icon draws', async () => {
    const page = await entityPage();
    const row = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first();
    const box = await page.evaluate(() => {
      var out = {};
      var svgs = [].slice.call(document.querySelectorAll('.wv-icon svg, .ico svg'));
      out.count = svgs.length;
      out.widths = svgs.map(function (s) { return Math.round(parseFloat(getComputedStyle(s).width)); });
      return out;
    });
    assert.ok(box.count >= 2);
    assert.equal(new Set(box.widths).size, 1, `icons drew at ${box.widths.join(', ')}px — one scale means one width`);
    await page.close();
  });

  test('every mark fills its canvas — none of them draws small', async () => {
    const page = await entityPage();
    const bad = await page.evaluate(() => {
      var out = [];
      var marks = window.weaveMarkIcons.MARKS;
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0';
      document.body.appendChild(host);
      Object.keys(marks).forEach(function (k) {
        var sw = /stroke-width="([\d.]+)"/.exec(marks[k]);
        var pad = sw ? Number(sw[1]) / 2 : 0;
        host.innerHTML = '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">' + marks[k] + '</svg>';
        var b = host.firstChild.getBBox();
        var x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.width + pad, y1 = b.y + b.height + pad;
        if (x0 < -0.5 || y0 < -0.5 || x1 > 24.5 || y1 > 24.5) {
          out.push(k + ' overflows: ' + [x0, y0, x1, y1].map(Math.round).join(','));
        }
        var span = Math.max(x1 - x0, y1 - y0);
        if (span < 15) out.push(k + ' spans only ' + Math.round(span) + ' of 24');
      });
      host.remove();
      return out;
    });
    assert.deepEqual(bad, [], 'marks that overflow the canvas, or draw small inside it');
    await page.close();
  });

  test('the vendored set sits inside its canvas at one stroke — no scale table needed', async () => {
    const page = await entityPage();
    const bad = await page.evaluate(() => {
      var out = [], spans = [];
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0';
      document.body.appendChild(host);
      Object.keys(window.LUCIDE_MOVING).forEach(function (n) {
        host.innerHTML = window.LUCIDE_MOVING[n];
        var b = host.firstChild.getBBox();
        var x0 = b.x - 1, y0 = b.y - 1, x1 = b.x + b.width + 1, y1 = b.y + b.height + 1;
        if (x0 < -0.5 || y0 < -0.5 || x1 > 24.5 || y1 > 24.5) out.push(n + ' overflows: ' + [x0, y0, x1, y1].map(Math.round).join(','));
        spans.push(Math.max(x1 - x0, y1 - y0));
      });
      host.remove();
      spans.sort(function (a, b) { return a - b; });
      return { out: out, median: spans[Math.floor(spans.length / 2)], small: spans.filter(function (s) { return s < 15; }).length, n: spans.length };
    });
    assert.deepEqual(bad.out, [], 'icons overflowing the canvas');
    assert.ok(bad.median >= 19, `the set should fill its grid; median long axis ${bad.median} of 24`);
    assert.ok(bad.small / bad.n < 0.05, `${bad.small} of ${bad.n} icons span under 15 of 24`);
    await page.close();
  });

  test('a hidden name still draws when a row already stored it', async () => {
    const id = weave.createEntity(tasks, { name: 'Legacy icon' }).id;
    weave.updateField(tasks, 'Priority', { config: { options: [
      { name: 'Urgent', icon: 'iconly:arrow-upsquare' }, { name: 'Later', icon: '○' },
    ] } });
    weave.updateEntity(id, { Priority: 'Urgent' });
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    const chip = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first();
    assert.equal(await chip.locator('svg').count(), 1, 'hiding a name from the picker must not blank an existing row');
    const offered = await page.evaluate(() => iconCatalogue().some((c) => c.id === 'iconly:arrow-upsquare'));
    assert.equal(offered, false, 'and it must be gone from the offer');
    await page.close();
  });

  test('a legacy iconly: value draws its Lucide twin, and the picker offers the twin once', async () => {
    const page = await entityPage();
    const out = await page.evaluate(() => {
      var o = { drawn: 0, ghosts: 0 };
      ['dollar', 'notification', 'bug', 'arrow-up2', 'ticksquare'].forEach(function (n) {
        var el = iconEl('iconly:' + n);
        if (el.querySelector('svg')) o.drawn++;
        if (el.classList.contains('icon-ghost')) o.ghosts++;
      });
      o.text = iconEl('iconly:notification').textContent.trim();
      o.twin = iconEl('iconly:notification').className;
      var ids = iconCatalogue().map(function (c) { return c.id; });
      o.offered = ids.filter(function (id) { return id === 'lucide:dollar-sign'; }).length;
      o.legacyOffered = ids.filter(function (id) { return /^iconly:/.test(id); }).length;
      return o;
    });
    assert.equal(out.drawn, 5, 'every legacy value still draws');
    assert.equal(out.ghosts, 0);
    assert.equal(out.text, '', 'the prefix never reaches the screen');
    assert.match(out.twin, /mi-bell/, 'notification draws as the bell');
    assert.equal(out.offered, 1, 'the twin is offered once, under its own name');
    assert.equal(out.legacyOffered, 0, 'the old names are aliases, not choices');
    await page.close();
  });

  async function openIconPicker(page) {
    await page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first().click();
    await page.waitForSelector('.chip-pop');
  }

  test('the icon picker is a grid of icons, with no name beside any of them', async () => {
    const page = await entityPage();
    await page.goto(`${base}/#/table/${tasks.id ?? tasks}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.chip-pop');

    assert.ok(await page.locator('.picker-cells').count() > 0, 'the icons must draw as a grid');
    assert.equal(await page.locator('.picker-row').count(), 0, 'no list rows survive in grid mode');
    assert.equal(await page.locator('.picker-num').count(), 0, 'no numbered quick-select');

    const cells = page.locator('.picker-cell');
    assert.ok(await cells.count() > 90, 'the whole catalogue is offered');
    const text = (await cells.allTextContents()).join('');
    assert.doesNotMatch(text, /[a-z0-9]/i, `a cell is carrying a label: ${text.slice(0, 60)}`);
    assert.equal(await cells.nth(1).locator('svg').count(), 1);
    assert.ok(await cells.nth(1).getAttribute('title'), 'a cell must name itself on hover');
    assert.equal(await page.locator('.picker-chip').count(), 0, 'the grid stages no chips');
    assert.equal(await page.locator('.picker-clear').count(), 0, 'no footer clear survives');
    assert.equal(await cells.first().getAttribute('title'), 'No icon', 'clearing leads the grid');
    assert.ok(await cells.first().locator('.icon-ghost').count(), 'and wears the ghost ring');
    assert.equal(await page.locator('.picker-search').getAttribute('placeholder'), 'Search by name or category…');
    await page.close();
  });

  test('category headings label the grid, and search takes a category', async () => {
    const page = await entityPage();
    await page.goto(`${base}/#/table/${tasks.id ?? tasks}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.picker-cells');
    const cats = await page.locator('.picker-cat').allTextContents();
    assert.ok(cats.includes('money'), `categories are the labels, got ${cats.join(', ')}`);

    await page.locator('.picker-search').fill('money');
    await page.waitForTimeout(150);
    assert.deepEqual(await page.locator('.picker-cat').allTextContents(), ['money'],
      'a heading leaves with its icons');
    assert.ok(await page.locator('.picker-cell').count() >= 10, 'the whole money group survives the search');
    await page.close();
  });

  test('clicking a cell commits that icon', async () => {
    const page = await entityPage();
    await page.goto(`${base}/#/table/${tasks.id ?? tasks}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.picker-cells');
    await page.locator('.picker-search').fill('wallet');
    await page.waitForTimeout(150);
    await page.locator('.picker-cell[title="wallet"]').click();
    await page.waitForTimeout(400);
    const db = weave.getTable(typeof tasks === 'string' ? tasks : tasks.id);
    assert.equal(db.icon, 'lucide:wallet');
    await page.close();
  });

  const gridPickerOn = async (page, table) => {
    await page.goto(`${base}/#/table/${table.id ?? table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.picker-cells');
  };

  test('the search bar names the cell under the pointer, and rests on the icon already set', async () => {
    const page = await entityPage();
    await gridPickerOn(page, pulse);
    const readout = page.locator('.picker-name');
    assert.equal(await readout.count(), 1, 'the search bar carries a name readout');
    assert.equal((await readout.textContent()).trim(), 'activity',
      'reopening the picker must say what the current icon is called');

    await page.locator('.picker-cell[title="wallet"]').hover();
    await page.waitForTimeout(120);
    assert.equal((await readout.textContent()).trim(), 'wallet', 'hovering a cell names it in the search bar');

    await page.locator('.picker-title').hover();
    await page.waitForTimeout(120);
    assert.equal((await readout.textContent()).trim(), 'activity', 'the name reverts when the pointer leaves');

    const text = (await page.locator('.picker-cell').allTextContents()).join('');
    assert.doesNotMatch(text, /[a-z0-9]/i, 'the readout must not become a label on every cell');
    await page.close();
  });

  test('the keyboard reads the same name — focus is not a hover', async () => {
    const page = await entityPage();
    await gridPickerOn(page, pulse);
    const readout = page.locator('.picker-name');
    await page.locator('.picker-cell[title="flag"]').hover();
    await page.locator('.picker-search').focus();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    assert.equal((await readout.textContent()).trim(), 'No icon', 'the clear cell names itself on focus');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('title'));
    assert.ok(focused, 'focus landed on a named cell');
    assert.equal((await readout.textContent()).trim(), focused, 'the focused cell is the one named');
    await page.close();
  });

  test('a table with no icon rests on nothing — the readout never says "No icon" at rest', async () => {
    const bare = weave.createTable({ space: 'Product', name: 'Bare' });
    const page = await entityPage();
    await gridPickerOn(page, bare);
    const readout = page.locator('.picker-name');
    assert.equal((await readout.textContent()).trim(), '', 'nothing is set, so nothing is named');
    await page.locator('.picker-cell.picker-none').hover();
    await page.waitForTimeout(120);
    assert.equal((await readout.textContent()).trim(), 'No icon');
    await page.close();
  });

  test('naming the hovered icon never resizes the grid under the pointer', async () => {
    const page = await entityPage();
    await gridPickerOn(page, pulse);
    const pop = page.locator('.picker-pop');
    const rest = (await pop.boundingBox()).width;
    const longest = (await page.locator('.picker-cell').evaluateAll(
      (ns) => ns.map((n) => n.getAttribute('title')).filter(Boolean)))
      .sort((a, b) => b.length - a.length)[0];
    assert.ok(longest.length > 12, 'the grid must hold a label long enough to test with');
    const cell = page.locator(`.picker-cell[title="${longest}"]`);
    const before = await cell.boundingBox();
    await cell.hover();
    await page.waitForTimeout(150);
    assert.equal((await page.locator('.picker-name').textContent()).trim(), longest,
      'the long name is read out, as Issue #142 asks');
    assert.equal((await pop.boundingBox()).width, rest,
      'the popover must stay the same width while the longest name is named');
    const after = await cell.boundingBox();
    assert.deepEqual(
      [Math.round(after.x), Math.round(after.y)],
      [Math.round(before.x), Math.round(before.y)],
      'the hovered cell must not move out from under the pointer');
    const box = await page.locator('.picker-box').boundingBox();
    const name = await page.locator('.picker-name').boundingBox();
    assert.ok(name.x + name.width <= box.x + box.width + 1, 'the readout stays inside the box');
    await page.evaluate(() => document.documentElement.setAttribute('data-bs-theme', 'dark'));
    await page.waitForTimeout(80);
    assert.equal((await pop.boundingBox()).width, rest, 'dark reads the same width');
    await page.close();
  });

  test('a picker that is not the grid stays a token box — no readout in its way', async () => {
    const page = await entityPage();
    await page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first().click();
    await page.waitForSelector('.picker-row');
    const readout = page.locator('.picker-name');
    assert.equal((await readout.textContent().catch(() => '')).trim(), '', 'a list picker names nothing there');
    assert.equal(await readout.evaluate((n) => getComputedStyle(n).display).catch(() => 'none'), 'none',
      'and an empty readout takes no room');
    await page.close();
  });

  test('an icon name that no longer resolves shows a ring, not its own prefix', async () => {
    const page = await entityPage();
    const drawn = await page.evaluate(() => {
      const dead = iconEl('iconly:slides');
      const emoji = iconEl('🎉');
      return {
        deadText: dead.textContent,
        deadTitle: dead.getAttribute('title'),
        deadGhost: dead.classList.contains('icon-ghost'),
        emojiText: emoji ? emoji.textContent : null,
        emojiDrawn: !!emoji,
      };
    });
    assert.doesNotMatch(drawn.deadText, /iconly:/, 'the prefix must never reach the screen');
    assert.equal(drawn.deadGhost, true);
    assert.match(drawn.deadTitle, /slides/, 'the tooltip still names what was set');
    assert.equal(drawn.emojiDrawn, false, 'a bare string is not an icon and draws nothing (Kyle, 2026-09-02)');
    await page.close();
  });

  test('an icon rests lighter than its label and darkens when the row is current', async () => {
    const page = await entityPage();
    const seen = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const nav = document.querySelector('.nav-db .nav-icon') || document.querySelector('.nav-icon');
      const label = document.querySelector('.nav-db') || document.body;
      const ground = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
      const lum = (c) => {
        const p = c.match(/[\d.]+/g).map(Number);
        const a = p.length > 3 ? p[3] : 1;
        const [r, g, b] = [0, 1, 2].map((i) => a * p[i] + (1 - a) * ground[i]);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return {
        token: root.getPropertyValue('--wv-icon-rest').trim(),
        icon: nav ? getComputedStyle(nav).color : null,
        text: getComputedStyle(label).color,
        iconLum: nav ? lum(getComputedStyle(nav).color) : null,
        textLum: lum(getComputedStyle(label).color),
      };
    });
    assert.ok(seen.token, '--wv-icon-rest must be declared');
    assert.ok(seen.icon, 'the nav must draw an icon to measure');
    assert.ok(seen.iconLum > seen.textLum,
      `the icon (${seen.icon}) should rest lighter than its label (${seen.text})`);
    await page.close();
  });

  const playingParts = (sel) => [...document.querySelectorAll(sel)].flatMap((h) => [...h.querySelectorAll('[data-mi]')])
    .filter((p) => p.classList.contains(p.dataset.mi.split(' ')[0])).length;
  const NAV = '#nav .wv-icon.mi:not([data-ms="0"])';
  const recordRuns = (sel) => {
    window.__recorder?.disconnect();
    const hosts = [...document.querySelectorAll(sel)];
    const on = hosts.map(() => false);
    window.__runs = [];
    window.__recorder = new MutationObserver(() => hosts.forEach((h, i) => {
      const now = [...h.querySelectorAll('[data-mi]')].every((p) => p.classList.contains(p.dataset.mi.split(' ')[0]));
      if (now && !on[i]) window.__runs.push(i);
      on[i] = now;
    }));
    for (const h of hosts) window.__recorder.observe(h, { subtree: true, attributes: true, attributeFilter: ['class'] });
  };
  for (const theme of ['light', 'dark']) {
    test(`nothing animates on mount; an icon plays once on its own hover or press, then rests (${theme})`, async () => {
      const page = await browser.newPage();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(NAV);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
      assert.equal(await page.evaluate(playingParts, '.mi'), 0, 'an icon animated on mount');
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(playingParts, '.mi'), 0, 'an icon animated inside the first 500 ms');
      assert.ok(await page.locator(NAV).count() >= 2, 'the nav needs two moving icons to tell "only that one" apart');
      const host = page.locator(NAV).first();
      const ms = Number(await host.getAttribute('data-ms'));
      await page.evaluate(recordRuns, NAV);
      await host.hover();
      await page.waitForTimeout(ms + 100);
      await page.waitForFunction(() => window.__runs.length > 0, null, { timeout: 3000 })
        .catch(() => assert.fail('a hover plays the icon'));
      await page.waitForFunction((sel) => ![...document.querySelector(sel).querySelectorAll('[data-mi]')]
        .some((p) => p.classList.contains(p.dataset.mi.split(' ')[0])), NAV, { timeout: ms + 3000 })
        .catch(() => assert.fail(`after its ${ms} ms run the icon rests — it does not loop`));
      assert.deepEqual(await page.evaluate(() => window.__runs), [0], 'only the hovered icon plays, and only once');
      const second = page.locator(NAV).nth(1);
      const box = await second.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => window.__runs.includes(1), null, { timeout: 3000 })
        .catch(() => assert.fail('pointing at the second icon plays it'));
      await page.waitForFunction((sel) => ![...document.querySelectorAll(sel)[1].querySelectorAll('[data-mi]')]
        .some((p) => p.classList.contains(p.dataset.mi.split(' ')[0])), NAV, { timeout: 5000 });
      await page.evaluate(recordRuns, NAV);
      await page.mouse.down();
      await page.waitForFunction(() => window.__runs.includes(1), null, { timeout: 3000 })
        .catch(() => assert.fail('a press plays the icon'));
      await page.mouse.up();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector(NAV);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(playingParts, '.mi'), 0, 'a reload must not replay the load wave');
      await page.close();
    });
  }
  test('every icon on the page is drawn to the one size scale', async () => {
    const page = await entityPage();
    const sizes = await page.evaluate(() => {
      const scale = ['--wv-icon-sm', '--wv-icon-md', '--wv-icon-lg']
        .map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim())
        .filter(Boolean);
      const drawn = [...document.querySelectorAll('.wv-icon svg, .ico svg')]
        .map((s) => `${Math.round(parseFloat(getComputedStyle(s).width))}px`);
      return { scale, drawn };
    });
    assert.equal(sizes.scale.length, 3, 'the scale must be declared as custom properties');
    assert.ok(sizes.drawn.length > 0, 'the page must actually draw some icons');
    for (const w of sizes.drawn) {
      assert.ok(sizes.scale.includes(w), `an icon drew at ${w}, outside the scale ${sizes.scale.join(' / ')}`);
    }
    await page.close();
  });
}
