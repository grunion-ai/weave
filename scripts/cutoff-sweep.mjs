#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { JOURNEYS } from '../test/lib/journeys.mjs';
import { OVERLAYS } from '../test/lib/overlays.mjs';
import { CELLS, PLATFORM, fingerprint, lower, ratchet, sectionOf, seed, sweepCell, tally } from '../test/lib/cutoff.mjs';

const BASELINE = new URL('../test/cutoff-baseline.json', import.meta.url);
const { values: a } = parseArgs({ options: {
  out: { type: 'string', default: 'cutoff-out' },
  cell: { type: 'string' },
  journey: { type: 'string' },
  overlay: { type: 'string' },
  lower: { type: 'boolean', default: false },
} });
const pw = await import('playwright').catch(() => null);
if (!pw) { console.error('playwright not installed: ln -s ~/.gerrit/weave/pw/node_modules node_modules'); process.exit(2); }

const pick = (list, csv) => (csv ? list.filter((x) => csv.split(',').includes(x.name)) : list);
const journeys = pick(JOURNEYS, a.journey ?? (a.overlay ? '-' : null));
const overlays = pick(OVERLAYS, a.overlay ?? (a.journey ? '-' : null));
const wanted = a.cell ? a.cell.split(',') : Object.keys(CELLS);
const out = resolve(a.out);
mkdirSync(out, { recursive: true });

const started = performance.now();
const weave = new Weave();
const handles = await seed(weave);
const { server } = await startServer(weave, { port: 0 });
const base = `http://127.0.0.1:${server.address().port}`;
const ctx = { ...handles, base, weave };
const browsers = new Map();
const engine = async (name) => {
  if (!browsers.has(name)) browsers.set(name, await pw[name].launch().catch((err) => ({ err })));
  return browsers.get(name);
};

const cells = [];
const findings = [];
const failed = [];
const timings = [];
try {
  for (const name of wanted) {
    const { device, engine: want, viewport } = CELLS[name];
    const profile = device ? (({ defaultBrowserType, ...rest }) => rest)(pw.devices[device]) : {};
    let browser = await engine(want);
    let fallback = '';
    if (browser.err) {
      fallback = `${want} could not launch (${String(browser.err.message).split('\n')[0]}); walked chromium with the ${device ?? name} emulation`;
      browser = await engine('chromium');
    }
    const page = { ...profile, viewport };
    const t0 = performance.now();
    const got = await sweepCell(browser, name, ctx, { page, journeys, overlays });
    findings.push(...got.findings);
    failed.push(...got.failed);
    timings.push(...got.timings);
    cells.push({ name, engine: browser.browserType().name(), device: device ?? null, viewport, fallback, ms: Math.round(performance.now() - t0), probes: got.timings.length });
  }
} finally {
  for (const b of browsers.values()) await b.close?.();
  server.close();
}

const counts = tally(findings);
const examples = {};
for (const f of findings) {
  const fp = fingerprint(f, f.cell);
  if (!examples[fp] || f.px > examples[fp].px) examples[fp] = { text: f.text, px: f.px, selector: f.selector, where: f.where };
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const { added, dropped } = ratchet(counts, sectionOf(baseline), { cells: wanted });
const sorted = [...timings].sort((x, y) => x - y);
let sha = '';
try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const report = {
  at: new Date().toISOString(), sha, platform: PLATFORM, load: loadavg()[0],
  ms: Math.round(performance.now() - started),
  probe: { count: sorted.length, medianMs: Math.round(sorted[sorted.length >> 1] ?? 0), maxMs: Math.round(sorted.at(-1) ?? 0) },
  cells, journeys: journeys.map((j) => j.name), overlays: overlays.map((o) => o.name),
  failed, instances: findings.length, fingerprints: Object.keys(counts).length,
  counts, examples, added, dropped,
};
writeFileSync(join(out, 'findings.json'), `${JSON.stringify(report, null, 2)}\n`);

const full = !a.cell && !a.journey && !a.overlay;
if (a.lower && !full) console.log('LOWER REFUSED  --lower needs the full sweep: drop --cell, --journey and --overlay');
else if (a.lower && failed.length) console.log('LOWER REFUSED  a journey or overlay failed, so its cut-offs were not measured');
else if (a.lower && cells.some((c) => c.fallback)) console.log('LOWER REFUSED  a cell walked a fallback engine, so its counts do not match the gate');
else if (a.lower) {
  writeFileSync(BASELINE, `${JSON.stringify(lower(baseline, counts, { cells: wanted }), null, 2)}\n`);
  console.log(`baseline for ${PLATFORM} lowered -> ${BASELINE.pathname}`);
}

for (const [fp, n] of Object.entries(counts)) console.log(`${String(n).padStart(4)}  ${fp}  ${JSON.stringify(examples[fp].text)} ${examples[fp].px}px`);
for (const c of cells) if (c.fallback) console.log(`FALLBACK  ${c.name}: ${c.fallback}`);
for (const f of failed) console.log(`FAILED  ${f.where} [${f.cell}]: ${f.error}`);
for (const x of added) console.log(`NEW  ${x.fp}  seen ${x.seen}, baseline ${x.baseline}`);
for (const x of dropped) console.log(`FIXED  ${x.fp}  seen ${x.seen}, baseline ${x.baseline}: lower the ${PLATFORM} baseline (--lower)`);
console.log(`${PLATFORM}: ${findings.length} cut-offs, ${report.fingerprints} fingerprints, ${failed.length} failures, probe median ${report.probe.medianMs} ms max ${report.probe.maxMs} ms, ${(report.ms / 1000).toFixed(1)} s -> ${join(out, 'findings.json')}`);
process.exit(failed.length ? 1 : 0);
