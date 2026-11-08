import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let target, issue, loner, mixed, aside, quiet;

const s = await launch('reference panels', (weave) => {
  weave.createSpace({ name: 'Dev' });
  weave.createTable({ space: 'Dev', name: 'Task' });
  weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.createTable({ space: 'Dev', name: 'Note' });
  for (const t of ['Task', 'Issue']) weave.updateTable(t, { referencePanels: ['References', 'Referenced by'] });
  target = weave.createEntity('Task', { name: 'Ship the editor' });
  issue = weave.createEntity('Issue', { name: 'Editor loses focus', doc: 'blocks [[Task#1]] until fixed' });
  loner = weave.createEntity('Issue', { name: 'Nobody mentions me' });
  aside = weave.createEntity('Task', { name: 'Aside' });
  quiet = weave.createEntity('Note', { name: 'Quiet note', doc: `see [[Task#${aside.publicId}]]` });
  mixed = weave.createEntity('Issue', {
    name: 'Points across workspaces',
    doc: [
      `blocks [[Task#${aside.publicId}]]`,
      '[#1075 PR CI picks browser tests by file name](https://weave.grunion.ai/w/weave/e/78d5e9de-1111-4222-8333-944455556666)',
      'and https://net.weave.grunion.ai/e/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    ].join('\n'),
  });
});
if (s) {
  const { base, browser, weave } = s;
  const open = async (id, { colorScheme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    page.refRequests = [];
    page.on('request', (r) => { if (/\/references(-from)?$/.test(r.url())) page.refRequests.push(r.url()); });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
    return page;
  };
  const card = (page, sel) => page.waitForSelector(sel, { state: 'attached' });
  const panelTitles = (page) => page.$$eval('.entity-side > .card.panel', (ns) =>
    ns.map((n) => n.querySelector('.card-title')?.textContent));
  const chipStyle = (page, sel) => page.$eval(`${sel} .k.k-rel`, (chip) => {
    const cs = getComputedStyle(chip);
    const a = chip.querySelector('a');
    return {
      tag: chip.tagName,
      classes: [...chip.classList],
      borderWidth: cs.borderTopWidth,
      borderStyle: cs.borderTopStyle,
      borderColor: cs.borderTopColor,
      background: cs.backgroundColor,
      color: cs.color,
      href: a.getAttribute('href'),
      label: chip.querySelector('.k-label').textContent,
      home: chip.querySelector('.k-home')?.textContent,
      mark: getComputedStyle(a, '::after').content,
      unlink: !!chip.querySelector('.x'),
    };
  });

  test('references load with the record and open the side column, with no Activity switch (Feature #315)', async () => {
    const page = await open(issue.id);
    await card(page, '.ref-outbound-card');
    assert.ok(await page.$eval('.entity-grid', (g) => g.classList.contains('side-open')), 'the column is open');
    assert.equal(await page.isVisible('.ref-outbound-card'), true, 'and the panel shows in it');
    assert.equal(await page.$eval('.ref-outbound-card', (n) => n.parentElement.className), 'entity-side',
      'the panel is in the side column, never the body');
    assert.deepEqual(await panelTitles(page), ['References · 1'],
      'what this points at; no Comments card (Feature #323) and no Activity card');
    assert.deepEqual(page.refRequests.map((u) => u.split('/').pop()).sort(), ['references', 'references-from'],
      'both directions are fetched with the record');
    await page.close();
  });

  test('permalinks into another workspace count in References and render as workspace-tagged links (Issue #1478)', async () => {
    const page = await open(mixed.id);
    await card(page, '.ref-outbound-card');
    assert.deepEqual(await panelTitles(page), ['References · 3'], 'one local ref plus two cross-workspace links');
    const far = await page.$$eval('.ref-outbound-card .k-external', (ns) => ns.map((n) => ({
      home: n.querySelector('.k-home')?.textContent,
      label: n.querySelector('.k-label')?.textContent,
      href: n.querySelector('a')?.getAttribute('href'),
      target: n.querySelector('a')?.getAttribute('target'),
    })));
    assert.deepEqual(far, [
      { home: 'weave', label: '#1075 PR CI picks browser tests by file name', href: 'https://weave.grunion.ai/w/weave/e/78d5e9de-1111-4222-8333-944455556666', target: '_blank' },
      { home: 'net', label: '#0a1b2c3d', href: 'https://net.weave.grunion.ai/e/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d', target: '_blank' },
    ], 'each far link is a plain link tagged with its workspace, labelled by its link text');
    await page.close();
  });

  test('the inbound panel mirrors it on the target', async () => {
    const page = await open(target.id);
    await card(page, '.ref-inbound-card');
    assert.deepEqual(await panelTitles(page), ['Referenced by · 1']);
    assert.equal(await page.$('.ref-outbound-card'), null, 'a direction with nothing to say is absent');
    const chip = await chipStyle(page, '.ref-inbound-card');
    assert.equal(chip.href, `#/entity/${issue.id}`, 'the chip points back at the mentioning entity');
    assert.equal(chip.label, 'Editor loses focus');
    assert.equal(chip.home, 'Issue', 'the k-home badge names the home table, short form');
    await page.close();
  });

  test('an entity nobody mentions, mentioning nobody, with no comments, keeps the side column closed', async () => {
    const page = await open(loner.id);
    await page.waitForSelector('.entity-grid:not(.side-open)');
    assert.equal(await page.$('.ref-backlinks-card'), null, 'no empty reference panel');
    assert.equal(await page.isVisible('.entity-side'), false, 'the side column is gone, not blank');
    await page.close();
  });

  test('a table that never turned the panels on draws no reference card and keeps the side column closed (Issue #1479)', async () => {
    const page = await open(quiet.id);
    await page.waitForSelector('.entity-grid:not(.side-open)');
    assert.equal(await page.$('.ref-backlinks-card'), null, 'the record has a reference, but no card draws for it');
    assert.equal(await page.isVisible('.entity-side'), false, 'and the side column stays shut');
    await page.close();
  });

  test('References turns on in the record eye, shows its count and survives a reload (Issue #1479)', async () => {
    const page = await open(quiet.id);
    const panelBox = (name) => `.chip-pop [data-ref-panel="${name}"] input`;
    await page.click('#main .eye-btn');
    await page.waitForSelector(panelBox('References'));
    assert.equal(await page.isChecked(panelBox('References')), false, 'off by default');
    assert.equal(await page.isChecked(panelBox('Referenced by')), false, 'both of them');
    await page.click(panelBox('References'));
    await card(page, '.ref-outbound-card');
    assert.deepEqual(await panelTitles(page), ['References · 1']);
    assert.ok(await page.$eval('.entity-grid', (g) => g.classList.contains('side-open')), 'the side column opens for it');
    assert.deepEqual(weave.findTable('Note').referencePanels, ['References'], 'stored on the table, like field visibility');
    await page.reload({ waitUntil: 'load' });
    await card(page, '.ref-outbound-card');
    assert.deepEqual(await panelTitles(page), ['References · 1'], 'the choice survives a reload');
    await page.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the reference chip is the pointer-tier k k-rel chip in ${colorScheme}`, async () => {
      const page = await open(issue.id, { colorScheme });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      await card(page, '.ref-outbound-card');
      const chip = await chipStyle(page, '.ref-outbound-card');
      assert.equal(chip.tag, 'SPAN');
      assert.deepEqual(chip.classes.slice(0, 3), ['k', 'k-rel', 'kind-entity'], 'exactly the relation chip — no bespoke reference class');
      assert.equal(chip.borderWidth, '1px', 'pointer tier: a 1px outline');
      assert.equal(chip.borderStyle, 'solid');
      assert.notEqual(chip.borderColor, 'rgba(0, 0, 0, 0)', `the outline is visible in ${colorScheme}`);
      assert.equal(chip.background, 'rgba(0, 0, 0, 0)', 'pointer tier: no fill');
      assert.notEqual(chip.color, 'rgba(0, 0, 0, 0)', `the label is visible in ${colorScheme}`);
      assert.equal(chip.href, `#/entity/${target.id}`, 'the chip is the link');
      assert.equal(chip.label, 'Ship the editor');
      assert.equal(chip.home, 'Task', 'the k-home badge names the home table');
      assert.equal(chip.mark, 'none', 'Feature #185 dropped the open mark: the chip is the link');
      assert.equal(chip.unlink, false, 'no ×: a reference is text, there is nothing to unlink');
      await page.close();
    });
  }

  test('light and dark paint the chip differently, so neither theme is the other one unthemed', async () => {
    const paint = async (colorScheme) => {
      const page = await open(issue.id, { colorScheme });
      await card(page, '.ref-outbound-card');
      const chip = await chipStyle(page, '.ref-outbound-card');
      await page.close();
      return chip;
    };
    const a = await paint('light');
    const b = await paint('dark');
    assert.notEqual(a.color, b.color, 'body colour follows the theme');
    assert.notEqual(a.borderColor, b.borderColor, 'and so does the outline');
  });
}
