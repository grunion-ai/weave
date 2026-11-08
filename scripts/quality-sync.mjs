import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scanSuites, planQualityMirror, caseResults } from '../src/quality-mirror.js';

const ROOT = resolve(import.meta.dirname, '..');

export function http(base, token, fetchImpl = fetch) {
  const root = base.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return async (method, path, body) => {
    const res = await fetchImpl(`${root}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) throw new Error(`${method} ${root}${path} answered ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

async function readAll(call, qualified) {
  const items = [];
  for (let offset = 0; ; offset += 500) {
    const page = await call('POST', `/api/tables/${encodeURIComponent(qualified)}/query`, { limit: 500, offset });
    items.push(...page.items);
    if (!page.items.length || items.length >= page.total) return { items, dbId: page.items[0]?.dbId };
  }
}

export async function readMirror(call) {
  const ws = await call('GET', '/api/workspace');
  if (ws.name !== 'weave') throw new Error(`the tracker is the '${ws.name}' workspace, not weave`);
  const suites = await readAll(call, 'Quality/Suite');
  const cases = await readAll(call, 'Quality/Case');
  const byPublic = new Map(suites.items.map((s) => [s.publicId, s.id]));
  const rows = new Map(suites.items.map((s) => [s.id, { id: s.id, publicId: s.publicId, name: s.name, file: s.fields.File, cases: [] }]));
  for (const c of cases.items) {
    const suite = c.fields.Suite?.id ?? byPublic.get(c.fields.Suite?.publicId);
    rows.get(suite)?.cases.push({ id: c.id, name: c.name, status: c.fields.Status });
  }
  return { rows: [...rows.values()], suiteTable: suites.dbId, caseTable: cases.dbId };
}

export function readResults(dir) {
  const shards = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, String(f)), 'utf8')))
    .filter((r) => Array.isArray(r.summaries));
  return caseResults(shards);
}

export async function apply(call, ops, { suiteTable, caseTable }) {
  const create = (table, values) => call('POST', `/api/tables/${table}/entities`, { values });
  for (const o of ops) {
    if (o.op === 'createSuite') {
      const row = await create(suiteTable, { Name: o.name, File: o.file });
      for (const c of o.cases) await create(caseTable, { Name: c.name, Suite: row.id, ...(c.status ? { Status: c.status } : {}) });
    } else if (o.op === 'createCase') await create(caseTable, { Name: o.name, Suite: o.suite, ...(o.status ? { Status: o.status } : {}) });
    else if (o.op === 'rename') await call('PATCH', `/api/entities/${o.id}`, { values: { Name: o.name } });
    else if (o.op === 'status') await call('PATCH', `/api/entities/${o.id}`, { values: { Status: o.status } });
    else await call('DELETE', `/api/entities/${o.id}?hard=1`);
  }
}

export const drift = (s) => s.createdSuites + s.createdCases + s.removedSuites + s.removedCases + s.renamedSuites + s.missingFiles.length;

async function main() {
  const { values } = parseArgs({ options: { from: { type: 'string' }, 'token-env': { type: 'string' }, results: { type: 'string' }, check: { type: 'boolean' } } });
  if (!values.from) throw new Error('quality-sync needs --from <workspace base URL>');
  const call = http(values.from, values['token-env'] ? process.env[values['token-env']] : null);
  const results = values.results ? readResults(values.results) : null;
  const scanned = scanSuites(ROOT);
  const mirror = await readMirror(call);
  const { ops, summary } = planQualityMirror(mirror.rows, scanned, results);
  console.log(JSON.stringify({ planned: summary }));
  if (values.check) { process.exitCode = drift(summary) ? 1 : 0; return; }
  await apply(call, ops, mirror);
  const after = planQualityMirror((await readMirror(call)).rows, scanned, results).summary;
  console.log(JSON.stringify({ after }));
  if (drift(after) || after.statusChanges) throw new Error('the Quality mirror still drifts from the test tree after the sync');
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
