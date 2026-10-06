import { randomUUID } from 'node:crypto';

export function uuid() {
  return randomUUID();
}

export function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}
