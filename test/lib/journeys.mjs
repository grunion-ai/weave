export const ROWS = 400;

export function seed(weave) {
  weave.createSpace({ name: 'Work' });
  const projects = weave.createTable({ space: 'Work', name: 'Project' });
  const tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  weave.addField(tasks, { name: 'Points', type: 'number' });
  weave.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const ps = ['Launch', 'Billing rewrite with a name long enough to wrap in a chip', 'Ops'].map((name) => weave.createEntity(projects, { name }).id);
  const ids = [];
  for (let i = 0; i < ROWS; i++) {
    const name = i % 37 === 0 ? `Task ${i}: a title that runs well past the column so the cell has to clip it somewhere sensible` : `Task ${i}`;
    ids.push(weave.createEntity(tasks, { name, values: {
      Status: ['Open', 'Doing', 'Done'][i % 3],
      ...(i % 5 ? { Owner: ['ana', 'bo', 'cy'][i % 3] } : {}),
      ...(i % 4 ? { Points: (i * 7) % 13 } : {}),
      ...(i % 6 ? { Project: ps[i % 3] } : {}),
    } }).id);
  }
  const doc = weave.createEntity(tasks, { name: 'Spec', doc: '# Spec\n\nFirst paragraph of the spec.\n\n- one\n- two\n' }).id;
  weave.tableView(`${tasks.id}/All`, { from: 'blank' });
  weave.tableView(`${tasks.id}/Compact`, { from: 'blank', fields: ['Name', 'Status'] });
  return { tasks, projects, ids, doc };
}

export const CELLS = {
  desktop: { engine: 'chromium', viewport: { width: 1400, height: 900 }, hasTouch: false, isMobile: false },
  phone: { engine: 'webkit', device: 'iPhone 15' },
};
export const cellsOf = (j) => j.cells ?? ['desktop'];
const BOTH = ['desktop', 'phone'];
const PHONE = ['phone'];

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
const ROW = '.wv-grid tbody tr.entity-row';

async function table(page, ctx) {
  await page.goto(`${ctx.base}/#/table/${ctx.tasks.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(ROW);
  await frames(page, 3);
}

async function scrollTo(page, f) {
  await page.evaluate((k) => {
    const wrap = document.querySelector('.table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
    box.scrollTo({ top: (box.scrollHeight - box.clientHeight) * k, behavior: 'instant' });
  }, f);
  await frames(page, 3);
}

const beat = (page) => page.waitForTimeout(400);

async function swipe(page, row, dx) {
  const box = await row.boundingBox();
  await page.evaluate(async ([x, y, dx]) => {
    const target = document.elementFromPoint(x, y);
    const fire = (type, cx) => target.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: cx, clientY: y,
    }));
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    fire('pointerdown', x);
    for (let k = 1; k <= 8; k++) { await frame(); fire('pointermove', x + (dx * k) / 8); }
    await frame();
    fire('pointerup', x + dx);
  }, [dx < 0 ? box.x + box.width - 40 : box.x + 40, box.y + box.height / 2, dx]);
}

export const JOURNEYS = [
  {
    name: 'load-home',
    cells: BOTH,
    async run(page, ctx) {
      await page.goto(`${ctx.base}/#/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main');
    },
  },
  {
    name: 'open-table',
    cells: BOTH,
    async setup(page, ctx) {
      await page.goto(`${ctx.base}/#/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main');
    },
    async run(page, ctx) {
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, ctx.tasks.id);
      await page.waitForSelector(ROW);
    },
  },
  {
    name: 'scroll-grid',
    cells: BOTH,
    setup: table,
    async run(page) {
      for (const f of [0.25, 0.5, 0.75, 1]) {
        await scrollTo(page, f);
        await page.waitForFunction(() => !document.querySelector('.wv-grid tbody tr.entity-row-pending'), null, { timeout: 8000 });
      }
      await scrollTo(page, 0);
    },
  },
  {
    name: 'edit-cell',
    setup: table,
    async run(page, ctx) {
      const id = ctx.ids[2];
      await page.click(`tr[data-eid="${id}"] td[data-field="Name"] input`);
      await page.keyboard.type(`Task 2, edited ${Date.now() % 1e6}`);
      const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
      await page.keyboard.press('Tab');
      await landed;
    },
  },
  {
    name: 'open-row',
    setup: table,
    async run(page, ctx) {
      await page.click(`tr[data-eid="${ctx.ids[1]}"] .open-link`);
      await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Status"]');
      await frames(page, 3);
      await page.click(`tr[data-eid="${ctx.ids[4]}"] .open-link`);
      await page.waitForFunction((id) => location.hash.includes(id), ctx.ids[4]);
      await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Status"]');
    },
  },
  {
    name: 'switch-view',
    setup: table,
    async run(page) {
      for (const name of ['Compact', 'All']) {
        await page.click('.table-view-btn');
        await page.waitForSelector('.view-strip .view-row');
        await page.locator('.view-strip .view-row').filter({ has: page.locator('.view-name', { hasText: new RegExp(`^${name}$`) }) }).click();
        await page.waitForFunction((n) => location.hash.includes('/view/') || n === 'All', name);
        await page.waitForSelector(ROW);
        await page.keyboard.press('Escape');
        await frames(page, 3);
      }
    },
  },
  {
    name: 'type-doc',
    cells: BOTH,
    async setup(page, ctx) {
      await page.goto(`${ctx.base}/#/entity/${ctx.doc}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [contenteditable="true"]');
      await frames(page, 3);
    },
    async run(page) {
      await page.click('.vditor-ir [contenteditable="true"]');
      await page.keyboard.press('End');
      await page.keyboard.type(' A sentence typed at a reading pace.', { delay: 15 });
      await page.waitForTimeout(1500);
    },
  },
  {
    name: 'trash-undo',
    setup: table,
    async run(page) {
      const n = await page.locator(ROW).count();
      const boxes = page.locator('.wv-grid tbody .sel-box');
      await boxes.nth(1).check();
      await boxes.nth(2).check();
      await page.locator('.sel-puck .sel-act.danger').click();
      const toast = page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();
      await toast.waitFor();
      await toast.locator('.wv-toast-action').click();
      await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel).length === k, [ROW, n], { timeout: 8000 });
    },
  },
  {
    name: 'theme',
    setup: table,
    async run(page) {
      for (let i = 0; i < 2; i++) {
        await page.click('#theme-toggle');
        await frames(page, 4);
      }
    },
  },
  {
    name: 'phone-search',
    cells: PHONE,
    setup: table,
    async run(page) {
      await page.tap('.phone-bar .phone-search');
      await page.waitForSelector('#cmdk-back #cmdk-input');
      await beat(page);
      const vp = page.viewportSize();
      await page.touchscreen.tap(vp.width / 2, vp.height - 12);
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
    },
  },
  {
    name: 'phone-menu',
    cells: PHONE,
    setup: table,
    async run(page) {
      await page.tap('#main .nav-menu');
      await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-peek'));
      await beat(page);
      await page.tap('#nav-collapse');
      await page.waitForFunction(() => !document.querySelector('#app').classList.contains('nav-peek'));
    },
  },
  {
    name: 'phone-table-sheet',
    cells: PHONE,
    setup: table,
    async run(page) {
      const sheet = '#main .crumb-row.tools-open > .crumb-actions';
      await page.tap('#main .table-tools-btn');
      await page.waitForSelector(sheet);
      await beat(page);
      await page.tap('#main .table-tools-btn');
      await page.waitForSelector(sheet, { state: 'detached' });
    },
  },
  {
    name: 'phone-picker',
    cells: PHONE,
    async setup(page, ctx) {
      await page.goto(`${ctx.base}/#/table/${ctx.tasks.id}?e=${ctx.ids[7]}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock:not([hidden]) .chip-trigger[title="Status"]');
      await frames(page, 3);
    },
    async run(page) {
      const chip = '#dock .chip-trigger[title="Status"]';
      const was = (await page.textContent(chip)).trim();
      const to = ['Open', 'Doing', 'Done'].find((st) => !was.includes(st));
      await page.tap(chip);
      await page.waitForSelector('.picker-pop .picker-row');
      await beat(page);
      await page.tap(`.picker-pop .picker-row:has-text("${to}")`);
      await page.waitForSelector('.picker-pop', { state: 'detached' });
      await page.waitForFunction(([q, st]) => document.querySelector(q)?.textContent.includes(st), [chip, to]);
    },
  },
  {
    name: 'phone-open-row',
    cells: PHONE,
    setup: table,
    async run(page, ctx) {
      const name = await page.locator(`tr[data-eid="${ctx.ids[1]}"] .list-name`).boundingBox();
      await page.touchscreen.tap(name.x + 20, name.y + name.height / 2);
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await beat(page);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('#dock')?.hidden !== false);
      await page.waitForSelector(ROW);
    },
  },
  {
    name: 'phone-swipe',
    cells: PHONE,
    setup: table,
    async run(page, ctx) {
      const id = ctx.ids[3];
      const row = page.locator(`tr[data-eid="${id}"]`);
      const opened = () => page.waitForSelector(`tr[data-eid="${id}"].swipe-open .swipe-cell`);
      const shut = () => page.waitForFunction((k) => !document.querySelector(`tr[data-eid="${k}"] .swipe-cell`), id);
      await swipe(page, row, -220);
      await opened();
      await beat(page);
      await swipe(page, row, 220);
      await shut();
      await beat(page);
      await swipe(page, row, -220);
      await opened();
      await beat(page);
      const box = await row.boundingBox();
      await page.touchscreen.tap(box.x + 40, box.y + box.height / 2);
      await shut();
    },
  },
];

export async function walk(browser, journey, ctx, { probe, record = null, engine, ...options } = {}) {
  const ran = browser.browserType().name();
  if (engine && engine !== ran) throw new Error(`${journey.name} wants ${engine} and was handed ${ran}`);
  const page = await browser.newPage({ viewport: CELLS.desktop.viewport, ...options });
  try {
    await probe.install(page);
    if (journey.setup) await journey.setup(page, ctx);
    else await page.goto('about:blank');
    await probe.reset(page);
    const rec = record ? await record(page) : null;
    await journey.run(page, ctx);
    await page.waitForTimeout(600);
    await frames(page, 2);
    const events = await probe.read(page);
    const inputs = probe.inputs ? await probe.inputs(page) : [];
    return { events, inputs, frames: rec ? await rec.stop() : [] };
  } finally {
    await page.close();
  }
}
