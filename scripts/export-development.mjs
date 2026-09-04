#!/usr/bin/env node
/* Export the canonical Development space (Issues + Features + Releases) to
   docs/development.json — the manifest a build ships so every instance's
   issue list updates on update (Feature: development sync, 2026-08-31).

   Run from the machine that owns the canonical weave workspace, as part of
   the ship cycle:

     node scripts/export-development.mjs [path/to/weave.db]

   The default source is ~/.weave/weave.db. The manifest carries name,
   status, severity/milestone, symptom, and the Description markdown for
   every row — name is the upsert key syncDevelopment matches on, so renames
   in the canonical workspace mint new rows downstream (accepted trade-off:
   the key survives export/import and needs no shared id space). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(homedir(), '.weave', 'weave.db');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const w = new Weave({ path: source });
if (w.state.meta.name !== 'weave') {
  console.error(`${source} is the '${w.state.meta.name}' workspace, not the canonical weave docs workspace`);
  process.exit(1);
}

const rows = (qualified, fields, relations = []) => {
  const db = w.listTables().find((t) => `${w.getSpace(t.spaceId)?.name}/${t.name}` === qualified);
  if (!db) throw new Error(`No ${qualified} table in ${source}`);
  return w.listEntities(db.id)
    .map((e) => w.readEntity(e.id))
    .filter((e) => e.name)
    .map((e) => {
      const row = { name: e.name };
      for (const f of fields) if (e.fields[f] != null && e.fields[f] !== '') row[f.toLowerCase()] = e.fields[f];
      for (const r of relations) {
        const linked = (e.fields[r] ?? []).map((x) => x.name ?? x).filter(Boolean);
        if (linked.length) row[r.toLowerCase()] = linked;
      }
      const doc = e.docs?.Description ?? '';
      if (doc) row.description = doc;
      return row;
    });
};

const manifest = {
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  issues: rows('Development/Issue', ['Status', 'Severity', 'Symptom']),
  features: rows('Development/Feature', ['Status', 'Milestone']),
  // Release notes are mandatory: a row without a Description fails the export
  // here and the suite downstream (test/development-sync.test.mjs).
  releases: rows('Development/Release', ['Date', 'Commit'], ['Fixes', 'Ships']),
};

for (const r of manifest.releases) {
  if (!(r.description ?? '').trim()) { console.error(`Release ${r.name} has no notes — write them in the weave workspace first`); process.exit(1); }
}
if (!manifest.releases.some((r) => r.name === `v${pkg.version}`)) {
  console.error(`No Development/Release row named v${pkg.version} — create it with notes before exporting`);
  process.exit(1);
}
const out = join(root, 'docs', 'development.json');
writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${out}: ${manifest.issues.length} issues, ${manifest.features.length} features, ${manifest.releases.length} releases (v${manifest.version})`);
