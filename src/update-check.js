import { readFileSync, writeFileSync } from 'node:fs';

/* ---------- newer release check (Issue #253, Kyle, 2026-09-28) ----------
   Every landed version is a tag and a GitHub Release, but a running instance
   only compared itself with main's sha, and a plain clone or a source zip
   never learned a release existed. The server asks GitHub for the latest
   release at most once a day, compares it with its own package version, and
   /api/health carries {latestRelease, releaseCheckedAt, releaseBehind}.

   One unauthenticated GET, no token, nothing about the install beyond what
   any HTTP client sends. The answer and the time of the last try live in a
   small JSON file, so a restart inside the day asks nothing. Every failure
   (offline, a rate limit, a malformed answer, a timeout) is silent and leaves
   the previous answer standing. WEAVE_UPDATE_CHECK=off makes no request. */
export const RELEASES_URL = 'https://api.github.com/repos/grunion-ai/weave/releases/latest';
const DAY = 24 * 60 * 60 * 1000;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function updateCheckFromEnv(env = process.env) {
  return !['0', 'off', 'false', 'no'].includes(String(env.WEAVE_UPDATE_CHECK ?? '').trim().toLowerCase());
}

/* true when a is a strictly higher x.y.z than b */
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
      /* The file sits on the volume and outlives a redeploy: an answer another
         version wrote keeps its figure but is asked again at boot (Issue #606). */
      if (SEMVER.test(c.latest ?? '') && Number.isFinite(c.checkedAt)) state = { latest: c.latest, checkedAt: c.checkedAt, attemptedAt: c.version === version ? Number(c.attemptedAt) || c.checkedAt : 0 };
    } catch { /* missing or unreadable: ask again */ }
  }
  let inflight = null;
  const save = () => {
    if (!cacheFile) return;
    try { writeFileSync(cacheFile, JSON.stringify({ ...state, version })); } catch { /* read-only data dir: the in-memory answer still counts */ }
  };
  function refresh() {
    if (!enabled) return Promise.resolve();
    if (inflight) return inflight;
    if (state.attemptedAt && now() - state.attemptedAt < interval) return Promise.resolve();
    state.attemptedAt = now();
    /* Not AbortSignal.timeout: its timer is unref'd, so the cut-off landed only while
       something else held the event loop open. A real socket does; an injected fetch
       that just hangs does not, and the loop drained before the abort (Issue #563).
       This timer is ref'd and cleared on every path below. */
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
      } catch { /* offline, timed out or malformed: nothing changes */ } finally {
        clearTimeout(cutoff);
        save();
        inflight = null;
      }
    })();
    return inflight;
  }
  function status() {
    if (!enabled) return null;
    refresh(); // never awaited: a health call answers with what is known now
    if (!state.latest) return null;
    /* Every version is tagged as it lands, so a build ahead of the answer is
       itself the newest release: never report one older than this (Issue #606). */
    const latest = newerVersion(version, state.latest) ? version : state.latest;
    return { latestRelease: latest, releaseCheckedAt: new Date(state.checkedAt).toISOString(), releaseBehind: newerVersion(latest, version) };
  }
  return { status, refresh };
}
