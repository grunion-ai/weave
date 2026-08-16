import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// Atomic JSON persistence. Pass a null path for a purely in-memory store (tests).
export class Store {
  constructor(path = null) {
    this.path = path;
  }

  load() {
    if (!this.path || !existsSync(this.path)) return null;
    return JSON.parse(readFileSync(this.path, 'utf8'));
  }

  save(data) {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, this.path);
  }
}
