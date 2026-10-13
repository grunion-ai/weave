import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTEXT = 'dev-soak';
export const REPO = 'grunion-ai/weave';
export const DEFAULTS = {
  base: 'https://dev.weave.grunion.ai',
  workspace: '/w/weave',
  writeWorkspace: '/w/smoke',
  soakMs: 15 * 60_000,
  smokeEveryMs: 3 * 60_000,
  healthEveryMs: 30_000,
  graceMs: 5 * 60_000,
  max5xx: 0,
  maxMisses: 3,
};

export const short = (sha) => String(sha ?? '').slice(0, 10);

export function judge(health, { sha, first = null }) {
  const sup = health?.supervisor;
  if (!health?.ok || !sup) return { verdict: 'fail', reason: 'dev /api/health has no supervisor block' };
  if (sup.commit !== sha) {
    if (sup.lastSwap?.rollback) return { verdict: 'fail', reason: `dev rolled back to ${short(sup.commit)}: ${sup.lastSwap.rollback}` };
    return { verdict: 'moved', reason: `dev serves ${short(sup.commit)}, not ${short(sha)}` };
  }
  const watch = sup.watch;
  if (!watch || watch.release !== `c${sha}`) return { verdict: 'fail', reason: `dev shows no watch for c${short(sha)}` };
  if (watch.alert) return { verdict: 'fail', reason: `watch alert: ${watch.alert}` };
  if (watch.ok === false) return { verdict: 'fail', reason: `watch failed: ${watch.reason ?? 'no reason given'}` };
  if (first && (sup.pid !== first.pid || sup.since !== first.since)) return { verdict: 'fail', reason: `worker restarted (pid ${first.pid} -> ${sup.pid})` };
  return watch.ok === true ? { verdict: 'ok', reason: 'watch passed' } : { verdict: 'watching', reason: `watching until ${watch.until}` };
}

export function describe(outcome) {
  const text = outcome.state === 'success'
    ? `${outcome.rounds} smokes over ${Math.round(outcome.ms / 60_000)} min${outcome.retries ? ` (${outcome.retries} retried)` : ''}, watch passed, ${outcome.fivexx} 5xx`
    : outcome.reason;
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export async function soak({ sha, io, clock, cfg = DEFAULTS }) {
  const start = clock.now();
  let first = null;
  let fivexx = 0;
  let rounds = 0;
  let misses = 0;
  let retries = 0;
  let nextSmoke = start;
  const end = (state, reason) => ({ state, reason, rounds, retries, fivexx, ms: clock.now() - start });
  for (;;) {
    if (clock.now() >= nextSmoke && clock.now() - start < cfg.soakMs) {
      let smoke = await io.smoke();
      rounds++;
      fivexx += smoke.fivexx ?? 0;
      if (!smoke.ok) {
        io.log(`smoke ${rounds} failed at ${smoke.step} (${smoke.error}); retrying once`);
        retries++;
        smoke = await io.smoke();
        fivexx += smoke.fivexx ?? 0;
        if (!smoke.ok) return end('failure', `smoke ${rounds} failed at ${smoke.step} twice: ${smoke.error}`);
      }
      nextSmoke = start + rounds * cfg.smokeEveryMs;
    }
    const health = await io.health();
    if (health.status >= 500) fivexx++;
    if (fivexx > cfg.max5xx) return end('failure', `${fivexx} 5xx responses from dev during the soak`);
    if (health.status !== 200 || !health.body) {
      misses++;
      if (misses >= cfg.maxMisses) return end('failure', `dev /api/health failed ${misses} times in a row (${health.error ?? health.status})`);
    } else {
      misses = 0;
      const j = judge(health.body, { sha, first });
      if (j.verdict === 'moved') {
        const head = await io.mainHead();
        return head && head !== sha ? end('superseded', `main moved to ${short(head)}; ${j.reason}`) : end('failure', j.reason);
      }
      if (j.verdict === 'fail') return end('failure', j.reason);
      first ??= health.body.supervisor;
      const elapsed = clock.now() - start;
      if (elapsed >= cfg.soakMs && rounds > 0 && j.verdict === 'ok') return end('success', j.reason);
      if (elapsed >= cfg.soakMs + cfg.graceMs) return end('failure', `watch still open ${Math.round(elapsed / 60_000)} min after the swap`);
    }
    const now = clock.now();
    const due = Math.min(now - start < cfg.soakMs ? nextSmoke : Infinity, now + cfg.healthEveryMs);
    await clock.sleep(Math.max(1_000, due - now));
  }
}

export async function report({ sha, outcome, io }) {
  if (outcome.state === 'superseded') {
    io.log(`dev-soak ${short(sha)}: superseded, ${outcome.reason}; the newer commit's run posts its own status`);
    return null;
  }
  const status = { state: outcome.state, context: CONTEXT, description: describe(outcome), target_url: io.runUrl };
  await io.status(sha, status);
  if (outcome.state !== 'success') await io.alert(`weave dev-soak: ${short(sha)} failed: ${outcome.reason} ${io.runUrl ?? ''}`.trim());
  return status;
}

export async function smoke(page, { base, workspace, writeWorkspace, token }) {
  const ws = `${base}${workspace}`;
  let step = 'load';
  const counted = { fivexx: 0 };
  page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 500) counted.fivexx++; });
  const api = async (method, url, data) => {
    const r = await page.request.fetch(url, { method, data, timeout: 20_000 });
    if (r.status() >= 500) counted.fivexx++;
    if (!r.ok()) throw new Error(`${method} ${url.slice(base.length)} answered ${r.status()}`);
    return r.json();
  };
  try {
    await page.goto(`${ws}/#/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('#main', { timeout: 20_000 });
    step = 'open workspace';
    const tables = await api('GET', `${ws}/api/tables`);
    if (!Array.isArray(tables) || !tables.length) throw new Error('the workspace lists no tables');
    step = 'open table';
    let picked = null;
    for (const t of tables.slice(0, 8)) {
      const q = await api('POST', `${ws}/api/tables/${t.id}/query`, { limit: 5 });
      const row = q.items?.find((e) => typeof e.doc === 'string' && e.doc.trim());
      if (row) { picked = { table: t, row }; break; }
    }
    if (!picked) throw new Error('no table in the first eight holds a row with a document');
    await page.goto(`${ws}/#/table/${picked.table.id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.wv-grid tbody tr.entity-row', { timeout: 20_000 });
    step = 'open document';
    await page.evaluate((id) => { location.hash = `#/entity/${id}`; }, picked.row.id);
    await page.waitForFunction(() => [...document.querySelectorAll('.doc-editor .vditor-reset')].some((e) => e.textContent.trim().length > 0), null, { timeout: 20_000 });
    if (token) {
      step = 'create row';
      const wws = `${base}${writeWorkspace}`;
      const writable = await api('GET', `${wws}/api/tables`);
      const table = writable.find((t) => !t.system);
      if (!table) throw new Error(`${writeWorkspace} has no table to write to`);
      const made = await api('POST', `${wws}/api/tables/${table.id}/entities`, { Name: `dev-smoke ${new Date().toISOString()}` });
      await page.goto(`${wws}/#/table/${table.id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector(`tr[data-eid="${made.id}"]`, { timeout: 20_000 });
      step = 'delete row';
      await api('DELETE', `${wws}/api/entities/${made.id}?hard=1`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#main', { timeout: 20_000 });
      await page.waitForSelector(`tr[data-eid="${made.id}"]`, { state: 'detached', timeout: 20_000 });
    }
    return { ok: true, fivexx: counted.fivexx, steps: token ? 6 : 4 };
  } catch (error) {
    return { ok: false, step, error: error.message.split('\n')[0], fivexx: counted.fivexx };
  }
}

export function config(env = process.env) {
  const num = (v, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    ...DEFAULTS,
    base: (env.DEV_BASE_URL || DEFAULTS.base).replace(/\/$/, ''),
    workspace: env.DEV_SMOKE_READ_WORKSPACE || DEFAULTS.workspace,
    writeWorkspace: env.DEV_SMOKE_WORKSPACE || DEFAULTS.writeWorkspace,
    soakMs: num(env.DEV_SOAK_MS, DEFAULTS.soakMs),
    smokeEveryMs: num(env.DEV_SOAK_EVERY_MS, DEFAULTS.smokeEveryMs),
    max5xx: num(env.DEV_SOAK_MAX_5XX, DEFAULTS.max5xx),
  };
}

function realIO(cfg, env = process.env) {
  const repo = env.GITHUB_REPOSITORY || REPO;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const gh = async (path, init = {}) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} answered ${r.status}`);
    return r.json();
  };
  let browser = null;
  const smokeToken = env.DEV_SMOKE_TOKEN || '';
  return {
    runUrl,
    log: (line) => console.log(line),
    health: async () => {
      try {
        const r = await fetch(`${cfg.base}/api/health`, { signal: AbortSignal.timeout(10_000), headers: { 'Cache-Control': 'no-cache' } });
        return { status: r.status, body: r.ok ? await r.json() : null };
      } catch (error) { return { status: 0, error: error.message }; }
    },
    smoke: async () => {
      const { chromium } = await import('playwright');
      browser ??= await chromium.launch();
      const context = await browser.newContext({ extraHTTPHeaders: smokeToken ? { Authorization: `Bearer ${smokeToken}` } : {} });
      try {
        const page = await context.newPage();
        const result = await smoke(page, { ...cfg, token: smokeToken });
        console.log(`smoke: ${JSON.stringify(result)}`);
        return result;
      } finally { await context.close(); }
    },
    mainHead: async () => (await gh('/commits/main')).sha,
    status: async (sha, body) => { await gh(`/statuses/${sha}`, { method: 'POST', body: JSON.stringify(body) }); console.log(`posted ${body.context} ${body.state} on ${sha}: ${body.description}`); },
    alert: async (line) => {
      console.log(`::warning::${line}`);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
      if (env.SHERIFF_ALERT_URL) await fetch(env.SHERIFF_ALERT_URL, { method: 'POST', body: line, signal: AbortSignal.timeout(10_000) }).catch((e) => console.log(`alert post failed: ${e.message}`));
    },
    close: async () => { await browser?.close(); },
  };
}

const realClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

async function main() {
  const [mode = 'soak', arg] = process.argv.slice(2);
  const cfg = config();
  const io = realIO(cfg);
  try {
    if (mode === 'smoke') {
      const result = await io.smoke();
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const sha = process.env.DEV_SOAK_SHA || arg;
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Expected DEV_SOAK_SHA or a 40-character commit argument');
    let outcome;
    try { outcome = await soak({ sha, io, clock: realClock, cfg }); } catch (error) { outcome = { state: 'failure', reason: `soak crashed: ${error.message}`, rounds: 0, fivexx: 0, ms: 0 }; }
    console.log(JSON.stringify(outcome));
    await report({ sha, outcome, io });
    if (outcome.state === 'failure') process.exitCode = 1;
  } finally { await io.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
