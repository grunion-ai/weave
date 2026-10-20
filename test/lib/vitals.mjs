export const BUDGET_FILE = 'test/vitals-budget.json';

export const RUNS = 5;

export const METRICS = ['lcp', 'cls', 'inp'];

const ROW = '.wv-grid tbody tr.entity-row';

export const VITALS = [
  {
    name: 'load-home',
    url: () => '/#/',
    ready: '#main',
    async interact(page, cell) {
      if (cell === 'phone') {
        await page.tap('#main .nav-menu');
        await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-peek'));
      } else {
        await page.click('#sidebar a.nav-db:has-text("Task")');
        await page.waitForSelector(ROW);
      }
    },
  },
  {
    name: 'open-table',
    url: (ctx) => `/#/table/${ctx.tasks.id}`,
    ready: ROW,
    async interact(page, cell, ctx) {
      if (cell === 'phone') {
        const name = await page.locator(`tr[data-eid="${ctx.ids[1]}"] .list-name`).boundingBox();
        await page.touchscreen.tap(name.x + 20, name.y + name.height / 2);
        await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      } else {
        await page.click(`tr[data-eid="${ctx.ids[1]}"] .open-link`);
        await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Status"]');
      }
    },
  },
];

export const vitalKey = (journey, cell, metric) => `${journey}|${cell}|${metric}`;

export function judgeVital(key, value, budget) {
  const metric = key.split('|').at(-1);
  const shown = metric === 'cls' ? Number(value.toFixed(3)) : Math.round(value);
  if (!(key in budget)) return `${key} has no vitals budget: add "${key}": ${shown} to ${BUDGET_FILE}`;
  if (shown > budget[key]) return `${key} measured ${shown}, budget ${budget[key]}: make the page faster, or raise vitals["${key}"] in ${BUDGET_FILE} and write why under raised["${key}"]`;
  return null;
}

export function clsOf(shifts) {
  let best = 0, sum = 0, first = -Infinity, last = -Infinity;
  for (const s of shifts) {
    if (s.t - last > 1000 || s.t - first > 5000) { sum = 0; first = s.t; }
    sum += s.value;
    last = s.t;
    best = Math.max(best, sum);
  }
  return best;
}

function probe() {
  const v = (window.__vitals = { lcp: 0, shifts: [], inp: 0 });
  const watch = (type, fn, extra = {}) => {
    try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch {}
  };
  watch('largest-contentful-paint', (e) => { v.lcp = Math.max(v.lcp, e.renderTime || e.startTime); });
  watch('layout-shift', (e) => { if (!e.hadRecentInput) v.shifts.push({ t: e.startTime, value: e.value }); });
  watch('event', (e) => { if (e.interactionId) v.inp = Math.max(v.inp, e.duration); }, { durationThreshold: 16 });
  watch('first-input', (e) => { v.inp = Math.max(v.inp, e.duration); });
}

export const installVitals = (page) => page.addInitScript(probe);

export async function readVitals(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const v = await page.evaluate(() => window.__vitals);
  return { lcp: v.lcp, cls: clsOf(v.shifts), inp: v.inp };
}
