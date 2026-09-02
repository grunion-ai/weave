/* The Quality mirror, generated from the test tree.

   Quality/Suite + Quality/Case let weave describe its own test suite as
   data. Hand-kept copies drift, so the mirror is derived: scanSuites parses
   the test files, syncQualityMirror reconciles a workspace to the scan.
   The seed calls sync on a fresh workspace (correct by construction); the
   main watcher calls it on the live docs workspace after every landing.

   Granularity: DECLARED cases. A static test('name') is one row with that
   name; a dynamic test(`slash: ${name}`) is one row carrying the template
   verbatim — the declaration is mirrored, not its runtime expansion, so the
   mirror never pretends to counts it cannot know from source. */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// 'soft-delete.test.mjs' -> 'Soft delete'; 'regression/lifecycle.test.mjs'
// -> 'Regression: lifecycle'. The File field is the identity; the name is
// for humans.
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
    // Any plain `test(` declaration, indented or not (browser suites guard
    // theirs inside a playwright-availability block). `t.test(` subtests
    // don't match the line anchor and stay part of their parent's story.
    for (const m of src.matchAll(/^[ \t]*test\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gm)) {
      cases.push(m[2].replace(/\\(['"`])/g, '$1'));
    }
    return { name: suiteName(file), file, cases: [...new Set(cases)] };
  }).filter((s) => s.cases.length);
}

export function syncQualityMirror(w, scanned, { dryRun = false } = {}) {
  const suiteTable = w.getTable('Quality/Suite');
  const caseTable = w.getTable('Quality/Case');
  const fileField = Object.values(suiteTable.fields).find((f) => f.name === 'File');
  const summary = { suites: scanned.length, createdSuites: 0, createdCases: 0, removedSuites: 0, removedCases: 0, renamedSuites: 0 };

  const rows = w.listEntities(suiteTable.id);
  const byFile = new Map(rows.map((r) => [r.values[fileField.id], r]));

  for (const s of scanned) {
    let row = byFile.get(s.file);
    if (!row) {
      summary.createdSuites += 1;
      // Dry mode cannot walk the cases of a row that was never made.
      if (dryRun) { summary.createdCases += s.cases.length; continue; }
      row = w.createEntity(suiteTable, { name: s.name, values: { File: s.file } });
    } else if (w.entityName(row) !== s.name) {
      summary.renamedSuites += 1;
      if (!dryRun) w.updateEntity(row.id, { Name: s.name });
    }
    const want = new Set(s.cases);
    const have = new Map(w.readEntity(row.id).fields.Cases.map((c) => [c.name, c.id]));
    for (const name of want) {
      if (!have.has(name)) {
        summary.createdCases += 1;
        if (!dryRun) w.createEntity(caseTable, { name, values: { Suite: row.id } });
      }
    }
    for (const [name, id] of have) {
      if (!want.has(name)) {
        summary.removedCases += 1;
        if (!dryRun) w.deleteEntity(id, { hard: true });
      }
    }
  }
  for (const [file, row] of byFile) {
    if (!scanned.some((s) => s.file === file)) {
      summary.removedSuites += 1;
      summary.removedCases += w.readEntity(row.id).fields.Cases.length;
      if (dryRun) continue;
      for (const c of w.readEntity(row.id).fields.Cases) w.deleteEntity(c.id, { hard: true });
      w.deleteEntity(row.id, { hard: true });
    }
  }
  return summary;
}
