#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK = join(ROOT, 'security/vendor.lock.json');
export const VENDOR_DIRS = ['public/vendor', 'src/vendor'];

export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const readLock = () => JSON.parse(readFileSync(LOCK, 'utf8'));

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
export function vendorFiles(root = ROOT) {
  return VENDOR_DIRS.flatMap((d) => (existsSync(join(root, d)) ? walk(join(root, d)) : []))
    .map((p) => p.slice(root.length + 1))
    .filter((p) => !p.endsWith('.DS_Store'))
    .sort();
}

export function diffLock(lock, root = ROOT) {
  const listed = new Map();
  for (const lib of lock.libraries) for (const f of lib.files) listed.set(f.path, f.sha256);
  const missing = [], changed = [];
  for (const [path, hash] of listed) {
    const abs = join(root, path);
    if (!existsSync(abs)) missing.push(path);
    else if (sha256(abs) !== hash) changed.push(path);
  }
  const unlisted = vendorFiles(root).filter((p) => !listed.has(p));
  return { missing, changed, unlisted };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--update') {
  const lock = readLock();
  for (const lib of lock.libraries) for (const f of lib.files) f.sha256 = sha256(join(ROOT, f.path));
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log('rehashed', lock.libraries.reduce((n, l) => n + l.files.length, 0), 'files');
}
