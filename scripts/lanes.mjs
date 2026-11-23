import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export function testFiles(root = ROOT) {
  return readdirSync(join(root, 'test'), { recursive: true })
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => join('test', f).split('\\').join('/'))
    .sort();
}

const BROWSER = /(?:^|;)\s*(?:import\s[^;]*?from\s*|(?:const|let)\s[^=;]*=\s*await\s+import\(\s*)['"](?:[^'"\n]*\/lib\/browser\.mjs|playwright)['"]/m;
export function lanes(files, root = ROOT) {
  const browser = [], unit = [];
  for (const f of files) {
    let drives = /-browser\.test\.mjs$/.test(f);
    if (!drives) { try { drives = BROWSER.test(readFileSync(resolve(root, f), 'utf8')); } catch {} }
    (drives ? browser : unit).push(f);
  }
  return { unit, browser };
}
