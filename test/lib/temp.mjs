import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = [];
let hooked = false;

export function sweepTempDirs() {
  for (const dir of made.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

export function tempDir(prefix) {
  if (!hooked) {
    hooked = true;
    process.on('exit', sweepTempDirs);
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
