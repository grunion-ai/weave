import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const BUDGET_FILE = 'test/byte-budget.json';
export const CODINGS = ['gzip', 'br'];
export const fit = (n) => Math.ceil(n * 1.05);
const sized = (n) => `${n.toLocaleString('en-US')} bytes`;

export function firstPartyAssets(publicDir) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'vendor' && dir === publicDir ? [] : walk(full);
    return /\.(?:m?js|css)$/.test(d.name) ? [`/${relative(publicDir, full)}`] : [];
  });
  return walk(publicDir).sort();
}

export function judge(path, coding, n, budget) {
  const cap = budget[path]?.[coding];
  if (cap === undefined) return `${path} (${coding}) has no byte budget: add "${path}": { "${coding}": ${fit(n)} } to ${BUDGET_FILE}`;
  if (n > cap) return `${path} (${coding}) serves ${sized(n)}, budget ${sized(cap)}: shrink it, or raise bytes["${path}"].${coding} in ${BUDGET_FILE} and write why under raised["${path}"]`;
  if (cap > n * 1.1) return `${path} (${coding}) serves ${sized(n)}, budget ${sized(cap)}: lower bytes["${path}"].${coding} in ${BUDGET_FILE} to ${fit(n)} in this change so the saving holds`;
  return null;
}

export function unexplainedRaises(before, after) {
  const was = before?.bytes ?? {};
  const why = after.raised ?? {};
  return Object.entries(after.bytes).flatMap(([path, sizes]) => CODINGS
    .filter((c) => was[path]?.[c] !== undefined && sizes[c] > was[path][c])
    .filter(() => !String(why[path] ?? '').trim() || why[path] === before?.raised?.[path])
    .map((c) => `${path} (${c}) rose from ${was[path][c]} to ${sizes[c]} bytes with no reason: write one under raised["${path}"]`));
}
