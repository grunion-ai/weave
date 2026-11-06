import { seed } from '../../scripts/seed.mjs';
import { settled } from './browser.mjs';

export function seedDemo(weave, { unlinkRows = 0 } = {}) {
  const made = seed(weave);
  const bare = weave.createEntity(made.tasks, { name: 'Draft launch post' });
  const unlink = Array.from({ length: unlinkRows }, (_, i) => weave.createEntity(made.tasks, {
    name: `Unlink check ${i}`, values: { Estimate: 2, Project: 'Hermes Docs', Assignee: 'Ada Chen' },
  }).id);
  return { tasks: made.tasks.id, t2: made.t2.id, t4: made.t4.id, bare: bare.id, unlink };
}

export async function openTable(page, base, table) {
  await page.goto(`${base}/#/table/${table}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
}

export async function openRecord(page, base, table, row) {
  await page.goto(`${base}/#/table/${table}?e=${row}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
  await settled(page.locator('#dock'));
}

export const recordCoversScreen = (page) => page.evaluate(() => {
  const dock = document.querySelector('#dock:not([hidden])');
  if (!dock) return false;
  const r = dock.getBoundingClientRect();
  return r.left <= 1 && r.width >= document.documentElement.clientWidth - 1;
});

export const WIDE = 'the record opens beside the table at this width, not as the full-screen phone page';

export const topBar = (page, scope) => page.evaluate((scope) => {
  const root = document.querySelector(scope);
  const seen = [];
  for (const n of root.querySelectorAll('button, a.crumb-item, .crumb-cur')) {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom > 80 || r.top < 0) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === n || n.contains(hit))) continue;
    seen.push({
      cls: typeof n.className === 'string' ? n.className : '',
      label: n.getAttribute('aria-label') || n.title || n.textContent.trim().slice(0, 24),
      location: !!n.closest('.crumb-path, .crumb-slot, .crumb-cur-wrap'),
      left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    });
  }
  return seen;
}, scope);

export function stubKeyboard() {
  const real = window.visualViewport;
  if (!real) return;
  let keyboard = 0;
  const fake = new EventTarget();
  for (const [key, read] of Object.entries({
    width: () => real.width, height: () => real.height - keyboard, offsetTop: () => real.offsetTop,
    offsetLeft: () => real.offsetLeft, pageTop: () => real.pageTop, pageLeft: () => real.pageLeft, scale: () => real.scale,
  })) Object.defineProperty(fake, key, { get: read });
  fake.onresize = null;
  fake.onscroll = null;
  const relay = (type) => {
    const e = new Event(type);
    fake.dispatchEvent(e);
    fake[`on${type}`]?.(e);
  };
  real.addEventListener('resize', () => relay('resize'));
  real.addEventListener('scroll', () => relay('scroll'));
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  window.wvTestKeyboard = (height) => { keyboard = height; relay('resize'); };
}
