import { randomUUID } from 'node:crypto';

export function uuid() {
  return randomUUID();
}

// Stable slug used for option/state ids so exports stay readable.
export function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}
