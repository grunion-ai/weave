import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { seedWeaver, syncDevelopment } from '../src/weaver-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Development sync (2026-08-31): every build ships docs/development.json —
   the canonical Issue/Feature lists — and boot applies it to the local docs
   workspace, so updating weave updates the issue list. */

const findIssue = (w, name) => {
  const db = w.listTables().find((t) => t.name === 'Issue');
  return w.listEntities(db.id).map((e) => w.readEntity(e.id)).find((e) => e.name === name);
};

const manifest = (over = {}) => ({
  version: '9.9.9',
  generatedAt: '2026-08-31T00:00:00.000Z',
  issues: [],
  features: [],
  ...over,
});

test('a shipped status lands on the matching row by name', () => {
  const w = seedWeaver(new Weave());
  const target = 'No filter-builder UI (filters are API/CLI/MCP only)';
  assert.equal(findIssue(w, target).fields.Status, 'Open');
  const r = syncDevelopment(w, manifest({ issues: [{ name: target, status: 'Fixed', severity: 'Low' }] }));
  assert.equal(r.applied, true);
  assert.equal(r.updated, 1);
  const after = findIssue(w, target);
  assert.equal(after.fields.Status, 'Fixed');
  assert.equal(after.fields.Severity, 'Low');
});

test('an unmatched manifest row is created, description and all', () => {
  const w = seedWeaver(new Weave());
  const r = syncDevelopment(w, manifest({
    issues: [{ name: 'Brand-new upstream issue', status: 'Fixed', severity: 'High', symptom: ['Error'], description: '**Pain point.** Upstream.' }],
    features: [{ name: 'Brand-new upstream feature', status: 'Shipped', milestone: 'v0.3' }],
  }));
  assert.equal(r.created, 2);
  const issue = findIssue(w, 'Brand-new upstream issue');
  assert.equal(issue.fields.Status, 'Fixed');
  assert.deepEqual(issue.fields.Symptom, ['Error']);
  assert.match(issue.docs.Description, /Upstream/);
});

test('rows the manifest does not name are left alone', () => {
  const w = seedWeaver(new Weave());
  const issuesT = w.listTables().find((t) => t.name === 'Issue');
  const local = w.createEntity(issuesT.id, { name: 'A locally filed bug', values: { Severity: 'High' } });
  syncDevelopment(w, manifest({ issues: [{ name: 'Something else entirely', status: 'Open' }] }));
  const still = w.readEntity(local.id);
  assert.equal(still.fields.Status, 'Open');
  assert.equal(still.fields.Severity, 'High');
});

test('one manifest applies once — the stamp makes reboots free', () => {
  const w = seedWeaver(new Weave());
  const m = manifest({ issues: [{ name: 'Stamped issue', status: 'Open' }] });
  assert.equal(syncDevelopment(w, m).applied, true);
  assert.equal(syncDevelopment(w, m).applied, false);
});

test('the shipped manifest is present, well-formed, and matches the package version', () => {
  const path = join(ROOT, 'docs', 'development.json');
  assert.ok(existsSync(path), 'docs/development.json ships with every build');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(m.version, pkg.version, 'export-development.mjs must be re-run for a release');
  assert.ok(m.issues.length >= 50, `a real issue list, found ${m.issues.length}`);
  assert.ok(m.features.length >= 50, `a real roadmap, found ${m.features.length}`);
  for (const row of [...m.issues, ...m.features]) {
    assert.ok(row.name, 'every row is named');
    assert.ok(row.status, `'${row.name}' carries its status`);
  }
});

/* Release notes (2026-09-04, Kyle): every release is a Development/Release
   row whose Description holds the notes, and a build whose package version
   has no such row with notes does not pass the suite. */
const findRelease = (w, name) => {
  const db = w.listTables().find((t) => t.name === 'Release');
  return db && w.listEntities(db.id).map((e) => w.readEntity(e.id)).find((e) => e.name === name);
};

test('a fresh workspace has Development/Release with Date, Commit and both relations', () => {
  const w = seedWeaver(new Weave());
  const db = w.listTables().find((t) => t.name === 'Release');
  assert.ok(db, 'Development/Release exists');
  assert.equal(w.getSpace(db.spaceId).name, 'Development');
  const names = Object.values(w.getTable(db.id).fields).map((f) => f.name);
  for (const n of ['Date', 'Commit', 'Fixes', 'Ships', 'Description']) assert.ok(names.includes(n), `${n} field`);
  const issueFields = Object.values(w.getTable('Development/Issue').fields).map((f) => f.name);
  assert.ok(issueFields.includes('Fixed in'), 'Issue carries the inverse');
});

test('sync creates the Release table on a workspace seeded before it existed, then the rows', () => {
  const w = seedWeaver(new Weave());
  const rel = w.listTables().find((t) => t.name === 'Release');
  w.deleteTable(rel.id, { hard: true });
  assert.equal(w.listTables().find((t) => t.name === 'Release'), undefined);
  const target = 'No filter-builder UI (filters are API/CLI/MCP only)';
  const r = syncDevelopment(w, manifest({
    issues: [{ name: target, status: 'Fixed', severity: 'Medium' }],
    releases: [{ name: 'v9.9.9', date: '2026-09-05', commit: 'abc1234', description: '## v9.9.9\n\n- fixed the filter builder', fixes: [target] }],
  }));
  assert.equal(r.applied, true);
  const rel2 = findRelease(w, 'v9.9.9');
  assert.ok(rel2, 'release row created');
  assert.equal(rel2.fields.Date, '2026-09-05');
  assert.equal(rel2.fields.Commit, 'abc1234');
  assert.match(rel2.docs.Description, /filter builder/);
  assert.deepEqual(rel2.fields.Fixes.map((x) => x.name ?? x), [target]);
  assert.deepEqual(findIssue(w, target).fields['Fixed in'].map((x) => x.name ?? x), ['v9.9.9']);
});

test('sync refuses a release row without notes', () => {
  const w = seedWeaver(new Weave());
  assert.throws(
    () => syncDevelopment(w, manifest({ releases: [{ name: 'v9.9.9', date: '2026-09-05', commit: 'abc1234' }] })),
    /release v9\.9\.9 has no notes/,
  );
});

test('the shipped manifest carries release notes for the package version', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'docs', 'development.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(m.releases) && m.releases.length >= 1, 'releases exported');
  const current = m.releases.find((r) => r.name === `v${pkg.version}`);
  assert.ok(current, `a Development/Release row named v${pkg.version} — write the notes, then re-run export-development.mjs`);
  assert.ok((current.description ?? '').trim().length >= 40, `v${pkg.version} release notes are written`);
  for (const r of m.releases) {
    assert.ok(r.date, `${r.name} is dated`);
    assert.ok((r.description ?? '').trim(), `${r.name} has notes`);
  }
});
