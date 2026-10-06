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

export function syncQualityMirror(w, scanned, { dryRun = false } = {}) {
  const suiteTable = w.getTable('Quality/Suite');
  const caseTable = w.getTable('Quality/Case');
  const fileField = Object.values(suiteTable.fields).find((f) => f.name === 'File');
  const summary = { suites: scanned.length, createdSuites: 0, createdCases: 0, removedSuites: 0, removedCases: 0, renamedSuites: 0 };

  const byFile = new Map();
  const doomed = [];
  for (const r of w.listEntities(suiteTable.id)) {
    const file = r.values[fileField.id];
    const seen = byFile.get(file);
    if (!seen) byFile.set(file, r);
    else if (r.publicId < seen.publicId) { byFile.set(file, r); doomed.push(seen); }
    else doomed.push(r);
  }

  for (const s of scanned) {
    let row = byFile.get(s.file);
    if (!row) {
      summary.createdSuites += 1;
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
  const scannedFiles = new Set(scanned.map((s) => s.file));
  for (const [file, row] of byFile) if (!scannedFiles.has(file)) doomed.push(row);
  for (const row of doomed) {
    const rowCases = w.readEntity(row.id).fields.Cases;
    summary.removedSuites += 1;
    summary.removedCases += rowCases.length;
    if (dryRun) continue;
    for (const c of rowCases) w.deleteEntity(c.id, { hard: true });
    w.deleteEntity(row.id, { hard: true });
  }
  return summary;
}
