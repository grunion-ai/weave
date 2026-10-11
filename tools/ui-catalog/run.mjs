#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';
import { seedWeaver, syncDevelopment } from '../../src/weaver-seed.js';
import { seed } from '../../scripts/seed.mjs';
import { sampleRow } from '../../scripts/template-exercise-core.mjs';
import { harvestLane } from './harvest.mjs';
import { writeCatalog, VIEWS } from './build.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const ONLY = arg('only') ? new RegExp(arg('only')) : null;
const LANES = (arg('lanes') || VIEWS.join(',')).split(',');
const PARALLEL = Number(arg('parallel', 2));
const MAX_TRIGGERS = Number(arg('max-triggers', 70));
const OUT = arg('out', join(ROOT, 'docs', 'ui-catalog', 'index.html'));
const KEEP = arg('keep', null);

const TEMPLATE_ROWS = { CRM: ['Northwind rollout', 'Contoso renewal', 'Acme pilot'], Money: ['Rent', 'Groceries', 'Salary'] };

export function seedCatalogWorkspace(path) {
  const w = new Weave({ path, actor: 'ui-catalog' });
  seedWeaver(w);
  syncDevelopment(w, JSON.parse(readFileSync(join(ROOT, 'docs', 'development.json'), 'utf8')));
  seed(w);
  for (const file of ['crm', 'money']) {
    const doc = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'templates', `${file}.json`), 'utf8'));
    w.applySchema([doc], { partial: true });
    const tables = w.describeSchema().find((s) => s.space === doc.space)?.tables ?? [];
    for (const t of tables) for (const name of TEMPLATE_ROWS[doc.space]) w.createEntity(t.id, { name, values: sampleRow(t, name).values });
  }
  w.save();
  return w;
}

export function catalogRoutes(w) {
  const tables = w.listTables();
  const at = (space, name) => tables.find((t) => t.name === name && w.getSpace(t.spaceId)?.name === space);
  const first = (t) => { const q = w.query(t.id, { limit: 1 }); return q.items[0]; };
  const space = w.listSpaces().find((s) => s.name === 'Development');
  const pick = [['Development', 'Issue'], ['Showcase', 'Field Types'], ['Showcase', 'Formatting'], ['Product', 'Task'], ['Product', 'Project'], ['CRM', 'Deals'], ['Money', 'Transactions'], ['Handbook', 'Guide'], ['Workspace', 'Workflows'], ['Workspace', 'Fields']]
    .map(([s, n]) => at(s, n)).filter(Boolean);
  const routes = [['Home', '#/'], ['Space: Development', `#/space/${space.id}`]];
  for (const t of pick) routes.push([`Table: ${t.name}`, `#/table/${t.id}`]);
  for (const t of pick.filter((t) => !t.system).slice(0, 8)) { const e = first(t); if (e) routes.push([`Entity: ${t.name}`, `#/entity/${e.id}`]); }
  routes.push(['Activity', '#/activity'], ['Trash', '#/trash']);
  return { routes, issue: `#/table/${at('Development', 'Issue').id}` };
}

async function main() {
  const pw = await import('playwright').catch(() => null);
  if (!pw) throw new Error('npm run ui-catalog needs Playwright: link it with `ln -s ~/.gerrit/weave/pw/node_modules node_modules`, or `npm i --no-save playwright`');
  const dir = mkdtempSync(join(tmpdir(), 'weave-ui-catalog-'));
  let server, browser;
  try {
    const t0 = Date.now();
    const w = seedCatalogWorkspace(join(dir, 'weave.db'));
    ({ server } = await startServer(w, { port: 0 }));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const { routes, issue } = catalogRoutes(w);
    const chosen = routes.filter(([n]) => !ONLY || ONLY.test(n));
    console.log(`seeded ${dir} in ${Date.now() - t0} ms; serving ${base}; ${chosen.length} routes; lanes ${LANES.join(', ')}`);
    browser = await pw.chromium.launch();
    const lanes = [];
    const queue = LANES.slice();
    const worker = async () => {
      for (let v; (v = queue.shift());) {
        const [width, theme] = v.split('-');
        const t1 = Date.now();
        const lane = await harvestLane(browser, { base, routes: chosen, theme, width, maxTriggers: MAX_TRIGGERS, toastRoute: issue, extrasRoute: issue, log: (l) => console.log(l) });
        if (KEEP) writeFileSync(join(KEEP, `${v}.json`), JSON.stringify(lane));
        console.log(`${v}: ${lane.specs.length} specimens, ${lane.meta.blocked} writes blocked, ${lane.meta.themeFlips} theme flips, ${Math.round((Date.now() - t1) / 1000)} s`);
        lanes.push(lane);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, PARALLEL) }, worker));
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    let sha = 'unknown';
    try { sha = execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%h'], { encoding: 'utf8' }).trim(); } catch {}
    const { data, bytes, out } = writeCatalog(lanes, { out: OUT, meta: { version: pkg.version, sha, at: new Date().toISOString().slice(0, 10), routes: chosen.map(([n]) => n) } });
    console.log(`${out}: ${bytes} bytes, ${data.functions.length} functions, ${data.controls.length} controls, ${data.meta.looks} looks, ${data.shots.length} screenshots`);
  } finally {
    await browser?.close();
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
