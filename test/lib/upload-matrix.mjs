import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { Weave } from '../../src/engine.js';
import { tempDir } from './temp.mjs';
import { inkOn } from './contrast.mjs';

export const KB = 1024;
export const MB = 1024 * 1024;
export const LIMIT = 10 * MB;
export const FEEDBACK_MS = 150;
export const SLOW = { offline: false, latency: 40, downloadThroughput: 4e6 / 8, uploadThroughput: 4e6 / 8 };

export const ERROR_ID = 'c0ffee12';

export const MSG = {
  over: (n, size) => `${n} is ${size}, over the 10 MB limit, so it was not saved.`,
  server: (n, id = ERROR_ID) => `The weave server hit a bug, so ${n} was not saved. Include error ${id} when you report it to whoever runs your weave.`,
  restarting: (n) => `The weave server is still restarting, so ${n} was not saved. Try again in a minute.`,
  storage: (n) => `The weave server is out of storage, so ${n} was not saved. Ask whoever runs your weave to add storage; uploads will work again after that.`,
  restartingInBatch: (done, total, n) => `${done} of ${total} files uploaded. ${n} was not saved: the server is still restarting.`,
  offline: (n) => `Could not reach the server; ${n} was not saved. Check your connection.`,
  timeout: (n) => `${n} took too long to upload and was not saved.`,
  oneFailed: (done, total, n, reason) => `${done} of ${total} files uploaded. ${n} was not saved: ${reason}.`,
  someFailed: (done, total, failed) => `${done} of ${total} files uploaded. ${failed} files were not saved.`,
  skipped: (done, total, skipped) => `${done} of ${total} files uploaded. ${skipped} files were over the 10 MB limit and not saved.`,
  empty: (n) => `${n} is empty and was saved anyway. Remove it if that was a mistake.`,
  many: (total) => `${total} files uploaded.`,
};
export const TILE = { over: 'Over 10 MB', server: `Error ${ERROR_ID}`, restarting: 'Still restarting', waiting: 'Server restarting', storage: 'Storage full', offline: 'No connection', timeout: 'Timed out' };
export const RETRY_WAIT_MS = [30, 60, 90];
export const RETRY = 'Retry';
export const CHOOSE = 'Choose another file';

const HTML_502 = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>';
const HTML_503 = '<html><head><title>503 Service Unavailable</title></head><body><center><h1>503 Service Unavailable</h1></center></body></html>';
const HTML_504 = '<html><head><title>504 Gateway Time-out</title></head><body><center><h1>504 Gateway Time-out</h1></center></body></html>';
const UPLOAD_ROUTE = /\/api\/(?:uploads|entities\/[^/]+\/(?:fields\/[^/]+\/)?files)$/;

export const file = (name, size, mime = 'application/pdf') => ({ name, size, mime });

const HOST = { picker: '.attach-box', drop: '.attach-box', doc: '.doc-uploads' };
const INPUT = { picker: '.attach-box input[type=file]', doc: '.doc-editor .vditor-toolbar [data-type="upload"] input[type="file"]' };

function recorder() {
  window.__up = { t0: null, frames: [], announced: [] };
  const rec = window.__up;
  const mark = (e) => { if (rec.t0 == null && (e.type === 'drop' || e.target?.type === 'file')) rec.t0 = performance.now(); };
  window.addEventListener('change', mark, true);
  window.addEventListener('drop', mark, true);
  const snap = () => {
    const hosts = [...document.querySelectorAll('[data-upload-key]')];
    const bars = [...document.querySelectorAll('[data-upload-job] [role="progressbar"]')].map((b) => [b.closest('[data-upload-job]').dataset.uploadJob, Number(b.getAttribute('aria-valuenow'))]);
    rec.frames.push({
      t: performance.now(),
      busy: hosts.some((h) => h.getAttribute('aria-busy') === 'true'),
      bars,
      saving: [...document.querySelectorAll('[data-upload-job]')].some((n) => n.querySelector('.attach-up-what')?.textContent === 'Saving'),
      failed: document.querySelectorAll('.attach-item.is-failed').length,
      waiting: [...document.querySelectorAll('[data-upload-job]')].some((n) => n.querySelector('.attach-up-what')?.textContent === 'Server restarting'),
    });
  };
  new MutationObserver(snap).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['aria-busy', 'aria-valuenow', 'class'] });
  const live = () => {
    for (const id of ['wv-live-alert', 'wv-live-status']) {
      const n = document.getElementById(id);
      if (n && !n.__watched) {
        n.__watched = true;
        new MutationObserver(() => { if (n.textContent) rec.announced.push([id, n.textContent]); }).observe(n, { childList: true, characterData: true, subtree: true });
      }
    }
  };
  new MutationObserver(live).observe(document.documentElement, { childList: true, subtree: true });
  live();
}

function makeFiles(list) {
  return list.map((f) => {
    const bytes = new Uint8Array(f.size);
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = (i / 4096) & 255;
    return new File([bytes], f.name, { type: f.mime });
  });
}

async function act(page, s) {
  if (s.entry === 'drop') {
    await page.evaluate(([list, make]) => {
      const files = new Function(`return (${make})`)()(list);
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      const zone = document.querySelector('.attach-box');
      for (const type of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, [s.files, makeFiles.toString()]);
    return;
  }
  const selector = INPUT[s.entry];
  if (s.files.every((f) => f.size <= 2 * MB)) {
    const pattern = (size) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i += 4096) b[i] = (i / 4096) & 255; return b; };
    await page.setInputFiles(selector, s.files.map((f) => ({ name: f.name, mimeType: f.mime, buffer: pattern(f.size) })));
    return;
  }
  await page.evaluate(([sel, list, make]) => {
    const files = new Function(`return (${make})`)()(list);
    const input = document.querySelector(sel);
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, s.files, makeFiles.toString()]);
}

async function faults(page, s) {
  const plan = s.faults ?? {};
  const tries = {};
  let held;
  const holding = new Promise((r) => { held = r; });
  if (!Object.keys(plan).length) return { holding, tries };
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const prepared = new Map();
  await page.route(UPLOAD_ROUTE, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && /\/api\/uploads$/.test(request.url())) {
      const asked = request.postDataJSON()?.name;
      const answer = await route.fetch();
      const text = await answer.text();
      if (answer.status() === 201) prepared.set(JSON.parse(text).headers.Authorization, asked);
      return route.fulfill({ status: answer.status(), contentType: 'application/json', body: text });
    }
    if (!['POST', 'PUT'].includes(request.method())) return route.continue();
    const name = request.method() === 'PUT' ? prepared.get(request.headers().authorization) : request.postDataJSON()?.name;
    const fault = plan[name];
    if (!fault) return route.continue();
    tries[name] = (tries[name] ?? 0) + 1;
    if (fault === '413') return route.fulfill(json(413, { error: 'This upload is larger than 10.0 MB, the most a file can be', code: 'too-large', limit: LIMIT }));
    if (fault === '500') return route.fulfill(json(500, { error: `Internal error (request ${ERROR_ID})`, code: 'internal', id: ERROR_ID }));
    if (fault === '507') return route.fulfill(json(507, { error: 'The weave server is out of storage, so nothing was saved. Ask whoever runs your weave to add storage.', code: 'storage-full' }));
    if (fault === '502html') return route.fulfill({ status: 502, contentType: 'text/html', body: HTML_502 });
    if (fault === '503') return route.fulfill({ status: 503, contentType: 'text/html', body: HTML_503 });
    if (fault === '502twice') return tries[name] <= 2 ? route.fulfill({ status: 502, contentType: 'text/html', body: HTML_502 }) : route.continue();
    if (fault === '504') return route.fulfill({ status: 504, contentType: 'text/html', body: HTML_504 });
    if (fault === 'offline') return route.abort('internetdisconnected');
    if (fault === '504stored') { await route.fetch(); return route.fulfill({ status: 504, contentType: 'text/html', body: HTML_504 }); }
    if (fault === 'hangStored') { await route.fetch(); return held(); }
    if (fault === 'hang') return held();
    return route.continue();
  });
  return { holding, tries };
}

export function cutProxy(port, cutAt, { stall = false } = {}) {
  let stalled;
  const state = { cut: true, cuts: 0, stalled: new Promise((r) => { stalled = r; }) };
  const sockets = new Set();
  const server = createServer((client) => {
    const up = connect(port, '127.0.0.1');
    sockets.add(client).add(up);
    let sent = 0;
    const drop = () => { client.destroy(); up.destroy(); };
    client.on('data', (chunk) => {
      sent += chunk.length;
      if (state.cut && sent > cutAt) {
        state.cuts += 1;
        if (!stall) return drop();
        client.pause();
        return stalled();
      }
      up.write(chunk);
    });
    up.on('data', (chunk) => client.write(chunk));
    client.on('error', drop);
    up.on('error', drop);
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state, base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { for (const sock of sockets) sock.destroy(); server.close(r); }),
  })));
}

const referenced = (weave, ids) => {
  const known = new Set();
  for (const id of ids) for (const f of weave.getEntity(id).files ?? []) { known.add(f.id); if (f.preview?.id) known.add(f.preview.id); }
  return known;
};

function filesOf(weave, id) {
  return (weave.getEntity(id).files ?? []).map((f) => f.name);
}

export function matrixWorld(scenarios) {
  const dir = tempDir('weave-upload-matrix-');
  const rows = {};
  const seed = (weave) => {
    weave.createSpace({ name: 'Product' });
    const decks = weave.createTable({ space: 'Product', name: 'Deck' });
    weave.addField(decks, { name: 'Files', type: 'attachments' });
    for (const sc of scenarios) {
      rows[sc.id] = weave.createEntity(decks, { name: sc.id });
      weave.setDoc(rows[sc.id].id, 'upload target paragraph\n', 'Description');
    }
  };
  return { dir, rows, seed, options: { weave: () => new Weave({ path: join(dir, 'weave.db') }) } };
}

export function matrixCases(s, { dir, rows }, scenarios) {
  if (!s) return [];
  const cases = [];
  const { base, browser, weave, server } = s;
  const port = server.address().port;
  const cdpOk = (process.env.WEAVE_BROWSER || 'chromium') === 'chromium';

  const orphans = () => {
    const blobs = existsSync(join(dir, 'files')) ? readdirSync(join(dir, 'files')).filter((n) => !n.endsWith('.tmp')) : [];
    const known = referenced(weave, Object.values(rows).map((r) => r.id));
    return blobs.filter((b) => !known.has(b));
  };

  for (const sc of scenarios) {
    const needsCdp = sc.net === 'slow' || sc.net === 'cut';
    cases.push([`${sc.id}: ${sc.entry}, ${sc.net ?? 'fast'}, ${sc.files.length} file${sc.files.length === 1 ? '' : 's'}`, { skip: needsCdp && !cdpOk ? 'network throttling needs Chromium' : false, timeout: sc.timeout ?? 60_000 }, async () => {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      let proxy = null;
      try {
        await context.addInitScript((waits) => { globalThis.WEAVE_UPLOAD_RETRY_MS = waits; }, RETRY_WAIT_MS);
        if (sc.clock) await page.clock.install();
        proxy = sc.net === 'cut' || sc.net === 'stall' ? await cutProxy(port, Math.floor(sc.files[0].size * 0.68), { stall: sc.net === 'stall' }) : null;
        await page.goto(`${proxy?.base ?? base}/#/entity/${rows[sc.id].id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.attach-box');
        if (sc.entry === 'doc') await page.waitForSelector(INPUT.doc, { state: 'attached', timeout: 20_000 });
        if (sc.entry === 'picker') assert.equal(await page.locator(INPUT.picker).getAttribute('multiple'), '', 'the attachments picker lacks multiple, though a drop takes many files');
        await page.evaluate(recorder);
        const cdp = needsCdp ? await context.newCDPSession(page) : null;
        if (needsCdp) await cdp.send('Network.emulateNetworkConditions', SLOW);
        const { holding, tries } = await faults(page, sc);
        const names = await page.evaluate((list) => Object.fromEntries(list.map((n) => [n, globalThis.uploadCore?.shortName(n) ?? n])), sc.files.map((f) => f.name));
        const want = sc.expect(names);
        const blobsBefore = orphans();

        await act(page, sc);

        if (sc.clock) {
          await (sc.net === 'stall' ? proxy.state.stalled : holding);
          await page.clock.fastForward('02:00');
        }

        const failedCount = want.failed.length;
        await page.waitForFunction(([n, toastWanted]) => {
          if (document.querySelector('[data-upload-key][aria-busy="true"]')) return false;
          if (document.querySelector('[data-upload-job]:not(.is-failed)')) return false;
          if (document.querySelectorAll('.attach-item.is-failed').length !== n) return false;
          return !toastWanted || !!document.querySelector('.wv-toast');
        }, [failedCount, !!want.toast], { timeout: sc.timeout ? sc.timeout - 5000 : 45_000 });

        const rec = await page.evaluate(() => window.__up);
        const sent = sc.files.some((f) => f.size <= LIMIT);
        assert.ok(rec.t0 != null, 'the pick or drop was never seen');
        const first = rec.frames.find((f) => f.t >= rec.t0 && (f.busy || f.failed > 0 || f.bars.length));
        assert.ok(first, 'no busy state, progress bar or failed tile ever appeared');
        assert.ok(first.t - rec.t0 <= FEEDBACK_MS, `feedback took ${Math.round(first.t - rec.t0)} ms, budget ${FEEDBACK_MS} ms`);
        if (sent) {
          assert.ok(rec.frames.some((f) => f.busy), 'the field was never aria-busy while a file uploaded');
          assert.ok(rec.frames.some((f) => f.bars.length), 'no role=progressbar ever showed');
        }
        const seen = new Map();
        for (const f of rec.frames) for (const [job, v] of f.bars) {
          const last = seen.get(job) ?? -1;
          assert.ok(v >= last, `job ${job} progress fell from ${last} to ${v}`);
          seen.set(job, v);
        }
        if (sc.net === 'slow' && !sc.faults && sc.files.some((f) => f.size >= MB && f.size <= LIMIT)) {
          const values = new Set(rec.frames.flatMap((f) => f.bars.map(([, v]) => v)));
          assert.ok(values.size >= 4, `a throttled upload showed only ${[...values].join(', ')} as progress`);
          assert.ok(rec.frames.some((f) => f.saving), 'the tile never said Saving once the body was sent');
        }

        if (want.waiting !== undefined) assert.equal(rec.frames.some((f) => f.waiting), want.waiting, want.waiting ? 'the tile never read Server restarting while weave waited' : 'a tile read Server restarting with nothing to wait for');
        if (sc.files.length === 1) assert.ok(!rec.frames.some((f) => f.waiting && f.failed), 'the tile turned red while weave still waited to retry');
        for (const [n, count] of Object.entries(want.tries ?? {})) assert.equal(tries[n], count, `${n} was sent ${tries[n]} times`);

        const tiles = await page.locator('.attach-item.is-failed').evaluateAll((ns) => ns.map((n) => ({
          name: n.querySelector('.attach-fail-name')?.textContent ?? '',
          tile: n.querySelector('.attach-fail-why')?.textContent ?? '',
          mono: n.querySelector('.attach-fail-why .wv-error-id')?.textContent ?? null,
          monoFace: (() => { const m = n.querySelector('.attach-fail-why .wv-error-id'); return m ? getComputedStyle(m).fontFamily : null; })(),
          retry: [...n.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry'),
        })));
        assert.deepEqual(tiles.map((t) => t.name).sort(), want.failed.map((f) => f.name).sort(), 'the failed tiles name the wrong files');
        for (const w of want.failed) {
          const got = tiles.find((t) => t.name === w.name);
          assert.equal(got.tile, w.tile, `${w.name} tile reason`);
          assert.equal(got.retry, w.retry, `${w.name} ${w.retry ? 'has no' : 'should have no'} Retry button`);
          if (w.mono) {
            assert.equal(got.mono, w.mono, `${w.name} tile shows the error id in its own element`);
            assert.match(got.monoFace, /mono|menlo|consolas|courier/i, `${w.name} tile id is not monospace: ${got.monoFace}`);
          }
        }
        if (failedCount) {
          const look = await page.locator('.attach-item.is-failed').first().evaluate(inkOn);
          assert.ok(look.ratio >= 4.5, `a failed tile reads at ${look.ratio.toFixed(2)}:1, under WCAG AA`);
          assert.ok(look.ink[0] > look.ink[1] + 60 && look.ink[0] > look.ink[2] + 60, `a failed tile is not red: rgb(${look.ink.join(', ')})`);
        }

        const toasts = await page.locator('.wv-toast').evaluateAll((ns) => ns.map((n) => ({
          kind: ['err', 'warn', 'success', 'info'].find((k) => n.classList.contains(k)),
          text: [...(n.querySelector('.wv-toast-msg')?.childNodes ?? [])].filter((c) => !c.classList?.contains('wv-toast-count')).map((c) => c.textContent).join(''),
          action: n.querySelector('.wv-toast-action')?.textContent ?? null,
          mono: n.querySelector('.wv-toast-msg .wv-error-id')?.textContent ?? null,
          monoFace: (() => { const m = n.querySelector('.wv-toast-msg .wv-error-id'); return m ? getComputedStyle(m).fontFamily : null; })(),
        })));
        if (!want.toast) assert.deepEqual(toasts, [], 'a toast showed where none was due');
        else {
          assert.equal(toasts.length, 1, `one summary toast, got ${JSON.stringify(toasts)}`);
          const { mono, monoFace, ...shown } = toasts[0];
          assert.deepEqual(shown, want.toast, 'the toast');
          if (want.mono) {
            assert.equal(mono, want.mono, 'the toast shows the error id in its own element');
            assert.match(monoFace, /mono|menlo|consolas|courier/i, `the toast id is not monospace: ${monoFace}`);
          }
          const region = want.toast.kind === 'err' ? 'wv-live-alert' : 'wv-live-status';
          await page.waitForFunction(([id, text]) => document.getElementById(id)?.textContent === text, [region, want.toast.text], { timeout: 5000 });
        }

        if (INPUT[sc.entry]) assert.equal(await page.locator(INPUT[sc.entry]).evaluate((n) => n.files?.length ?? 0), 0, 'the file input still holds the picked file');
        else assert.equal(await page.locator(INPUT.picker).evaluate((n) => n.value), '', 'the file input still holds a value');

        const stored = filesOf(weave, rows[sc.id].id);
        for (const n of want.landed) assert.equal(stored.filter((x) => x === n).length, 1, `${n} should be stored exactly once, stored ${JSON.stringify(stored)}`);
        for (const f of want.failed) assert.ok(!stored.includes(f.name), `${f.name} failed but is stored`);
        assert.equal(stored.length, want.landed.length, `stored ${JSON.stringify(stored)}`);
        if (sc.entry === 'doc') {
          const md = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
          assert.equal((md.match(/\/api\/files\//g) ?? []).length, want.landed.length, 'the document links a file that did not land, or misses one that did');
        } else {
          for (const n of want.landed) await page.locator('.attach-box .attach-item:not(.is-failed)', { hasText: n.slice(0, 20) }).first().waitFor({ timeout: 10_000 });
        }
        assert.deepEqual(orphans().filter((b) => !blobsBefore.includes(b)), [], 'a failed upload left an orphan blob in files/');

        if (sc.retry) {
          if (proxy) proxy.state.cut = false;
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          const name = want.failed[0].name;
          await page.locator('.attach-item.is-failed', { hasText: name.slice(0, 20) }).getByRole('button', { name: 'Retry' }).click();
          await page.waitForFunction(() => !document.querySelector('.attach-item.is-failed') && !document.querySelector('[data-upload-key][aria-busy="true"]'), null, { timeout: 30_000 });
            assert.equal(filesOf(weave, rows[sc.id].id).filter((x) => x === name).length, 1, 'Retry did not land the file');
        }
        if (proxy) assert.ok(proxy.state.cuts >= 1, 'the connection was never cut mid-body');
      } finally {
        await context.close().catch(() => {});
        await proxy?.close();
      }
    }]);
  }
  return cases;
}
