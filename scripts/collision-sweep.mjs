#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { OVERLAYS } from '../test/lib/overlays.mjs';
import { CELLS, GATE_CELLS, PLATFORM, SWEEP_JOURNEYS, fingerprint, sectionOf, seed, sweep, tally, verdict } from '../test/lib/collision.mjs';

const HELD = new URL('../test/collision-held.json', import.meta.url);
const { values: a } = parseArgs({ options: {
  out: { type: 'string', default: 'collision-out' },
  cell: { type: 'string' },
  journey: { type: 'string' },
  overlay: { type: 'string' },
} });
const pw = await import('playwright').catch(() => null);
if (!pw) { console.error('playwright not installed: ln -s ~/.gerrit/weave/pw/node_modules node_modules'); process.exit(2); }

const pick = (list, csv) => (csv ? list.filter((x) => csv.split(',').includes(x.name)) : list);
const journeys = pick(SWEEP_JOURNEYS, a.journey ?? (a.overlay ? '-' : null));
const overlays = pick(OVERLAYS, a.overlay ?? (a.journey ? '-' : null));
const wanted = a.cell ? a.cell.split(',') : GATE_CELLS;
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
    const got = await sweep(browser, name, ctx, { page, journeys, overlays, ...(a.journey || a.overlay ? { rests: [] } : {}) });
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
  if (!examples[fp] || f.px > examples[fp].px) examples[fp] = { text: f.text, px: f.px, selector: f.selector, with: f.with ?? null, where: f.where };
}
const { unheld, gone } = verdict(counts, sectionOf(JSON.parse(readFileSync(HELD, 'utf8'))), { cells: wanted });
const sorted = [...timings].sort((x, y) => x - y);
let sha = '';
try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 10000 }).trim(); } catch {}
const report = {
  at: new Date().toISOString(), sha, platform: PLATFORM, load: loadavg()[0],
  ms: Math.round(performance.now() - started),
  probe: { count: sorted.length, medianMs: Math.round(sorted[sorted.length >> 1] ?? 0), maxMs: Math.round(sorted.at(-1) ?? 0) },
  cells, journeys: journeys.map((j) => j.name), overlays: overlays.map((o) => o.name),
  failed, instances: findings.length, fingerprints: Object.keys(counts).length,
  counts, examples, unheld, gone,
};
writeFileSync(join(out, 'findings.json'), `${JSON.stringify(report, null, 2)}\n`);

for (const [fp, n] of Object.entries(counts)) console.log(`${String(n).padStart(4)}  ${fp}  ${JSON.stringify(examples[fp].text)} ${examples[fp].px}px at ${examples[fp].where}`);
for (const c of cells) if (c.fallback) console.log(`FALLBACK  ${c.name}: ${c.fallback}`);
for (const f of failed) console.log(`FAILED  ${f.where} [${f.cell}]: ${f.error}`);
for (const x of unheld) console.log(`NEW  ${x.fp}  seen ${x.seen}: fix it, or hold it against the Issue row that tracks it`);
for (const x of gone) console.log(`GONE  ${x.fp}  held for Issue #${x.hold.join(', #')}: drop the hold`);
console.log(`${PLATFORM}: ${findings.length} collisions, ${report.fingerprints} fingerprints, ${failed.length} failures, probe median ${report.probe.medianMs} ms max ${report.probe.maxMs} ms, ${(report.ms / 1000).toFixed(1)} s -> ${join(out, 'findings.json')}`);
process.exit(failed.length || unheld.length || gone.length ? 1 : 0);
