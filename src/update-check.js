import { readFileSync, writeFileSync } from 'node:fs';

export const RELEASES_URL = 'https://api.github.com/repos/grunion-ai/weave/releases/latest';
const DAY = 24 * 60 * 60 * 1000;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function updateCheckFromEnv(env = process.env) {
  return !['0', 'off', 'false', 'no'].includes(String(env.WEAVE_UPDATE_CHECK ?? '').trim().toLowerCase());
}

export function newerVersion(a, b) {
  const x = SEMVER.exec(a), y = SEMVER.exec(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
  return false;
}

export function createReleaseCheck({ version, enabled = true, cacheFile = null, fetch = globalThis.fetch, now = Date.now, timeoutMs = 4000, interval = DAY } = {}) {
  let state = { latest: null, checkedAt: 0, attemptedAt: 0 };
  if (cacheFile) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (SEMVER.test(c.latest ?? '') && Number.isFinite(c.checkedAt)) state = { latest: c.latest, checkedAt: c.checkedAt, attemptedAt: c.version === version ? Number(c.attemptedAt) || c.checkedAt : 0 };
    } catch {}
  }
  let inflight = null;
  const save = () => {
    if (!cacheFile) return;
    try { writeFileSync(cacheFile, JSON.stringify({ ...state, version })); } catch {}
  };
  function refresh() {
    if (!enabled) return Promise.resolve();
    if (inflight) return inflight;
    if (state.attemptedAt && now() - state.attemptedAt < interval) return Promise.resolve();
    state.attemptedAt = now();
    const ac = new AbortController();
    const cutoff = setTimeout(() => ac.abort(new Error(`no answer from ${RELEASES_URL} in ${timeoutMs}ms`)), timeoutMs);
    inflight = (async () => {
      try {
        const res = await fetch(RELEASES_URL, {
          method: 'GET',
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'weave' },
          signal: ac.signal,
        });
        if (!res.ok) return;
        const tag = String((await res.json())?.tag_name ?? '').replace(/^v/, '');
        if (!SEMVER.test(tag)) return;
        state.latest = tag;
        state.checkedAt = state.attemptedAt;
      } catch {} finally {
        clearTimeout(cutoff);
        save();
        inflight = null;
      }
    })();
    return inflight;
  }
  function status() {
    if (!enabled) return null;
    refresh();
    if (!state.latest) return null;
    const latest = newerVersion(version, state.latest) ? version : state.latest;
    return { latestRelease: latest, releaseCheckedAt: new Date(state.checkedAt).toISOString(), releaseBehind: newerVersion(latest, version) };
  }
  return { status, refresh };
}
