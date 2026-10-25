import { countClicks } from './clicks.mjs';
import { ROWS, SEEDS, cellsOf, plan, statesOf } from './states.mjs';

export { ROWS, cellsOf };
export const seed = SEEDS.grid;

export const CELLS = {
  desktop: { engine: 'chromium', viewport: { width: 1400, height: 900 }, hasTouch: false, isMobile: false },
  phone: { engine: 'webkit', device: 'iPhone 15' },
};

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);

export const JOURNEYS = statesOf(plan('budgets'), 'journey');

export async function walk(browser, journey, ctx, { probe, record = null, engine, ...options } = {}) {
  const ran = browser.browserType().name();
  if (engine && engine !== ran) throw new Error(`${journey.name} wants ${engine} and was handed ${ran}`);
  const page = await browser.newPage({ viewport: CELLS.desktop.viewport, ...options });
  try {
    const clicks = await countClicks(page);
    await probe?.install(page);
    if (journey.setup) await journey.setup(page, ctx);
    else await page.goto('about:blank');
    await probe?.reset(page);
    clicks.reset();
    const rec = record ? await record(page) : null;
    await journey.run(page, ctx);
    if (probe) await page.waitForTimeout(600);
    await frames(page, 2);
    const events = probe ? await probe.read(page) : [];
    const inputs = probe?.inputs ? await probe.inputs(page) : [];
    return { events, inputs, clicks: clicks.count, frames: rec ? await rec.stop() : [] };
  } finally {
    await page.close();
  }
}
