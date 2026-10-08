import assert from 'node:assert/strict';
import { eventually } from './browser.mjs';

export function seedReorder(weave) {
  weave.createSpace({ name: 'Drag' });
  const grid = weave.createTable({ space: 'Drag', name: 'Grid' });
  for (const name of ['Ant', 'Bee', 'Cat']) weave.addField(grid, { name, type: 'number' });
  weave.createEntity(grid, { name: 'Row', values: { Ant: 1, Bee: 2, Cat: 3 } });

  const eye = weave.createTable({ space: 'Drag', name: 'Eye' });
  for (const name of ['Owner', 'Stage', 'Amount']) weave.addField(eye, { name, type: 'text' });
  weave.createEntity(eye, { name: 'Row' });

  const tall = weave.createTable({ space: 'Drag', name: 'Tall' });
  for (let i = 1; i <= 24; i++) weave.addField(tall, { name: `Field ${String(i).padStart(2, '0')}`, type: 'text' });
  weave.createEntity(tall, { name: 'Row' });

  const tabs = weave.createTable({ space: 'Drag', name: 'Tabs' });
  weave.createEntity(tabs, { name: 'Row' });

  const pick = weave.createTable({ space: 'Drag', name: 'Pick' });
  for (const name of ['Size', 'Tier']) weave.addField(pick, { name, type: 'select', config: { options: [{ name: 'S' }, { name: 'M' }] } });
  for (const name of ['One', 'Two']) weave.createEntity(pick, { name, values: { Size: 'S', Tier: 'M' } });

  const card = weave.createTable({ space: 'Drag', name: 'Card' });
  for (const name of ['Vendor', 'Batch', 'Stage']) weave.addField(card, { name, type: 'text' });
  weave.addField(card, { name: 'Brief', type: 'document' });
  weave.addField(card, { name: 'Notes', type: 'document' });
  const cardId = weave.createEntity(card, { name: 'Sensor', values: { Vendor: 'v', Batch: 'b', Stage: 's' } }).id;

  const todo = weave.createTable({ space: 'Drag', name: 'Todo' });
  for (const name of ['Alpha', 'Bravo', 'Charlie']) weave.createEntity(todo, { name });

  const flow = weave.createTable({ space: 'Drag', name: 'Flow' });
  weave.addField(flow, { name: 'Status', type: 'workflow' });
  weave.addField(flow, { name: 'Color', type: 'select', config: { options: [{ name: 'Red' }, { name: 'Green' }, { name: 'Blue' }] } });
  const flowId = weave.createEntity(flow, { name: 'Row' }).id;

  return { grid, eye, tall, tabs, pick, card, cardId, todo, flow, flowId };
}

const firstView = (weave, db) => weave.tableView(db).views[0];
const viewRef = (weave, db) => `${db.id}/${firstView(weave, db).id}`;

export const quiet = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 10000 });

const listKeys = (page, container, item, key) => page.evaluate(([c, i, k]) => {
  const box = document.querySelector(c);
  if (!box) return null;
  return [...box.querySelectorAll(i)].filter((n) => n.getClientRects().length && !n.closest('.wv-reorder-lift')).map((n) => {
    const name = k === 'value' ? n.querySelector('.opt-name')?.value : k === 'text' ? n.querySelector('.list-title')?.textContent.trim() : n.dataset[k];
    return n.classList.contains('wv-reorder-slot') ? `[${name}]` : name;
  });
}, [container, item, key]);

const columnKeys = (page) => page.evaluate(() => {
  const heads = [...document.querySelectorAll('.wv-grid thead th.col-head:not(.wv-reorder-lift)')];
  const slot = document.querySelector('.wv-reorder-slot')?.getBoundingClientRect();
  return heads.map((h) => ({ h, r: h.getBoundingClientRect() }))
    .sort((a, b) => a.r.left - b.r.left)
    .map(({ h, r }) => {
      const name = h.querySelector('.col-label').textContent.trim().replace(/ [↑↓]$/, '');
      const covered = slot && slot.left < r.left + r.width / 2 && slot.right > r.left + r.width / 2;
      return covered ? `[${name}]` : name;
    });
});

const optRow = (page, i) => page.locator('#tray-back .opt-list .opt-row').nth(i);
const optIndex = (page, key) => page.evaluate((k) => [...document.querySelectorAll('#tray-back .opt-list .opt-row')]
  .findIndex((r) => r.querySelector('.opt-name')?.value === k), key);

async function fieldTray(page, base, entityId, field) {
  await page.goto(`${base}/#/entity/${entityId}`, { waitUntil: 'networkidle' });
  await page.click(`.entity-values .fieldrow[data-field="${field}"] .fieldrow-label`);
  await page.waitForSelector('#tray-back .opt-list .opt-row');
  await quiet(page);
}

async function tool(page, button) {
  if (await page.locator('.table-tools-btn').isVisible()) {
    await page.click('.table-tools-btn');
    await page.locator(button).waitFor({ state: 'visible' });
  }
  await page.click(button);
}

export function surfaces({ weave, base, ids }) {
  const { grid, eye, tabs, pick, card, cardId, todo, flowId } = ids;
  return [
    {
      name: 'grid column headers',
      axis: 'x',
      phone: { viewport: { width: 852, height: 393 } },
      reset: () => weave.tableView(viewRef(weave, grid), { fields: ['Ant', 'Bee', 'Cat', 'Name'] }),
      open: async (page) => {
        await page.goto(`${base}/#/table/${grid.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
      },
      handle: (page, key) => page.locator('.wv-grid thead th.col-head', { has: page.locator(`.col-label:text-is("${key}")`) }).first(),
      target: (page, key) => page.locator('.wv-grid thead th.col-head', { has: page.locator(`.col-label:text-is("${key}")`) }).first(),
      keys: (page) => columnKeys(page),
      saved: () => firstView(weave, grid).fields.filter((n) => ['Ant', 'Bee', 'Cat', 'Name'].includes(n)),
      start: ['Ant', 'Bee', 'Cat', 'Name'],
      move: { from: 'Cat', onto: 'Ant', side: 'before' },
      midway: ['[Cat]', 'Ant', 'Bee', 'Name'],
      after: ['Cat', 'Ant', 'Bee', 'Name'],
      cancel: { from: 'Bee', onto: 'Cat', side: 'before' },
    },
    {
      name: 'Fields popover',
      axis: 'y',
      reset: () => weave.tableView(viewRef(weave, eye), { fields: ['Name', 'Owner', 'Stage', 'Amount'] }),
      open: async (page) => {
        await page.goto(`${base}/#/table/${eye.id}`, { waitUntil: 'networkidle' });
        await tool(page, '.eye-btn');
        await page.waitForSelector('.table-fields-popover .table-field-row');
        await quiet(page);
      },
      handle: (page, key) => page.locator(`.table-field-row[data-field="${key}"] .field-reorder-handle`),
      target: (page, key) => page.locator(`.table-field-row[data-field="${key}"]`),
      keys: async (page) => (await listKeys(page, '.table-field-list', '.table-field-row', 'field')).slice(0, 4),
      saved: () => firstView(weave, eye).fields.filter((n) => ['Name', 'Owner', 'Stage', 'Amount'].includes(n)),
      start: ['Name', 'Owner', 'Stage', 'Amount'],
      move: { from: 'Amount', onto: 'Name', side: 'before' },
      midway: ['[Amount]', 'Name', 'Owner', 'Stage'],
      after: ['Amount', 'Name', 'Owner', 'Stage'],
      cancel: { from: 'Owner', onto: 'Stage', side: 'after' },
    },
    {
      name: 'view tabs',
      axis: 'y',
      reset: () => {
        for (const v of weave.tableView(tabs).views.slice(1)) weave.tableView(`${tabs.id}/${v.id}`, { delete: true });
        weave.tableView(`${tabs.id}/Beta`, { from: 'blank' });
        weave.tableView(`${tabs.id}/Gamma`, { from: 'blank' });
      },
      open: async (page) => {
        await page.goto(`${base}/#/table/${tabs.id}`, { waitUntil: 'networkidle' });
        await tool(page, '.table-view-btn');
        await page.waitForSelector('.view-strip .view-row');
        await quiet(page);
      },
      handle: (page, key) => page.locator(`.view-strip .view-row:has(.view-name:text-is("${key}")) .view-grip`),
      target: (page, key) => page.locator(`.view-strip .view-row:has(.view-name:text-is("${key}"))`),
      keys: (page) => page.evaluate(() => [...document.querySelectorAll('.view-strip .view-row')].filter((n) => n.getClientRects().length && !n.closest('.wv-reorder-lift'))
        .map((n) => { const t = n.querySelector('.view-name').textContent.trim(); return n.classList.contains('wv-reorder-slot') ? `[${t}]` : t; })),
      saved: () => weave.tableView(tabs).views.map((v) => v.name),
      get start() { return [firstView(weave, tabs).name, 'Beta', 'Gamma']; },
      move: { from: 'Gamma', onto: 'Beta', side: 'before' },
      get midway() { return [firstView(weave, tabs).name, '[Gamma]', 'Beta']; },
      get after() { return [weave.tableView(tabs).views.find((v) => !['Beta', 'Gamma'].includes(v.name)).name, 'Gamma', 'Beta']; },
      cancel: { from: 'Beta', onto: 'Gamma', side: 'before' },
    },
    {
      name: 'group levels',
      axis: 'y',
      reset: () => weave.tableView(viewRef(weave, pick), { layout: 'list', group: [{ field: 'Size' }, { field: 'Tier' }] }),
      open: async (page) => {
        await page.goto(`${base}/#/table/${pick.id}`, { waitUntil: 'networkidle' });
        await tool(page, '.table-group-btn');
        await page.waitForSelector('.table-group-popover .group-level');
        await quiet(page);
      },
      handle: (page, key) => page.locator(`.group-level[data-level="${key}"] .group-grip`),
      target: (page, key) => page.locator(`.group-level[data-level="${key}"]`),
      keys: (page) => listKeys(page, '.group-levels', '.group-level', 'level'),
      saved: () => (firstView(weave, pick).group ?? []).map((l) => l.field ?? l),
      start: ['Size', 'Tier'],
      move: { from: 'Tier', onto: 'Size', side: 'before' },
      midway: ['[Tier]', 'Size'],
      after: ['Tier', 'Size'],
      cancel: { from: 'Size', onto: 'Tier', side: 'before' },
    },
    {
      name: 'workflow state list',
      axis: 'y',
      reset: () => {},
      open: (page) => fieldTray(page, base, flowId, 'Status'),
      handle: async (page, key) => optRow(page, await optIndex(page, key)).locator('.opt-grip'),
      target: async (page, key) => optRow(page, await optIndex(page, key)),
      keys: (page) => listKeys(page, '#tray-back .opt-list', '.opt-row', 'value'),
      saved: null,
      start: null,
      move: 'last-before-first',
      cancel: 'first-after-second',
    },
    {
      name: 'select option list',
      axis: 'y',
      reset: () => {},
      open: (page) => fieldTray(page, base, flowId, 'Color'),
      handle: async (page, key) => optRow(page, await optIndex(page, key)).locator('.opt-grip'),
      target: async (page, key) => optRow(page, await optIndex(page, key)),
      keys: (page) => listKeys(page, '#tray-back .opt-list', '.opt-row', 'value'),
      saved: null,
      start: ['Red', 'Green', 'Blue'],
      move: { from: 'Blue', onto: 'Red', side: 'before' },
      midway: ['[Blue]', 'Red', 'Green'],
      after: ['Blue', 'Red', 'Green'],
      cancel: { from: 'Red', onto: 'Green', side: 'after' },
    },
    {
      name: 'entity page field list',
      axis: 'y',
      reset: () => {
        const t = weave.getTable(card.id);
        const names = t.fieldOrder.map((id) => t.fields[id].name);
        const rest = names.filter((n) => !['Vendor', 'Batch', 'Stage'].includes(n));
        const at = rest.indexOf('Name') + 1;
        weave.updateTable(card.id, { fieldOrder: [...rest.slice(0, at), 'Vendor', 'Batch', 'Stage', ...rest.slice(at)] });
      },
      open: async (page) => {
        await page.goto(`${base}/#/entity/${cardId}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.entity-values .fieldrow[data-field="Stage"]');
      },
      handle: (page, key) => page.locator(`.entity-values .fieldrow[data-field="${key}"] .opt-grip`),
      target: (page, key) => page.locator(`.entity-values .fieldrow[data-field="${key}"]`),
      keys: async (page) => (await listKeys(page, '.entity-values', '.fieldrow', 'field')).filter((k) => /Vendor|Batch|Stage/.test(k)),
      saved: () => { const t = weave.getTable(card.id); return t.fieldOrder.map((id) => t.fields[id].name).filter((n) => ['Vendor', 'Batch', 'Stage'].includes(n)); },
      start: ['Vendor', 'Batch', 'Stage'],
      move: { from: 'Stage', onto: 'Vendor', side: 'before' },
      midway: ['[Stage]', 'Vendor', 'Batch'],
      after: ['Stage', 'Vendor', 'Batch'],
      cancel: { from: 'Vendor', onto: 'Batch', side: 'after' },
    },
    {
      name: 'entity page blocks',
      axis: 'y',
      reset: () => weave.updateTable(card.id, { bodyOrder: ['@values', 'Brief', 'Notes'] }),
      open: async (page) => {
        await page.goto(`${base}/#/entity/${cardId}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.entity-body > [data-block="Notes"]');
      },
      handle: (page, key) => page.locator(`.entity-body > [data-block="${key}"] :is(.doc-section-name, .block-name)`).first(),
      target: (page, key) => page.locator(`.entity-body > [data-block="${key}"]`),
      keys: async (page) => (await listKeys(page, '.entity-body', ':scope > [data-block]', 'block')).filter((k) => /@values|Brief|Notes/.test(k)),
      saved: () => weave.bodyBlocks(card).filter((k) => ['@values', 'Brief', 'Notes'].includes(k)),
      start: ['@values', 'Brief', 'Notes'],
      move: { from: 'Notes', onto: 'Brief', side: 'before' },
      midway: ['@values', '[Notes]', 'Brief'],
      after: ['@values', 'Notes', 'Brief'],
      cancel: { from: 'Brief', onto: '@values', side: 'before' },
    },
    {
      name: 'list view rows',
      axis: 'y',
      reset: () => weave.tableView(viewRef(weave, todo), { layout: 'list', group: [], sort: [], order: null }),
      open: async (page) => {
        await page.goto(`${base}/#/table/${todo.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-list .list-row');
      },
      handle: (page, key) => page.locator(`.wv-list .list-row:has(.list-title:text-is("${key}")) .list-grip`),
      target: (page, key) => page.locator(`.wv-list .list-row:has(.list-title:text-is("${key}"))`),
      keys: (page) => listKeys(page, '.wv-list', '.list-row', 'text'),
      saved: () => {
        const order = firstView(weave, todo).order ?? [];
        const byPid = new Map(weave.listEntities(todo.id).map((e) => [e.publicId, weave.readEntity(e.id).name]));
        return order.map((p) => byPid.get(p)).filter(Boolean);
      },
      start: ['Alpha', 'Bravo', 'Charlie'],
      move: { from: 'Charlie', onto: 'Alpha', side: 'before' },
      midway: ['[Charlie]', 'Alpha', 'Bravo'],
      after: ['Charlie', 'Alpha', 'Bravo'],
      cancel: { from: 'Alpha', onto: 'Bravo', side: 'after' },
    },
  ];
}

export function pointer(page, { touch = false } = {}) {
  let at = null;
  const send = (type, p) => page.evaluate(([t, x, y]) => {
    const node = document.elementFromPoint(x, y) ?? document.body;
    node.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, button: t === 'pointermove' ? -1 : 0, buttons: t === 'pointerup' ? 0 : 1, width: 20, height: 20, pressure: t === 'pointerup' ? 0 : 0.5,
    }));
  }, [type, p.x, p.y]);
  return {
    touch,
    async press(p) {
      at = p;
      if (!touch) { await page.mouse.move(p.x, p.y); await page.mouse.down(); return; }
      await send('pointerdown', p);
    },
    async hold() {
      if (touch) await page.waitForSelector('.wv-reorder-lift', { timeout: 3000 });
    },
    async nudge() {
      const p = { x: at.x + 2, y: at.y + 6 };
      if (!touch) { await page.mouse.move(p.x, p.y, { steps: 2 }); at = p; return; }
      await send('pointermove', p);
      at = p;
    },
    async to(p, steps = 6) {
      if (!touch) { await page.mouse.move(p.x, p.y, { steps }); at = p; return; }
      for (let k = 1; k <= steps; k++) await send('pointermove', { x: at.x + ((p.x - at.x) * k) / steps, y: at.y + ((p.y - at.y) * k) / steps });
      at = p;
    },
    async release() {
      if (!touch) { await page.mouse.up(); return; }
      await send('pointerup', at);
    },
  };
}

export async function centre(locator) {
  await locator.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await locator.page().waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running'), null, { timeout: 5000 }).catch(() => {});
  const b = await locator.boundingBox();
  assert.ok(b, 'the element is on screen');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function aimAt(locator, side, axis) {
  const b = await locator.boundingBox();
  assert.ok(b, 'the drop target is on screen');
  if (axis === 'x') return { x: b.x + b.width * (side === 'before' ? 0.2 : 0.8), y: b.y + b.height / 2 };
  return { x: b.x + Math.min(40, b.width / 2), y: b.y + b.height * (side === 'before' ? 0.2 : 0.8) };
}

async function bring(page, hand, target) {
  const handle = await target.elementHandle();
  for (let k = 0; k < 60; k++) {
    const edge = await handle.evaluate((n) => {
      let sc = n.parentElement;
      while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const r = n.getBoundingClientRect();
      const box = sc && sc !== document.scrollingElement ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, width: innerWidth };
      if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1) return null;
      return { x: box.left + Math.min(40, box.width / 2), y: r.top < box.top ? box.top + 3 : box.bottom - 3 };
    });
    if (!edge) return;
    await hand.to(edge, 2);
    await page.waitForTimeout(80);
  }
}

async function resolveMove(page, s, spec) {
  if (typeof spec === 'object') return spec;
  const names = (await s.keys(page)).map((k) => k.replace(/^\[|\]$/g, ''));
  if (spec === 'last-before-first') return { from: names[names.length - 1], onto: names[0], side: 'before' };
  return { from: names[0], onto: names[1], side: 'after' };
}

const moved = (list, from, onto, side) => {
  const rest = list.filter((k) => k !== from);
  const at = rest.indexOf(onto) + (side === 'after' ? 1 : 0);
  rest.splice(at, 0, from);
  return rest;
};

export async function exerciseSurface(page, s, { touch = false } = {}) {
  const hand = pointer(page, { touch });
  await s.open(page);
  const start = s.start ?? (await s.keys(page));
  assert.deepEqual(await s.keys(page), start, `${s.name}: the starting order`);

  const m = await resolveMove(page, s, s.move);
  const want = s.after ?? moved(start, m.from, m.onto, m.side);
  const midway = s.midway ?? want.map((k) => (k === m.from ? `[${k}]` : k));
  await hand.press(await centre(await s.handle(page, m.from)));
  if (touch) {
    assert.equal(await page.locator('.wv-reorder-lift').count(), 0, `${s.name}: a touch does not lift before the long press`);
    await hand.hold();
  } else await hand.nudge();
  assert.equal(await page.locator('.wv-reorder-lift').count(), 1, `${s.name}: the pickup lifts a copy of the item`);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-reordering')), true, `${s.name}: the page knows a reorder is under way`);
  await bring(page, hand, await s.target(page, m.onto));
  await hand.to(await aimAt(await s.target(page, m.onto), m.side, s.axis));
  await quiet(page);
  assert.equal(await page.locator('.wv-reorder-slot').count(), 1, `${s.name}: one placeholder opens`);
  assert.deepEqual(await s.keys(page), midway, `${s.name}: the placeholder sits in the landing slot`);
  assert.equal(await page.locator('.drop-line, .drop-slot, .wv-col-insert, .drop-target').count(), 0, `${s.name}: no bare insertion line or swap tint`);
  await hand.release();
  if (s.saved) assert.deepEqual(await eventually(() => s.saved(), want), want, `${s.name}: the drop saves the new order`);
  await page.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'), null, { timeout: 5000 });
  assert.deepEqual(await eventually(() => s.keys(page), want), want, `${s.name}: the item lands where the placeholder was`);

  const c = await resolveMove(page, s, s.cancel);
  await hand.press(await centre(await s.handle(page, c.from)));
  if (touch) await hand.hold(); else await hand.nudge();
  await bring(page, hand, await s.target(page, c.onto));
  await hand.to(await aimAt(await s.target(page, c.onto), c.side, s.axis));
  await quiet(page);
  assert.equal(await page.locator('.wv-reorder-slot').count(), 1, `${s.name}: the second drag opens a placeholder too`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'), null, { timeout: 5000 });
  if (touch) await hand.release();
  assert.deepEqual(await s.keys(page), want, `${s.name}: Escape puts the item back`);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-reordering')), false, `${s.name}: and ends the reorder`);
  if (s.saved) {
    await page.waitForLoadState('networkidle');
    assert.deepEqual(s.saved(), want, `${s.name}: Escape saves nothing`);
  }
}
