/* A failed request says so — Issue #265.

   The 2026-09-12 audit counted 42 bare `catch {` blocks in app.js against 43
   error toasts: about half of the failures the client could meet produced no
   signal at all. The loudest one was the ⌘K palette: its fetch ran inside a
   setTimeout with no try, so a failed search was an unhandled rejection and
   the palette went on showing the previous query's results. With no
   cancellation either, a slow earlier response could land after a newer one
   and overwrite it.

   The rule now: every bare catch either toasts, rethrows, or carries a
   comment naming why silence is right; the palette paints "Couldn't search"
   under its input and aborts the previous keystroke's request.

   Playwright is NOT a dependency; the browser half skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, fnBody } from './lib/source.mjs';
import { launch } from './lib/browser.mjs';

/* Each `catch {` with its block, plus the rest of the line the block closes
   on (where a trailing `// why` comment sits). */
function bareCatches(src = APP) {
  const out = [];
  for (const m of src.matchAll(/catch\s*\{/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    const eol = src.indexOf('\n', i);
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, text: src.slice(m.index, eol === -1 ? undefined : eol) });
  }
  return out;
}

test('every bare catch in app.js toasts, rethrows, or says why silence is right (Issue #265)', () => {
  const silent = bareCatches().filter(({ text }) => !/toast\(|throw |\/\*|\/\//.test(text));
  assert.deepEqual(silent.map((c) => `app.js:${c.line} ${c.text.split('\n')[0].trim()}`), [],
    'a catch with no toast and no comment is a failure nobody hears about');
});

test('the registry catch surfaces the failure instead of emptying the rail (Issue #265)', () => {
  const body = fnBody('loadSchema');
  const c = body.slice(body.indexOf('/api/schema'));
  assert.match(c, /catch \(err\) \{[\s\S]*?toast\(/, 'a failed root-schema fetch toasts');
  assert.match(c, /if \(!res\.ok\)/, 'and a non-2xx answer counts as a failure, not an empty registry');
  assert.match(c, /res\.status === 401 \|\| res\.status === 403\) state\.registry = \[\]/,
    'but no access to the root is an answer: an empty registry, no toast');
});

test('a record or view that fails to open says so before falling back home (Issue #265)', () => {
  assert.match(fnBody('showEntity'), /catch \(err\) \{\s*toast\(`Couldn't open that record/);
  assert.match(fnBody('showView'), /catch \(err\) \{ toast\(`Couldn't open that view/);
});

test('the inline # search says it failed, once per failure run (Issue #265)', () => {
  const body = fnBody('entityHint');
  assert.match(body, /catch \(err\) \{[\s\S]*?toast\(/, 'a failed # search toasts');
  assert.match(body, /entityHintFailing/, 'but not once per keystroke');
});

test('api() passes an AbortSignal through to fetch', () => {
  assert.match(fnBody('api'), /signal/, 'the palette cannot cancel a request api() will not hand over');
});

const s = await launch('fetch failures', (weave) => {
  weave.createSpace({ name: 'S' });
  const t = weave.createTable({ space: 'S', name: 'T' });
  weave.createEntity(t, { name: 'Alphaberry' });
  weave.createEntity(t, { name: 'Betamax' });
});

if (s) {
  const { base, browser } = s;
  const results = (page) => page.locator('#cmdk-results').innerText();

  test('a failed ⌘K search paints "Couldn\'t search" under the input', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdk-input').fill('Alpha');
    await page.waitForFunction(() => /Alphaberry/.test(document.querySelector('#cmdk-results')?.textContent));
    await page.route('**/api/search**', (r) => r.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'index is rebuilding' }),
    }));
    await page.locator('#cmdk-input').fill('Beta');
    await page.waitForSelector('#cmdk-results .cmdk-error', { timeout: 3000 });
    const text = await results(page);
    assert.match(text, /Couldn.t search/, 'the palette names the failure');
    assert.match(text, /index is rebuilding/, 'and repeats what the server said');
    assert.doesNotMatch(text, /Alphaberry/, 'the previous query\'s results are gone');
    assert.deepEqual(errors, [], 'no unhandled rejection');
    await page.unroute('**/api/search**');
    await page.locator('#cmdk-input').fill('Betam');
    await page.waitForFunction(() => /Betamax/.test(document.querySelector('#cmdk-results')?.textContent));
    assert.equal(await page.locator('#cmdk-results .cmdk-error').count(), 0, 'a good search clears the error');
    await page.close();
  });

  test('a slow earlier ⌘K response cannot overwrite a newer one', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.route('**/api/search**', async (r) => {
      if (r.request().url().includes('q=Alpha')) await new Promise((ok) => setTimeout(ok, 900));
      try { await r.continue(); } catch { /* the page aborted it — the point of the test */ }
    });
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#cmdk-input').fill('Alpha');
    await page.waitForTimeout(300); // past the 150 ms debounce: the slow request is in flight
    await page.locator('#cmdk-input').fill('Beta');
    await page.waitForFunction(() => /Betamax/.test(document.querySelector('#cmdk-results')?.textContent));
    await page.waitForTimeout(1200); // the slow Alpha answer would have landed by now
    const text = await results(page);
    assert.match(text, /Betamax/);
    assert.doesNotMatch(text, /Alphaberry/, 'the stale Alpha response was dropped');
    await page.close();
  });
}
