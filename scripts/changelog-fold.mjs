#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAGMENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+\.md$/;

function section(lines, test) {
  const start = lines.findIndex(test);
  if (start < 0) return null;
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return { start, end: next < 0 ? lines.length : next };
}

export function fold(md, fragments, { version, date }) {
  const lines = md.split('\n');
  const blocks = [];
  const un = section(lines, (l) => /^## Unreleased\s*$/.test(l));
  if (un) {
    const body = lines.slice(un.start + 1, un.end).join('\n').trim();
    if (body) blocks.push(body);
    lines.splice(un.start, un.end - un.start);
  }
  const byName = [...fragments].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const empty = byName.filter((f) => !f.text.trim()).map((f) => `changelog.d/${f.name} is empty`);
  if (empty.length) throw new Error(`${empty.join('; ')}: write its bullet before the release folds it`);
  for (const f of byName) blocks.push(f.text.trim());
  if (!blocks.length) return lines.join('\n');

  const body = blocks.join('\n').split('\n');
  const heading = new RegExp(`^## v${version.replace(/\./g, '\\.')}(?:\\s|$)`);
  const at = section(lines, (l) => heading.test(l));
  if (at) {
    let end = at.end;
    while (end > at.start + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, ...(end === at.start + 1 ? [''] : []), ...body);
  } else {
    const first = lines.findIndex((l) => l.startsWith('## '));
    lines.splice(first < 0 ? lines.length : first, 0, `## v${version} (${date})`, '', ...body, '');
  }
  return lines.join('\n');
}

export function stampServerJson(root, version) {
  const file = join(root, 'server.json');
  if (!existsSync(file)) return false;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const before = JSON.stringify(doc);
  doc.version = version;
  for (const p of doc.packages ?? []) {
    if (p.registryType !== 'oci') continue;
    p.identifier = /:[^/:]*$/.test(p.identifier) ? p.identifier.replace(/:[^/:]*$/, `:${version}`) : `${p.identifier}:${version}`;
  }
  if (JSON.stringify(doc) === before) return false;
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return true;
}
export function foldRepo(root, { date = new Date().toLocaleDateString('en-CA') } = {}) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  stampServerJson(root, version);
  const dir = join(root, 'changelog.d');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')) : [];
  const fragments = names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  const file = join(root, 'CHANGELOG.md');
  const before = readFileSync(file, 'utf8');
  const after = fold(before, fragments, { version, date });
  if (after !== before) writeFileSync(file, after);
  for (const n of names) rmSync(join(dir, n));
  return { version, folded: names.length, changed: after !== before };
}

export const VERSION_HEADING = /^## v\d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)$/;

export function changelogGuard({ addedLines = [], versionBefore, versionAfter }) {
  const added = addedLines.filter((l) => !VERSION_HEADING.test(l)).length;
  if (!added || versionBefore !== versionAfter) return null;
  return `CHANGELOG.md gains ${added} line(s) but package.json stays at ${versionAfter}. `
    + 'Write changelog.d/<short-slug>-<Issue or Feature number>.md instead; only a release commit edits CHANGELOG.md, through scripts/changelog-fold.mjs.';
}

const CODE_PATH = /^(?:src|public|bin|scripts)\//;
const SUBJECT_ROW = /\((?:Issue|Feature)s? #\d+/;
const NO_CHANGELOG = /^No-changelog:[ \t]*\S/m;

export function fragmentGuard({ subject = '', message = '', files = [], fragmentsAdded = 0, versionBefore, versionAfter }) {
  if (versionBefore !== versionAfter) return null;
  if (fragmentsAdded || !SUBJECT_ROW.test(subject) || NO_CHANGELOG.test(message)) return null;
  const code = files.find((f) => CODE_PATH.test(f));
  if (!code) return null;
  return `"${subject}" changes ${code} and names its row, but adds no changelog.d/ fragment. `
    + 'Write changelog.d/<short-slug>-<Issue or Feature number>.md in the same commit, holding the bullet the release folds, '
    + 'or say why it owes none in a `No-changelog: <reason>` trailer.';
}

export function openSecurityCitations(fragments, issues) {
  const held = new Map(issues.filter((i) => i.status !== 'Fixed' && /\bsecurity finding\b/i.test(i.name)).map((i) => [i.number, i]));
  const hits = [];
  for (const f of fragments) {
    for (const [refs] of f.text.matchAll(/\bIssues? #\d+(?:(?:,| and|, and) #\d+)*/g)) {
      for (const [, n] of refs.matchAll(/#(\d+)/g)) {
        const row = held.get(Number(n));
        if (row) hits.push(`changelog.d/${f.name} cites Issue #${n} (${row.name}), which is still ${row.status}`);
      }
    }
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--date');
  const opts = i > 0 ? { date: process.argv[i + 1] } : {};
  const r = foldRepo(resolve(dirname(fileURLToPath(import.meta.url)), '..'), opts);
  console.log(r.changed ? `folded ${r.folded} fragment(s) into ## v${r.version}` : `nothing to fold for v${r.version}`);
}
