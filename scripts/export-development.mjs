#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Weave } from '../src/engine.js';
import { openSecurityCitations } from './changelog-fold.mjs';

const KEPT_DOMAINS = new Set(['grunion.ai']);
const TABLES = { issues: 'Development/Issue', features: 'Development/Feature', releases: 'Development/Release' };

export const scrub = (text) => String(text)
  .replace(/\/Users\/[^/\s`'"]+(?=\/|\b)/g, '~')
  .replace(/[\w.+-]+@([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi, (m, domain) => (KEPT_DOMAINS.has(domain.toLowerCase()) ? m : '<email removed>'));

const scrubValue = (v) => (typeof v === 'string' ? scrub(v) : Array.isArray(v) ? v.map(scrubValue) : v);
export const scrubRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, scrubValue(v)]));

export function readFileTracker(source) {
  const w = new Weave({ path: source });
  try {
    if (w.state.meta.name !== 'weave') throw new Error(`${source} is the '${w.state.meta.name}' workspace, not the canonical weave docs workspace`);
    const read = (qualified) => {
      const db = w.listTables().find((t) => `${w.getSpace(t.spaceId)?.name}/${t.name}` === qualified);
      if (!db) throw new Error(`No ${qualified} table in ${source}`);
      return w.listEntities(db.id).map((e) => ({ ...w.readEntity(e.id), publicId: e.publicId }));
    };
    return Object.fromEntries(Object.entries(TABLES).map(([k, q]) => [k, read(q)]));
  } finally {
    w.store.close?.();
  }
}

export async function readHttpTracker(base, token, { fetchImpl = fetch, pageSize = 500 } = {}) {
  const root = base.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${root}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`${root}${path} answered ${res.status}`);
    return res.json();
  };
  const ws = await call('/api/workspace');
  if (ws.name !== 'weave') throw new Error(`${root} is the '${ws.name}' workspace, not the canonical weave docs workspace`);
  const read = async (qualified) => {
    const items = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await call(`/api/tables/${encodeURIComponent(qualified)}/query`, { method: 'POST', body: JSON.stringify({ limit: pageSize, offset }) });
      items.push(...page.items);
      if (!page.items.length || items.length >= page.total) return items;
    }
  };
  const out = {};
  for (const [k, q] of Object.entries(TABLES)) out[k] = await read(q);
  return out;
}

const rows = (items, fields, relations = []) => items
  .filter((e) => e.name)
  .map((e) => {
    const row = { name: e.name };
    for (const f of fields) if (e.fields[f] != null && e.fields[f] !== '') row[f.toLowerCase()] = e.fields[f];
    for (const r of relations) {
      const linked = (e.fields[r] ?? []).map((x) => x.name ?? x).filter(Boolean);
      if (linked.length) row[r.toLowerCase()] = linked;
    }
    const doc = e.docs?.Description ?? '';
    if (doc) row.description = doc;
    return scrubRow(row);
  });

export function buildManifest(tracker, { version, generatedAt, fragments = [] }) {
  const manifest = {
    version,
    generatedAt,
    issues: rows(tracker.issues, ['Status', 'Severity', 'Symptom']),
    features: rows(tracker.features, ['Status', 'Milestone']),
    releases: rows(tracker.releases, ['Date', 'Commit'], ['Fixes', 'Ships']),
  };
  for (const r of manifest.releases) {
    if (!(r.description ?? '').trim()) throw new Error(`Release ${r.name} has no notes — write them in the weave workspace first`);
  }
  if (!manifest.releases.some((r) => r.name === `v${version}`)) {
    throw new Error(`No Development/Release row named v${version} — create it with notes before exporting`);
  }
  const issues = tracker.issues.map((r) => ({ number: r.publicId, name: r.name, status: r.fields.Status }));
  const cited = openSecurityCitations(fragments, issues);
  if (cited.length) {
    throw new Error(`${cited.join('\n')}\nGive that work its own Issue or Feature row and cite it instead; the finding's number stays with the finding.`);
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: { from: { type: 'string' }, 'token-env': { type: 'string' }, out: { type: 'string' } },
  });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const generatedAt = new Date(Number.isFinite(epoch) && process.env.SOURCE_DATE_EPOCH ? epoch * 1000 : Date.now()).toISOString();
  const fragDir = join(root, 'changelog.d');
  const fragments = (existsSync(fragDir) ? readdirSync(fragDir).filter((n) => n.endsWith('.md')) : [])
    .map((name) => ({ name, text: readFileSync(join(fragDir, name), 'utf8') }));
  let manifest;
  try {
    if (opts['token-env'] && !opts.from) throw new Error('--token-env reads a bearer token for --from; pass --from <workspace base url>');
    if (opts['token-env'] && !process.env[opts['token-env']]) throw new Error(`--token-env ${opts['token-env']}: that variable is empty`);
    const tracker = opts.from
      ? await readHttpTracker(opts.from, opts['token-env'] ? process.env[opts['token-env']] : null)
      : readFileTracker(positionals[0] ?? join(homedir(), '.weave', 'weave.db'));
    manifest = buildManifest(tracker, { version: pkg.version, generatedAt, fragments });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const out = opts.out ? resolve(opts.out) : join(root, 'docs', 'development.json');
  writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
  console.log(`${out}: ${manifest.issues.length} issues, ${manifest.features.length} features, ${manifest.releases.length} releases (v${manifest.version})`);
}
