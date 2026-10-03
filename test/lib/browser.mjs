/* The one harness under every browser suite.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps). It
   is imported dynamically here, once, and a suite that calls launch() gets
   null back — after a single skipped test has said why — when it is absent,
   so `node --test` stays green on a bare checkout.

   Before this file, each of the 24 browser suites carried the same 22 lines:
   the import, the skip stub, a test.before that seeded a Weave, started a
   server on a free port and launched a browser, and a test.after that closed
   both. The seed is the suite's own business and stays in the suite; the
   rest lives here. */
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';

/* WEAVE_BROWSER=webkit runs the same suites in WebKit — Kyle reads weave in
   Safari, and a drag that Chromium accepts can be one WebKit refuses. The
   export keeps its old name; every suite only ever calls launch(). */
const pw = await import('playwright').catch(() => null);
const browserType = pw && (pw[process.env.WEAVE_BROWSER || 'chromium'] ?? pw.chromium);

/* Feature #236: launch() connects to the test manager's warm browser
   instead of starting a Chromium per suite. Each connection owns its
   contexts; close disconnects this client only. Inside a manager job the
   job's allocation hands out the endpoint; a raw `node --test` caller
   leases the same queue instead of launching Chromium beside it. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/* One lease per process, counted. A suite that calls launch() twice (two
   workspaces, first-run-browser) would otherwise queue its second lease
   behind its first, which only test.after releases: a deadlock until the
   queue wait ran out (change 446 review). Each launch() still opens its
   own connection, so a suite's contexts stay its own. The lease carries
   the caller's admission overrides; the manager reads them from job env. */
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

/* A suite pinned to another engine (options.engine, Issue #546) launches its
   own browser: the manager holds one browser kind at a time, and switching
   it would close the warm browser under the suites still connected to it.
   ponytail: per-kind warm browsers in the manager if pinned suites multiply. */
const engineFor = (engine) => (!engine || pw[engine] === browserType ? chromium : pw[engine]);

/* launch(name, seed, options)
     name    — names the skip when playwright is missing
     seed    — (weave) => void | handles; builds the workspace under test and
               may return an object of handles the suite reads back
     options — { server: (weave) => extra startServer options,
                 engine: 'webkit' | 'chromium' | 'firefox' — pins the suite to
                 one engine whatever WEAVE_BROWSER says (Issue #546: only
                 WebKit on macOS draws a classic scrollbar that takes width) }
   Resolves to { weave, server, base, browser, ...handles }, or null when
   there is no browser to run in. The server and browser are closed after
   the suite's last test. */
export async function launch(name, seed = () => {}, options = {}) {
  if (!chromium) {
    test(`${name} (browser)`, { skip: 'playwright not installed' }, () => {});
    return null;
  }
  /* The browser connects first and test.after is registered before the
     seed runs, so a seed that throws still releases the connection. */
  const browser = await engineFor(options.engine).launch();
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

/* WEAVE_CPU_THROTTLE=4 slows every page's main thread fourfold (Chromium
   only). A case that goes red in the full-suite gate and green alone can be
   made red on a quiet machine this way, which is how the waits below were
   found (Issues #454, #466): `WEAVE_CPU_THROTTLE=4 node --test <file>`. */
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

/* A style that a CSS transition or animation moves is only worth reading
   once it has arrived. A fixed sleep before the read is a bet on the
   machine's load, and the full suite loses that bet (Issues #454, #466).
   Waits until getComputedStyle(el)[prop] is `want` and returns what it
   read last, so the caller's assert still names the value on a miss. */
export async function styleOf(locator, prop, want, { timeout = 10000 } = {}) {
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction(([n, p, w]) => getComputedStyle(n)[p] === w, [handle, prop, want], { timeout }).catch(() => {});
  return handle.evaluate((n, p) => getComputedStyle(n)[p], prop);
}

/* Resolves once nothing in the element's subtree is animating: a box read
   before a pop-in lands measures the animation, not the layout. */
export async function settled(locator, { timeout = 10000 } = {}) {
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction((n) => n.getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), handle, { timeout });
}

/* Polls a Node-side read (the engine the server writes to) until it
   deepEquals `want` or the time runs out, then returns the last read. A
   write the page sends after a keypress lands when the page gets to it,
   and waitForLoadState('networkidle') can resolve before it is sent. */
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
