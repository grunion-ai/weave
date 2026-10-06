#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { JOURNEYS, seed, walk } from '../test/lib/journeys.mjs';
import { installProbe, readProbe, resetProbe, recordFrames, frameFlashes, diffBox, evidenceFrames, confirm, fingerprint } from '../test/lib/flicker.mjs';

const { values: a } = parseArgs({ options: {
  runs: { type: 'string', default: '3' },
  min: { type: 'string', default: '2' },
  out: { type: 'string', default: 'flicker-out' },
  journey: { type: 'string' },
  'no-frames': { type: 'boolean', default: false },
} });
const pw = await import('playwright').catch(() => null);
if (!pw) { console.error('playwright not installed: ln -s ~/.gerrit/weave/pw/node_modules node_modules'); process.exit(2); }

const out = resolve(a.out);
mkdirSync(out, { recursive: true });
const only = a.journey ? new Set(a.journey.split(',')) : null;
const journeys = JOURNEYS.filter((j) => !only || only.has(j.name));
const probe = { install: installProbe, read: readProbe, reset: resetProbe };
const record = a['no-frames'] ? null : (page) => recordFrames(page);
const GRID = 40;
const snap = (v) => Math.round(v / GRID) * GRID;

const weave = new Weave();
const handles = await seed(weave);
const { server } = await startServer(weave, { port: 0 });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch();
const ctx = { ...handles, base, weave };

const runs = [];
const evidence = new Map();
const failed = [];
try {
  for (let r = 0; r < Number(a.runs); r++) {
    const run = {};
    for (const j of journeys) {
      let got;
      try { got = await walk(browser, j, ctx, { probe, record }); }
      catch (err) { failed.push({ journey: j.name, run: r, error: String(err.message).split('\n')[0] }); continue; }
      const events = [...got.events];
      for (const f of frameFlashes(got.frames)) {
        const box = diffBox(got.frames[f.i - 1].px, got.frames[f.i].px);
        events.push({ kind: 'frame', sel: box ? `box ${snap(box.x)},${snap(box.y)} ${snap(box.w)}x${snap(box.h)}` : 'box ?', ms: f.ms, value: f.ratio, at: f.at, i: f.i });
      }
      run[j.name] = events;
      for (const e of events) {
        const fp = fingerprint(j.name, e);
        if (evidence.has(fp) || !got.frames.length) continue;
        evidence.set(fp, evidenceFrames(got.frames, e).map((fr) => fr.png));
      }
    }
    runs.push(run);
  }
} finally {
  await browser.close();
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
  journeys: journeys.map((j) => j.name), failed, findings,
};
writeFileSync(join(out, 'findings.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const f of findings) console.log(`${f.runs}/${a.runs}  ${f.fp}  ${f.ms} ms${f.detail ? `  ${f.detail}` : ''}`);
for (const f of failed) console.log(`FAILED  ${f.journey} (run ${f.run}): ${f.error}`);
console.log(`${findings.length} confirmed, ${failed.length} journey failures -> ${join(out, 'findings.json')}`);
process.exit(failed.length ? 1 : 0);
