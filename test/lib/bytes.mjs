import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { request } from 'node:http';

export const BUDGET_FILE = 'test/byte-budget.json';
export const CODINGS = ['gzip', 'br'];
export const fit = (n) => Math.ceil(n * 1.05);
const count = (n) => n.toLocaleString('en-US');
const sized = (n) => `${count(n)} bytes`;

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

export function budgetUpdate(before, measured, { why = '' } = {}) {
  const was = before?.bytes ?? {};
  const order = [...Object.keys(was).filter((path) => path in measured),
    ...Object.keys(measured).filter((path) => !(path in was)).sort()];
  const bytes = {};
  const changes = [];
  const refusals = [];
  const grew = [];
  for (const path of order) {
    bytes[path] = {};
    for (const coding of CODINGS) {
      const n = measured[path][coding];
      const cap = was[path]?.[coding];
      if (cap === undefined) {
        bytes[path][coding] = fit(n);
        changes.push(`add bytes["${path}"].${coding} at ${sized(fit(n))}`);
      } else if (n > cap) {
        if (!String(why).trim()) {
          bytes[path][coding] = cap;
          refusals.push(`${path} (${coding}) serves ${sized(n)} against a budget of ${sized(cap)}: pass --why "<reason>" to raise it`);
        } else {
          bytes[path][coding] = fit(n);
          grew.push(path);
          changes.push(`raise bytes["${path}"].${coding} from ${count(cap)} to ${sized(fit(n))}`);
        }
      } else if (cap > n * 1.1) {
        bytes[path][coding] = fit(n);
        changes.push(`lower bytes["${path}"].${coding} from ${count(cap)} to ${sized(fit(n))}`);
      } else {
        bytes[path][coding] = cap;
      }
    }
  }
  const raised = {};
  for (const [path, reason] of Object.entries(before?.raised ?? {})) if (path in bytes) raised[path] = reason;
  for (const path of grew) raised[path] = String(why).trim();
  for (const path of Object.keys(was)) {
    if (!(path in bytes)) changes.push(`drop bytes["${path}"], which public no longer serves`);
  }
  return { bytes, raised, changes, refusals };
}

const asked = (port, path, encoding) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, headers: { 'Accept-Encoding': encoding } }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; });
    res.on('end', () => resolve({ status: res.statusCode, coding: res.headers['content-encoding'] ?? null, bytes: n }));
  });
  req.on('error', reject);
  req.end();
});

export async function servedBytes(port, path, { tries = 600, wait = 50 } = {}) {
  const gzip = await asked(port, path, 'gzip');
  if (gzip.status !== 200) throw new Error(`${path} answered ${gzip.status}, not 200`);
  let br = await asked(port, path, 'br, gzip');
  for (let i = 0; br.coding === 'gzip' && i < tries; i++) {
    await new Promise((done) => setTimeout(done, wait));
    br = await asked(port, path, 'br, gzip');
  }
  if (br.coding === 'gzip') throw new Error(`${path} never came back as Brotli`);
  return { gzip: gzip.bytes, br: br.bytes };
}
