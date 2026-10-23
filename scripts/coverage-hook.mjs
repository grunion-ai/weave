import { writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { lineIndex, executed, SOURCE } from './coverage-map.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const dir = process.env.WEAVE_CLIENT_COVERAGE;
const pw = dir && process.argv[1]?.endsWith('.test.mjs') ? await import('playwright').catch(() => null) : null;
const chromium = pw?.chromium ?? pw?.default?.chromium;

function record(browser) {
  const test = relative(ROOT, process.argv[1]);
  const pages = new Set();
  let dumps = 0;
  const dump = async (page) => {
    if (!pages.delete(page)) return;
    const scripts = [];
    for (const entry of await page.coverage.stopJSCoverage().catch(() => [])) {
      const url = URL.canParse(entry.url) ? new URL(entry.url) : null;
      const path = url && /^(?:127\.0\.0\.1|localhost)$/.test(url.hostname) ? `public${url.pathname.replace(/^\/w\/[^/]+/, '')}` : '';
      if (SOURCE.test(path)) scripts.push([path, executed(entry.functions, lineIndex(entry.source ?? ''))]);
    }
    if (scripts.length) writeFileSync(join(dir, `client-${process.pid}-${++dumps}.json`), JSON.stringify({ test, scripts }));
  };
  const track = async (page) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
    pages.add(page);
    const close = page.close.bind(page);
    page.close = async (...a) => { await dump(page); return close(...a); };
    return page;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => track(await newPage(...a));
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    const ctxPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...b) => track(await ctxPage(...b));
    const ctxClose = ctx.close.bind(ctx);
    ctx.close = async (...b) => { for (const page of ctx.pages()) await dump(page); return ctxClose(...b); };
    return ctx;
  };
  const close = browser.close.bind(browser);
  browser.close = async (...a) => { for (const page of [...pages]) await dump(page); return close(...a); };
  return browser;
}

if (chromium) for (const name of ['connect', 'launch']) {
  const original = chromium[name].bind(chromium);
  chromium[name] = async (...a) => record(await original(...a));
}
