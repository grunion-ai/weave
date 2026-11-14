import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function suiteName(relFile) {
  const stem = relFile.replace(/^test\//, '').replace(/\.test\.mjs$/, '');
  const words = stem.replace(/\//g, ': ').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function scanSuites(rootDir) {
  const testDir = join(rootDir, 'test');
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.test.mjs')) files.push(join(dir, e.name));
    }
  };
  walk(testDir);

  return files.sort().map((abs) => {
    const file = relative(rootDir, abs).split('\\').join('/');
    const src = readFileSync(abs, 'utf8');
    const cases = [];
    for (const m of src.matchAll(/^[ \t]*test\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gm)) {
      cases.push(m[2].replace(/\\(['"`])/g, '$1'));
    }
    return { name: suiteName(file), file, cases: [...new Set(cases)] };
  }).filter((s) => s.cases.length);
}

export function caseResults(shards) {
  const newest = new Map();
  for (const shard of shards) {
    const held = newest.get(shard.id);
    if (!held || (shard.attempt ?? 1) > (held.attempt ?? 1)) newest.set(shard.id, shard);
  }
  const files = new Map();
  const entry = (file) => files.get(file) ?? files.set(file, { ok: false, runs: new Map() }).get(file);
  for (const shard of newest.values()) {
    for (const s of shard.summaries ?? []) if (s.success) entry(s.file).ok = true;
    for (const c of shard.cases ?? []) {
      const runs = entry(c.file).runs;
      runs.set(c.name, [...(runs.get(c.name) ?? []), c.pass]);
    }
  }
  return new Map([...files].map(([file, { ok, runs }]) => [file, {
    ok,
    cases: new Map([...runs].map(([name, passes]) => [name, passes.every(Boolean) ? 'Passing' : passes.some(Boolean) ? 'Flaky' : 'Failing'])),
  }]));
}

function statusFor(results, file, name) {
  const r = results?.get(file);
  if (!r) return null;
  return r.cases.get(name) ?? (r.ok ? 'Passing' : null);
}

export function planQualityMirror(rows, scanned, results = null) {
  const summary = { suites: scanned.length, createdSuites: 0, createdCases: 0, removedSuites: 0, removedCases: 0, renamedSuites: 0, statusChanges: 0, missingFiles: [] };
  const ops = [];
  const byFile = new Map();
  const doomed = [];
  for (const r of [...rows].sort((a, b) => a.publicId - b.publicId)) {
    if (byFile.has(r.file)) doomed.push(r);
    else byFile.set(r.file, r);
  }
  for (const s of scanned) {
    const row = byFile.get(s.file);
    if (!row) {
      summary.createdSuites += 1;
      summary.createdCases += s.cases.length;
      ops.push({ op: 'createSuite', name: s.name, file: s.file, cases: s.cases.map((name) => ({ name, status: statusFor(results, s.file, name) })) });
      continue;
    }
    if (row.name !== s.name) {
      summary.renamedSuites += 1;
      ops.push({ op: 'rename', id: row.id, name: s.name });
    }
    const have = new Map(row.cases.map((c) => [c.name, c]));
    for (const name of new Set(s.cases)) {
      const status = statusFor(results, s.file, name);
      const held = have.get(name);
      if (!held) {
        summary.createdCases += 1;
        ops.push({ op: 'createCase', suite: row.id, name, status });
      } else if (status && held.status !== status) {
        summary.statusChanges += 1;
        ops.push({ op: 'status', id: held.id, status });
      }
    }
    const want = new Set(s.cases);
    for (const c of row.cases) {
      if (want.has(c.name)) continue;
      summary.removedCases += 1;
      ops.push({ op: 'deleteCase', id: c.id });
    }
  }
  const scannedFiles = new Set(scanned.map((s) => s.file));
  for (const [file, row] of byFile) {
    if (scannedFiles.has(file)) continue;
    summary.missingFiles.push(file);
    doomed.push(row);
  }
  for (const row of doomed) {
    summary.removedSuites += 1;
    summary.removedCases += row.cases.length;
    for (const c of row.cases) ops.push({ op: 'deleteCase', id: c.id });
    ops.push({ op: 'deleteSuite', id: row.id });
  }
  return { ops, summary };
}

function buildMirrorTables(w) {
  if (!w.findSpace('Quality')) w.createSpace({ name: 'Quality', icon: 'lucide:shield-check', description: 'The Weave test suite, dogfooded' });
  const suites = w.createTable({ space: 'Quality', name: 'Suite', icon: 'lucide:shield-check' });
  const cases = w.createTable({ space: 'Quality', name: 'Case', icon: 'lucide:square-check' });
  w.addField(cases, {
    name: 'Status', type: 'workflow', config: {
      states: [
        { name: 'Failing', category: 'not-started' },
        { name: 'Flaky', category: 'in-progress' },
        { name: 'Passing', category: 'done', default: true },
      ],
    },
  });
  w.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  w.addField(suites, { name: 'Case Count', type: 'rollup', config: { relationField: 'Cases', aggregate: 'count' } });
  w.addField(suites, { name: 'File', type: 'text' });
}

function mirrorRows(w, suiteTable) {
  const fileField = Object.values(suiteTable.fields).find((f) => f.name === 'File');
  return w.listEntities(suiteTable.id).map((r) => ({
    id: r.id,
    publicId: r.publicId,
    name: w.entityName(r),
    file: r.values[fileField.id],
    cases: w.readEntity(r.id).fields.Cases.map((c) => ({ id: c.id, name: c.name, status: w.readEntity(c.id).fields.Status })),
  }));
}

export function syncQualityMirror(w, scanned, { dryRun = false, results = null } = {}) {
  const unbuilt = w.state.meta.name === 'weave' && !w.findTable('Quality/Suite');
  if (unbuilt && dryRun) return planQualityMirror([], scanned, results).summary;
  if (unbuilt) buildMirrorTables(w);
  const suiteTable = w.getTable('Quality/Suite');
  const caseTable = w.getTable('Quality/Case');
  const { ops, summary } = planQualityMirror(mirrorRows(w, suiteTable), scanned, results);
  if (dryRun) return summary;
  for (const o of ops) {
    if (o.op === 'createSuite') {
      const row = w.createEntity(suiteTable, { name: o.name, values: { File: o.file } });
      for (const c of o.cases) w.createEntity(caseTable, { name: c.name, values: { Suite: row.id, ...(c.status ? { Status: c.status } : {}) } });
    } else if (o.op === 'createCase') w.createEntity(caseTable, { name: o.name, values: { Suite: o.suite, ...(o.status ? { Status: o.status } : {}) } });
    else if (o.op === 'rename') w.updateEntity(o.id, { Name: o.name });
    else if (o.op === 'status') w.updateEntity(o.id, { Status: o.status });
    else w.deleteEntity(o.id, { hard: true });
  }
  return summary;
}
