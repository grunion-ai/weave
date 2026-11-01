#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_HOST = 'https://dev.weave.grunion.ai';
export const DEFAULT_TIMEOUT_S = 900;
export const POLL_MS = 10_000;

const SHA = /^[0-9a-f]{7,40}$/;
const bare = (release) => String(release ?? '').replace(/^c/, '');

export function matches(health, sha) {
  const want = String(sha ?? '').toLowerCase();
  const sup = health?.supervisor;
  if (!SHA.test(want) || typeof sup?.commit !== 'string') return false;
  if (!sup.commit.toLowerCase().startsWith(want)) return false;
  const swap = sup.lastSwap;
  return !(swap && swap.ok === false && bare(swap.to).toLowerCase().startsWith(want));
}

export function parseArgs(argv) {
  const out = { sha: null, host: DEFAULT_HOST, timeoutMs: DEFAULT_TIMEOUT_S * 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') out.host = argv[++i];
    else if (a === '--timeout') {
      const s = Number(argv[++i]);
      if (!Number.isFinite(s) || s <= 0) throw new Error('--timeout takes a positive number of seconds');
      out.timeoutMs = s * 1000;
    } else out.sha = a;
  }
  if (!SHA.test(String(out.sha ?? '').toLowerCase())) throw new Error('Usage: verify-dev.mjs <sha of 7 to 40 hex characters> [--host <url>] [--timeout <seconds>]');
  if (!out.host) throw new Error('--host takes a URL');
  return out;
}

export async function verify({ sha, host = DEFAULT_HOST, timeoutMs = DEFAULT_TIMEOUT_S * 1000, fetch = globalThis.fetch, clock }) {
  const url = `${host.replace(/\/+$/, '')}/api/health`;
  const start = clock.now();
  let last = null;
  for (;;) {
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(POLL_MS) });
      last = r.ok ? await r.json() : { status: r.status };
    } catch (error) {
      last = { error: error.message };
    }
    if (matches(last, sha)) return { ok: true, health: last };
    const left = timeoutMs - (clock.now() - start);
    if (left <= 0) return { ok: false, health: last };
    await clock.sleep(Math.min(POLL_MS, left));
  }
}

const realClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = await verify({ ...args, clock: realClock });
  if (out.ok) {
    const sup = out.health.supervisor;
    console.log(JSON.stringify({ ok: true, host: args.host, sha: args.sha, commit: sup.commit, release: sup.release, since: sup.since, lastSwap: sup.lastSwap ?? null }));
    return;
  }
  console.error(JSON.stringify(out.health));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
