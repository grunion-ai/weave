import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { lanes } from './lanes.mjs';
import { gating, prSelection, unitReach } from './ci-test.mjs';

const ROOT = resolve(import.meta.dirname, '..');

export function selectTests({ files, changed, read, root = ROOT, diff = '' }) {
  const all = [...new Set(files)].sort();
  if (!all.length) throw new Error('No test files discovered; refusing an empty verification.');
  const changes = [...new Set(changed)].sort();
  if (changes.length && changes.every(file => all.includes(file))) {
    return { files: changes, mode: 'targeted', reasons: ['Only test files changed; run every changed test.'] };
  }
  const full = (reasons) => ({ files: all, mode: 'full', reasons });
  if (!changes.length) return full(['No changed files found; full suite required rather than an empty pass.']);
  const groups = gating(lanes(all, root));
  const reader = read ?? (file => readFileSync(join(root, file), 'utf8'));
  let pick;
  let unit;
  try {
    pick = prSelection(groups, changes, reader, diff);
    unit = unitReach(pick.unit, changes, reader);
  } catch (error) {
    return full([`PR gate selection unavailable (${error.message}); full suite required.`]);
  }
  const selected = [...new Set([...unit, ...pick.browser, ...changes.filter(file => all.includes(file))])].sort();
  return {
    files: selected,
    mode: 'pr',
    reasons: [
      `${changes.filter(file => !all.includes(file)).length} non-test change(s); PR gate selection: ${unit.length} of ${groups.unit.length} unit and ${pick.browser.length} of ${groups.browser.length} browser suites${pick.shared ? ' (shared code changed: every gating browser suite)' : ''}.`,
      'CI gate runs the full inventory on main.',
    ],
  };
}

export function affectedTests(root, base = 'HEAD') {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const names = (...args) => git(...args).split('\0').filter(Boolean);
  const changed = [...names('diff', '--name-only', '--no-renames', '-z', base, '--'), ...names('ls-files', '--others', '--exclude-standard', '-z')];
  const diff = git('diff', '-W', '--no-renames', base, '--', 'public', 'src', 'bin');
  const files = [];
  function discover(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) discover(file);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(file);
    }
  }
  discover('test');
  return selectTests({ files, changed, root, diff });
}
