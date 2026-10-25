#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { SEEDS } from '../test/lib/states.mjs';
import { verdict } from '../test/lib/cutoff.mjs';
import { ENGINES, PHONE, PLATFORM, fingerprint, lower, measure, say, sectionOf, small, surfaces, tally, themesOn } from '../test/lib/touch.mjs';

const BASELINE = new URL('../test/touch-baseline.json', import.meta.url);
const { values: a } = parseArgs({ options: {
  lower: { type: 'boolean', default: false },
  state: { type: 'string' },
} });
const pw = await import('playwright').catch(() => null);
if (!pw) { console.error('playwright not installed: ln -s ~/.gerrit/weave/pw/node_modules node_modules'); process.exit(2); }

const plan = surfaces().filter((p) => !a.state || a.state.split(',').includes(p.state.name));
const ctxs = {};
const servers = [];
for (const seed of new Set(plan.map((p) => p.seed))) {
  const weave = new Weave();
  const handles = await SEEDS[seed](weave);
  const { server } = await startServer(weave, { port: 0 });
  servers.push(server);
  ctxs[seed] = { ...handles, weave, base: `http://127.0.0.1:${server.address().port}` };
}
const { defaultBrowserType, ...iphone } = pw.devices['iPhone 15'];
const profiles = { chromium: PHONE, webkit: iphone };
const findings = [];
const failed = [];
const ran = [];
try {
  for (const engine of ENGINES) {
    const browser = await pw[engine].launch().catch(() => null);
    if (!browser) { console.log(`SKIPPED  ${engine} cannot launch here`); continue; }
    ran.push(engine);
    try {
      for (const entry of plan.filter((p) => themesOn(engine).includes(p.theme))) {
        const t0 = performance.now();
        try {
          for (const c of small(await measure(browser, profiles[engine], entry.theme, entry, ctxs[entry.seed]))) {
            findings.push({ fp: fingerprint(entry.state.name, c, engine), said: `${entry.state.name} ${entry.theme} ${engine}: ${say(c)}` });
          }
        } catch (err) { failed.push(`${entry.state.name} ${entry.theme} ${engine}: ${String(err.message).split('\n')[0]}`); }
        console.error(`${engine} ${entry.theme} ${entry.state.name} ${Math.round(performance.now() - t0)} ms`);
      }
    } finally { await browser.close(); }
  }
} finally { for (const s of servers) s.close(); }

const counts = tally(findings);
const file = JSON.parse(readFileSync(BASELINE, 'utf8'));
const { added, stale } = verdict(counts, sectionOf(file), { cells: null });
for (const f of findings) console.log(f.said);
for (const x of failed) console.log(`FAILED  ${x}`);
for (const x of added) console.log(`NEW  ${x.fp}  seen ${x.seen}, baseline ${x.baseline}`);
for (const x of stale.filter((s) => ran.some((e) => s.fp.endsWith(`|${e}`)))) console.log(`STALE  ${x.fp}  seen ${x.seen}, baseline ${x.baseline}`);
if (a.lower && (a.state || failed.length)) console.log('LOWER REFUSED  --lower needs the full sweep with every state opening');
else if (a.lower) {
  writeFileSync(BASELINE, `${JSON.stringify(lower(file, counts, { engines: ran }), null, 2)}\n`);
  console.log(`baseline for ${PLATFORM} lowered -> ${BASELINE.pathname}`);
}
console.log(`${PLATFORM}: ${findings.length} small targets, ${Object.keys(counts).length} fingerprints, ${failed.length} failures`);
console.log(JSON.stringify(counts));
process.exit(failed.length ? 1 : 0);
