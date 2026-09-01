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
