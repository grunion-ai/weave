#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { CELLS, JOURNEYS, cellsOf, seed, walk } from '../test/lib/journeys.mjs';
import { installProbe, readProbe, readInputs, resetProbe, recordFrames, frameFlashes, diffBox, evidenceFrames, confirm, fingerprint } from '../test/lib/flicker.mjs';

const { values: a } = parseArgs({ options: {
  runs: { type: 'string', default: '3' },
  min: { type: 'string', default: '2' },
  out: { type: 'string', default: 'flicker-out' },
  journey: { type: 'string' },
  cell: { type: 'string' },
  'no-frames': { type: 'boolean', default: false },
} });
const pw = await import('playwright').catch(() => null);
if (!pw) { console.error('playwright not installed: ln -s ~/.gerrit/weave/pw/node_modules node_modules'); process.exit(2); }

const out = resolve(a.out);
mkdirSync(out, { recursive: true });
const only = a.journey ? new Set(a.journey.split(',')) : null;
const journeys = JOURNEYS.filter((j) => !only || only.has(j.name));
const wanted = a.cell ? a.cell.split(',') : Object.keys(CELLS);
const probe = { install: installProbe, read: readProbe, reset: resetProbe, inputs: readInputs };
const record = a['no-frames'] ? null : (page) => recordFrames(page);
const GRID = 40;
const snap = (v) => Math.round(v / GRID) * GRID;

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
for (const name of wanted) {
  const { device, ...want } = CELLS[name];
  const page = device ? (({ defaultBrowserType, ...rest }) => rest)(pw.devices[device]) : {};
  let browser = await engine(want.engine);
  let fallback = '';
  if (browser.err) {
    fallback = `${want.engine} could not launch (${String(browser.err.message).split('\n')[0]}); walked chromium with the ${device ?? name} emulation`;
    browser = await engine('chromium');
  }
  cells.push({ name, browser, device: device ?? null, fallback, options: { ...want, ...page, engine: browser.browserType().name() } });
}

const runs = [];
const evidence = new Map();
const failed = [];
try {
  for (let r = 0; r < Number(a.runs); r++) {
    const run = {};
    for (const c of cells) for (const j of journeys.filter((x) => cellsOf(x).includes(c.name))) {
      let got;
      try { got = await walk(c.browser, j, ctx, { probe, record, ...c.options }); }
      catch (err) { failed.push({ journey: j.name, cell: c.name, run: r, error: String(err.message).split('\n')[0] }); continue; }
      const events = got.events.map((e) => ({ ...e, cell: c.name }));
      for (const f of frameFlashes(got.frames, { inputs: got.inputs })) {
        const box = diffBox(got.frames[f.i - 1].px, got.frames[f.i].px);
        events.push({ kind: 'frame', cell: c.name, sel: box ? `box ${snap(box.x)},${snap(box.y)} ${snap(box.w)}x${snap(box.h)}` : 'box ?', ms: f.ms, value: f.ratio, at: f.at, i: f.i });
      }
      run[j.name] = [...(run[j.name] ?? []), ...events];
      for (const e of events) {
        const fp = fingerprint(j.name, e);
        if (evidence.has(fp) || !got.frames.length) continue;
        evidence.set(fp, evidenceFrames(got.frames, e).map((fr) => fr.png));
      }
    }
    runs.push(run);
  }
} finally {
  for (const b of browsers.values()) await b.close?.();
  server.close();
}

const findings = confirm(runs, { min: Number(a.min) }).map((f) => {
  const id = createHash('sha1').update(f.fp).digest('hex').slice(0, 10);
  const files = (evidence.get(f.fp) ?? []).map((png, i) => {
    const name = `${id}-${['before', 'during', 'after'][i]}.png`;
    writeFileSync(join(out, name), png);
    return name;
  });
  return { ...f, id, frames: files };
});

let sha = '';
try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const report = {
  at: new Date().toISOString(), sha, load: loadavg()[0], runs: Number(a.runs), min: Number(a.min),
  journeys: journeys.map((j) => j.name),
  cells: cells.map((c) => ({ name: c.name, engine: c.options.engine, device: c.device, viewport: c.options.viewport, hasTouch: !!c.options.hasTouch, fallback: c.fallback, journeys: journeys.filter((j) => cellsOf(j).includes(c.name)).map((j) => j.name) })),
  failed, findings,
};
writeFileSync(join(out, 'findings.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const f of findings) console.log(`${f.runs}/${a.runs}  ${f.fp}  ${f.ms} ms${f.detail ? `  ${f.detail}` : ''}`);
for (const c of cells) if (c.fallback) console.log(`FALLBACK  ${c.name}: ${c.fallback}`);
for (const f of failed) console.log(`FAILED  ${f.journey} [${f.cell}] (run ${f.run}): ${f.error}`);
console.log(`${findings.length} confirmed, ${failed.length} journey failures -> ${join(out, 'findings.json')}`);
process.exit(failed.length ? 1 : 0);
