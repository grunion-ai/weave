#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const argNumber = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
export const ROWS = argNumber('--rows', 50000);
export const OWNERS = argNumber('--owners', 1000);
export const RUNS = argNumber('--runs', 20);
const WARMUPS = 2;
const STAGES = ['Open', 'Triage', 'Build', 'Review', 'Done'];
const WORDS = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Ginkgo', 'Hazel', 'Ironwood', 'Juniper', 'Katsura', 'Larch', 'Maple', 'Nutmeg', 'Oak', 'Pine', 'Quince', 'Rowan', 'Spruce', 'Teak', 'Umbrella', 'Viburnum', 'Walnut', 'Yew', 'Zelkova'];

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed(w, { rows = ROWS, owners = OWNERS } = {}) {
  const rand = prng(rows);
  w.createSpace({ name: 'Bench' });
  const owner = w.createTable({ space: 'Bench', name: 'Owner' });
  w.addField(owner.id, { name: 'Score', type: 'number' });
  const row = w.createTable({ space: 'Bench', name: 'Row' });
  w.addField(row.id, { name: 'Amount', type: 'number' });
  w.addField(row.id, { name: 'Due', type: 'date' });
  w.addField(row.id, { name: 'Stage', type: 'select', config: { options: STAGES } });
  w.addRelation(row.id, { name: 'Owner', targetDb: owner.id, cardinality: 'many-to-one', inverseName: 'Rows' });
  w.addField(owner.id, { name: 'Spend', type: 'rollup', config: { relationField: 'Rows', targetField: 'Amount', aggregate: 'sum' } });
  w.addField(row.id, { name: 'Owner name', type: 'lookup', config: { relationField: 'Owner', targetField: 'Name' } });
  w.addField(row.id, { name: 'Owner spend', type: 'lookup', config: { relationField: 'Owner', targetField: 'Spend' } });
  const ownerIds = [];
  for (let i = 0; i < owners; i++) {
    const name = `${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]} ${i}`;
    ownerIds.push(w.createEntity(owner.id, { name, values: { Score: Math.floor(rand() * 1000) } }).id);
  }
  for (let i = 0; i < rows; i++) {
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    w.createEntity(row.id, {
      name: `Row ${WORDS[Math.floor(rand() * WORDS.length)]} ${i}`,
      values: {
        Amount: Math.round(rand() * 100000) / 100,
        Due: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        Stage: STAGES[Math.floor(rand() * STAGES.length)],
        Owner: ownerIds[Math.floor(rand() * ownerIds.length)],
      },
    });
  }
  return { owner, row };
}

export function materialize(dir, opts) {
  const memory = new Weave();
  const ids = seed(memory, opts);
  const snapshot = memory.exportJSON({ blobs: false });
  const path = join(dir, 'bench.db');
  const disk = new Weave({ path });
  disk.importJSON(snapshot);
  disk.store.close?.();
  return { path, ...ids };
}

function http(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];

async function timed(port, { method, path, body }, runs = RUNS) {
  let bytes = 0;
  for (let i = 0; i < WARMUPS; i++) await http(port, method, path, body);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const res = await http(port, method, path, body);
    times.push(performance.now() - t);
    if (res.status !== 200) throw new Error(`${method} ${path} answered ${res.status}`);
    bytes = res.bytes;
  }
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95), bytes };
}

export function operations(tableId) {
  const query = (body) => ({ method: 'POST', path: `/api/tables/${tableId}/query`, body });
  return [
    ['first page (limit 50)', query({ limit: 50 })],
    ['first page, sort by lookup', query({ limit: 50, sort: [{ field: 'Owner name', dir: 'asc' }] })],
    ['where Stage = Build, sort Amount desc', query({ limit: 50, where: [['Stage', '=', 'Build']], sort: [{ field: 'Amount', dir: 'desc' }] })],
    ['first page with countAll', query({ limit: 50, countAll: true, trashCount: true })],
    ['GET /api/tables/:id schema', { method: 'GET', path: `/api/tables/${tableId}` }],
  ];
}

const mb = (n) => (n / 1048576).toFixed(1);

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'weave-bench-'));
  let server = null;
  try {
    const built = performance.now();
    const { path, row } = materialize(dir, { rows: ROWS, owners: OWNERS });
    const buildMs = performance.now() - built;
    const opened = performance.now();
    const weave = new Weave({ path });
    const loadMs = performance.now() - opened;
    ({ server } = await startServer(weave, { port: 0 }));
    const { port } = server.address();
    const before = process.memoryUsage();
    const results = [];
    for (const [label, op] of operations(row.id)) results.push({ label, ...(await timed(port, op)) });
    const after = process.memoryUsage();
    const width = Math.max(...results.map((r) => r.label.length));
    console.log(`weave query benchmark: ${ROWS} rows, ${OWNERS} owners, ${RUNS} runs per operation (build ${buildMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms)`);
    console.log(`${'operation'.padEnd(width)}  ${'p50 ms'.padStart(8)}  ${'p95 ms'.padStart(8)}  ${'bytes'.padStart(9)}`);
    for (const r of results) console.log(`${r.label.padEnd(width)}  ${r.p50.toFixed(1).padStart(8)}  ${r.p95.toFixed(1).padStart(8)}  ${String(r.bytes).padStart(9)}`);
    console.log(`RSS before ${mb(before.rss)} MB (heap ${mb(before.heapUsed)} MB), after ${mb(after.rss)} MB (heap ${mb(after.heapUsed)} MB)`);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ rows: ROWS, owners: OWNERS, runs: RUNS, buildMs, loadMs, results, rss: { before: before.rss, after: after.rss } }));
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
}
