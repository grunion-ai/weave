import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';

const pw = await import('playwright').catch(() => null);
const browserType = pw && (pw[process.env.WEAVE_BROWSER || 'chromium'] ?? pw.chromium);

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

let held = null;
function lease(manager) {
  if (!held) {
    const fresh = { refs: 0 };
    fresh.ready = manager.request({ type: 'lease', root: ROOT, files: [], env: { WEAVE_BROWSER: process.env.WEAVE_BROWSER, ...manager.admissionEnv() } }, { start: true, lease: true })
      .then((r) => {
        if (r.endpoint) return r;
        const refused = r.code === manager.NOT_ADMITTED ? `TEST MANAGER NOT ADMITTED: ${r.error}` : r.error || 'test manager provided no browser endpoint';
        throw Object.assign(new Error(refused), { code: r.code });
      });
    fresh.ready.catch(() => { if (held === fresh) held = null; });
    held = fresh;
  }
  const shared = held;
  shared.refs++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--shared.refs) return;
    if (held === shared) held = null;
    shared.ready.then((r) => r.release(), () => {});
  };
  return shared.ready.then((r) => ({ endpoint: r.endpoint, release }), (error) => { release(); throw error; });
}

export const chromium = browserType && new Proxy(browserType, {
  get(target, name) {
    if (name !== 'launch') { const value = target[name]; return typeof value === 'function' ? value.bind(target) : value; }
    return async () => {
      let leased;
      let endpoint = process.env.WEAVE_TEST_BROWSER_ENDPOINT;
      if (!endpoint) {
        const manager = await import('../../scripts/test-manager.mjs');
        if (process.env.WEAVE_TEST_JOB) {
          const r = await manager.request({ type: 'browser', job: process.env.WEAVE_TEST_JOB });
          if (!r.endpoint) throw new Error(r.error || 'test manager provided no browser endpoint');
          endpoint = r.endpoint;
        } else ({ endpoint } = leased = await lease(manager));
      }
      let connected;
      try { connected = await target.connect(endpoint); }
      catch (error) { leased?.release(); throw error; }
      if (leased) {
        const close = connected.close.bind(connected);
        connected.close = async () => { try { await close(); } finally { leased.release(); } };
        connected.once('disconnected', leased.release);
      }
      return connected;
    };
  },
});

const engineFor = (engine) => (!engine || pw[engine] === browserType ? chromium : pw[engine]);

export const PHONE = 'iPhone 15';
export function phoneProfile() {
  if (!pw) return null;
  const { defaultBrowserType, ...page } = pw.devices[PHONE];
  return { engine: defaultBrowserType, page };
}
export const phonePage = (browser, options = {}) => browser.newPage({ ...phoneProfile().page, ...options });

export async function launch(name, seed = () => {}, options = {}) {
  if (!chromium) {
    test(`${name} (browser)`, { skip: 'playwright not installed' }, () => {});
    return null;
  }
  const browser = await engineFor(options.phone ? phoneProfile().engine : options.engine).launch();
  if (THROTTLE) throttle(browser);
  const weave = new Weave();
  let server;
  test.after(async () => {
    await browser?.close();
    server?.close();
  });
  const handles = (await seed(weave)) ?? {};
  ({ server } = await startServer(weave, { port: 0, ...(options.server?.(weave) ?? {}) }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { weave, server, base, browser, ...handles };
}

const THROTTLE = Number(process.env.WEAVE_CPU_THROTTLE) || 0;
function throttle(browser) {
  const slow = async (page) => {
    const cdp = await page.context().newCDPSession(page).catch(() => null);
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => { const page = await newPage(...a); await slow(page); return page; };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    const ctxPage = ctx.newPage.bind(ctx);
    ctx.newPage = async () => { const page = await ctxPage(); await slow(page); return page; };
    return ctx;
  };
}

const extraEngines = new Map();
test.after(async () => {
  for (const browser of extraEngines.values()) await browser?.close().catch(() => {});
  extraEngines.clear();
});
export async function engineOf(name) {
  if (!pw) return null;
  if (!extraEngines.has(name)) {
    const browser = pw[name] ? await pw[name].launch().catch(() => null) : null;
    if (browser && THROTTLE) throttle(browser);
    extraEngines.set(name, browser);
  }
  return extraEngines.get(name);
}

export async function painted(page, selector, { timeout = 30000, state } = {}) {
  try {
    await page.waitForSelector(selector, state ? { timeout, state } : { timeout });
  } catch (err) {
    const read = page.evaluate(() => {
      const main = document.querySelector('#main');
      return {
        hash: location.hash,
        skeleton: !!document.querySelector('#main .sk-row, #main .sk-card, #main .sk-toolbar'),
        main: main ? [...main.children].map((n) => n.className || n.tagName) : null,
        rows: document.querySelectorAll('.wv-grid tbody tr.entity-row').length,
        toast: document.querySelector('#wv-toasts')?.textContent?.trim() || '',
      };
    }).catch((unreadable) => ({ unreadable: String(unreadable) }));
    const gaveUp = new Promise((say) => setTimeout(() => say({ unreadable: 'the page did not answer in 2000 ms' }), 2000).unref());
    const why = await Promise.race([read, gaveUp]);
    err.message += `\n${selector} never painted within ${timeout} ms; the page says ${JSON.stringify(why)}`;
    throw err;
  }
}

export async function styleOf(locator, prop, want, { timeout = 10000 } = {}) {
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction(([n, p, w]) => getComputedStyle(n)[p] === w, [handle, prop, want], { timeout }).catch(() => {});
  return handle.evaluate((n, p) => getComputedStyle(n)[p], prop);
}

export async function settled(locator, { timeout = 10000 } = {}) {
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction((n) => n.getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), handle, { timeout });
}

export async function eventually(read, want, { timeout = 10000, every = 50 } = {}) {
  const { isDeepStrictEqual } = await import('node:util');
  const end = Date.now() + timeout;
  let got = await read();
  while (!isDeepStrictEqual(got, want) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, every));
    got = await read();
  }
  return got;
}
