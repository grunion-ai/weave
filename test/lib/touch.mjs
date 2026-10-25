export const CEILING_FILE = 'test/touch-ceiling.json';

export const touchKey = (surface, label) => `${surface} | ${String(label).split(' ')[0]}`;

export function tallyMisses(surface, small) {
  const out = {};
  for (const c of small) {
    const k = touchKey(surface, c.label);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function overCeiling(seen, ceiling) {
  return Object.entries(seen)
    .filter(([k, n]) => n > (ceiling[k] ?? 0))
    .map(([k, n]) => ({ key: k, seen: n, ceiling: ceiling[k] ?? 0 }));
}

export function unexplainedRaises(before, after) {
  const was = before?.misses ?? {};
  const why = after.raised ?? {};
  return Object.entries(after.misses ?? {})
    .filter(([k, n]) => n > (was[k] ?? 0))
    .filter(([k]) => !String(why[k] ?? '').trim() || why[k] === before?.raised?.[k])
    .map(([k, n]) => `${k} rose from ${was[k] ?? 0} to ${n} controls under the 44px hit area with no reason: write one under raised["${k}"]`);
}
