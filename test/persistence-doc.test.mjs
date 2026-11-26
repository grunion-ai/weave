import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const DOC = 'docs/persistence.md';

const REQUIRED = [
  '#mark', '#dirtyAll', '#oneSave', 'maybeRefresh', 'changedExternally', 'JOURNAL_CAP',
  'UNDO_CAP', 'DOC_REVISION_CAP', 'writeFileDurable', 'siblingNames', 'heldOpen', 'VACUUM INTO',
  "'weave-backup/1'", ".endsWith('.tmp')",
];

const rows = () => {
  const text = read(DOC);
  const start = text.indexOf('\n## Where each rule lives\n');
  assert.ok(start >= 0, `${DOC} has a "Where each rule lives" table`);
  return text.slice(start).split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => {
      const [, code, file, value] = l.split('|').map((c) => c.trim());
      return { line: l, code: code.replace(/^`|`$/g, ''), file: file.replace(/^`|`$/g, ''), value: value.replace(/^`|`$/g, '') };
    });
};

test('the persistence contract is a doc both maintainer routes link (Issue #1665)', () => {
  assert.ok(existsSync(join(ROOT, DOC)), `${DOC} states the persistence rules a write path must keep`);
  assert.match(read('CLAUDE.md'), /\]\(docs\/persistence\.md\)/, 'CLAUDE.md routes persistence work to the doc');
  assert.match(read('CLAUDE.md'), /`test\/persistence-doc\.test\.mjs`/, 'CLAUDE.md names this gate');
  assert.match(read('DEVELOPMENT.md'), /\]\(docs\/persistence\.md\)/, 'DEVELOPMENT.md links the doc');
});

test('every symbol the persistence doc cites is in the file it names, with the value it states (Issue #1665)', () => {
  const all = rows();
  const cited = new Set(all.map((r) => r.code));
  for (const name of REQUIRED) assert.ok(cited.has(name), `${DOC} places ${name}`);
  const misses = [];
  for (const { line, code, file, value } of all) {
    if (!existsSync(join(ROOT, file))) { misses.push(`${file} is gone (${line})`); continue; }
    const src = read(file);
    if (!src.includes(code)) misses.push(`${code} is not in ${file}`);
    if (value && !new RegExp(`\\b${code.replace(/[^\w]/g, '')}\\s*=\\s*${value}\\b`).test(src)) misses.push(`${code} is not ${value} in ${file}`);
  }
  assert.deepEqual(misses, [], `${DOC} names code that moved; fix the doc or the code`);
});
