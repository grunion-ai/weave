import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { BUDGET_FILE, budgetUpdate, firstPartyAssets, servedBytes } from '../test/lib/bytes.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const write = argv.includes('--write');
const why = argv.find((a) => a.startsWith('--why='))?.slice(6)
  ?? (argv.includes('--why') ? argv[argv.indexOf('--why') + 1] ?? '' : '');

const file = join(ROOT, BUDGET_FILE);
const before = JSON.parse(readFileSync(file, 'utf8'));
const { server, port } = await startServer(new Weave(), { port: 0 });
const measured = {};
try {
  for (const path of firstPartyAssets(join(ROOT, 'public'))) measured[path] = await servedBytes(port, path);
} finally {
  await new Promise((done) => { server.close(done); server.closeAllConnections(); });
}

const next = budgetUpdate(before, measured, { why });
for (const line of next.changes) console.log(line);
for (const line of next.refusals) console.error(line);
if (!next.changes.length && !next.refusals.length) console.log(`${BUDGET_FILE} already holds what every asset serves`);
if (write && !next.refusals.length) {
  writeFileSync(file, `${JSON.stringify({ ...before, bytes: next.bytes, raised: next.raised }, null, 2)}\n`);
  console.log(`wrote ${BUDGET_FILE}`);
} else if (next.changes.length && !write) {
  console.log('run again with --write to apply, and --why "<reason>" to raise a budget');
}
process.exitCode = next.refusals.length ? 1 : 0;
