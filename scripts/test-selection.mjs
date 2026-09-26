import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Rehearsal is a CLI-only command: bin/weave.js is its sole production caller.
const isolated = {
  'src/rehearse.js': ['test/rehearse.test.mjs', 'test/cli.test.mjs', 'test/cli-config.test.mjs'],
};

export function selectTests({ files, changed }) {
  const all = [...new Set(files)].sort();
  if (!all.length) throw new Error('No test files discovered; refusing an empty verification.');
  const changes = [...new Set(changed)].sort();
  if (changes.length && changes.every(file => all.includes(file))) {
    return { files: changes, mode: 'targeted', reasons: ['Only test files changed; run every changed test.'] };
  }
  const mapped = changes.flatMap(file => all.includes(file) ? [file] : (isolated[file] ?? []));
  if (changes.length && changes.every(file => all.includes(file) || isolated[file]) && mapped.every(file => all.includes(file))) {
    return { files: [...new Set(mapped)].sort(), mode: 'targeted', reasons: changes.map(file => `${file}: ${isolated[file] ? 'isolated CLI module; regression and CLI contracts' : 'changed test'}.`) };
  }
  // ponytail: reviewed CLI mapping only; expand after proving callers and coverage, never infer UI scope from names.
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
  // Include both paths of renames so moving a shared helper cannot appear test-only.
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
