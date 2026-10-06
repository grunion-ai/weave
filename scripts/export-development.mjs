#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { openSecurityCitations } from './changelog-fold.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(homedir(), '.weave', 'weave.db');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const w = new Weave({ path: source });
if (w.state.meta.name !== 'weave') {
  console.error(`${source} is the '${w.state.meta.name}' workspace, not the canonical weave docs workspace`);
  process.exit(1);
}

const table = (qualified) => {
  const db = w.listTables().find((t) => `${w.getSpace(t.spaceId)?.name}/${t.name}` === qualified);
  if (!db) throw new Error(`No ${qualified} table in ${source}`);
  return db;
};

const rows = (qualified, fields, relations = []) => {
  const db = table(qualified);
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
  releases: rows('Development/Release', ['Date', 'Commit'], ['Fixes', 'Ships']),
};

for (const r of manifest.releases) {
  if (!(r.description ?? '').trim()) { console.error(`Release ${r.name} has no notes — write them in the weave workspace first`); process.exit(1); }
}
if (!manifest.releases.some((r) => r.name === `v${pkg.version}`)) {
  console.error(`No Development/Release row named v${pkg.version} — create it with notes before exporting`);
  process.exit(1);
}
const fragDir = join(root, 'changelog.d');
const fragments = (existsSync(fragDir) ? readdirSync(fragDir).filter((n) => n.endsWith('.md')) : [])
  .map((name) => ({ name, text: readFileSync(join(fragDir, name), 'utf8') }));
const issues = w.listEntities(table('Development/Issue').id).map((e) => {
  const r = w.readEntity(e.id);
  return { number: e.publicId, name: r.name, status: r.fields.Status };
});
const cited = openSecurityCitations(fragments, issues);
if (cited.length) {
  console.error(`${cited.join('\n')}\nGive that work its own Issue or Feature row and cite it instead; the finding's number stays with the finding.`);
  process.exit(1);
}
const out = join(root, 'docs', 'development.json');
writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${out}: ${manifest.issues.length} issues, ${manifest.features.length} features, ${manifest.releases.length} releases (v${manifest.version})`);
