import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function selectTests({ files, changed }) {
  const all = [...new Set(files)].sort();
  if (!all.length) throw new Error('No test files discovered; refusing an empty verification.');
  const changes = [...new Set(changed)].sort();
  if (changes.length && changes.every(file => all.includes(file))) {
    return { files: changes, mode: 'targeted', reasons: ['Only test files changed; run every changed test.'] };
  }
  return {
    files: all,
    mode: 'full',
    reasons: changes.length
      ? changes.filter(file => !all.includes(file)).map(file => `${file}: blast radius unproven; full suite required.`)
      : ['No changed files found; full suite required rather than an empty pass.'],
  };
}

export function affectedTests(root, base = 'HEAD') {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  const changed = [...git('diff', '--name-only', '--no-renames', '-z', base, '--'), ...git('ls-files', '--others', '--exclude-standard', '-z')];
  const files = [];
  function discover(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) discover(file);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(file);
    }
  }
  discover('test');
  return selectTests({ files, changed });
}
