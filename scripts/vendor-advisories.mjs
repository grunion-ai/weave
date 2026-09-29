#!/usr/bin/env node
/* Asks OSV (osv.dev, ecosystem npm) whether any vendored library in
   security/vendor.lock.json has a published advisory. Manifest scanners cannot
   see public/vendor/, so this is the check. Makes a network request: it runs in
   CI and by hand, never in `npm test`. Exit 1 on any advisory or lookup failure. */
import { fileURLToPath } from 'node:url';
import { readLock } from './vendor-lock.mjs';

const OSV = 'https://api.osv.dev/v1/querybatch';

/* Libraries OSV can answer for: an npm name and a concrete version. */
export const queryable = (lock) => lock.libraries.filter((l) => l.npm && l.version);
export const buildQueries = (libs) => libs.map((l) => ({ package: { name: l.npm, ecosystem: 'npm' }, version: l.version }));

/* results[i] answers libs[i]; returns one row per library. */
export function toRows(libs, results) {
  return libs.map((l, i) => ({ name: l.npm, version: l.version, ids: (results[i]?.vulns || []).map((v) => v.id) }));
}
export const table = (rows) => ['package'.padEnd(16) + 'version'.padEnd(10) + 'advisories',
  ...rows.map((r) => r.name.padEnd(16) + r.version.padEnd(10) + (r.ids.length ? r.ids.join(', ') : 'none'))].join('\n');

export async function main() {
  const lock = readLock();
  const libs = queryable(lock);
  const res = await fetch(OSV, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries: buildQueries(libs) }),
  });
  if (!res.ok) throw new Error(`OSV answered ${res.status}`);
  const { results } = await res.json();
  if (results.length !== libs.length) throw new Error(`OSV returned ${results.length} results for ${libs.length} queries`);
  const rows = toRows(libs, results);
  console.log(table(rows));
  for (const l of lock.libraries.filter((x) => !queryable(lock).includes(x))) console.log(`skipped ${l.name}: ${l.npm ? 'no version recorded' : 'not an npm package'}`);
  return rows.some((r) => r.ids.length) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { console.error('vendor-advisories:', e.message); process.exit(1); });
}
