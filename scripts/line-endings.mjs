#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { CELLS, endingPrint, proseSeed, sweepEndings } from '../test/lib/cutoff.mjs';

const { values: a } = parseArgs({ options: { cell: { type: 'string' }, density: { type: 'string' }, json: { type: 'boolean', default: false } } });
const pw = await import('playwright').catch(() => null);
if (!pw) { console.error('playwright not installed: ln -s ~/.gerrit/weave/pw/node_modules node_modules'); process.exit(2); }

const weave = new Weave();
const handles = await proseSeed(weave);
const { server } = await startServer(weave, { port: 0 });
const ctx = { ...handles, base: `http://127.0.0.1:${server.address().port}`, weave };
const findings = [];
const failed = [];
const started = performance.now();
for (const cell of a.cell ? a.cell.split(',') : Object.keys(CELLS)) {
  const { device, engine, viewport } = CELLS[cell];
  const browser = await pw[engine].launch();
  const profile = device ? (({ defaultBrowserType, ...rest }) => rest)(pw.devices[device]) : {};
  const got = await sweepEndings(browser, cell, ctx, { page: { ...profile, viewport }, ...(a.density ? { densities: a.density.split(',') } : {}) });
  findings.push(...got.findings);
  failed.push(...got.failed);
  await browser.close();
}
server.close();

const groups = new Map();
for (const f of findings) {
  const fp = endingPrint(f);
  if (!groups.has(fp)) groups.set(fp, { n: 0, f });
  groups.get(fp).n++;
}
if (a.json) console.log(JSON.stringify({ findings, failed }));
else {
  for (const [fp, { n, f }] of [...groups].sort(([x], [y]) => (x < y ? -1 : 1))) console.log(`${String(n).padStart(4)}  ${fp}  ${f.where} ${JSON.stringify(f.text)} ${f.px}px`);
  for (const f of failed) console.log(`FAILED  ${f.where} [${f.cell} ${f.density}]: ${f.error}`);
  console.log(`${findings.length} findings, ${groups.size} fingerprints, ${failed.length} failures, ${Math.round((performance.now() - started) / 1000)} s`);
}
process.exit(failed.length ? 1 : 0);
