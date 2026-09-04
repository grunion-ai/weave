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
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';

export const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

/* launch(name, seed, options)
     name    — names the skip when playwright is missing
     seed    — (weave) => void | handles; builds the workspace under test and
               may return an object of handles the suite reads back
     options — { server: (weave) => extra startServer options }
   Resolves to { weave, server, base, browser, ...handles }, or null when
   there is no browser to run in. The server and browser are closed after
   the suite's last test. */
export async function launch(name, seed = () => {}, options = {}) {
  if (!chromium) {
    test(`${name} (browser)`, { skip: 'playwright not installed' }, () => {});
    return null;
  }
  const weave = new Weave();
  const handles = (await seed(weave)) ?? {};
  const { server } = await startServer(weave, { port: 0, ...(options.server?.(weave) ?? {}) });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  test.after(async () => {
    await browser?.close();
    server?.close();
  });
  return { weave, server, base, browser, ...handles };
}
