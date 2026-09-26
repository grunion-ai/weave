#!/usr/bin/env node
/* Fold changelog fragments into CHANGELOG.md at release time (Issue #408).

   Each change writes changelog.d/<short-slug>-<Issue or Feature number>.md
   holding its bullet(s) and never edits CHANGELOG.md, so two open changes
   never touch the same file and Gerrit can rebase them on its own. The
   release commit runs this after bumping package.json:

     node scripts/changelog-fold.mjs [--date YYYY-MM-DD]

   It moves any `## Unreleased` bullets (older habit) and then every fragment,
   sorted by file name, under `## v<package.json version> — <date>` (appending
   when that heading already exists), writes CHANGELOG.md and deletes the
   fragments. A second run finds nothing to fold and changes nothing. */
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAGMENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+\.md$/;

/* [start, end) of the first `## ` section whose heading passes `test`. */
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
  for (const f of byName) if (f.text.trim()) blocks.push(f.text.trim());
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
    lines.splice(first < 0 ? lines.length : first, 0, `## v${version} — ${date}`, '', ...body, '');
  }
  return lines.join('\n');
}

export function foldRepo(root, { date = new Date().toLocaleDateString('en-CA') } = {}) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
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

/* Only a release commit edits CHANGELOG.md. Removals pass (moving bullets out). */
export function changelogGuard({ added, versionBefore, versionAfter }) {
  if (!added || versionBefore !== versionAfter) return null;
  return `CHANGELOG.md gains ${added} line(s) but package.json stays at ${versionAfter}. `
    + 'Write changelog.d/<short-slug>-<Issue or Feature number>.md instead; only a release commit edits CHANGELOG.md, through scripts/changelog-fold.mjs.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--date');
  const opts = i > 0 ? { date: process.argv[i + 1] } : {};
  const r = foldRepo(resolve(dirname(fileURLToPath(import.meta.url)), '..'), opts);
  console.log(r.changed ? `folded ${r.folded} fragment(s) into ## v${r.version}` : `nothing to fold for v${r.version}`);
}
