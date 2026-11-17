import { createReadStream } from 'node:fs';
import { tarWriter, streamTar, unsealed } from '../../src/backup.js';

export function packTar(out, entries) {
  const t = tarWriter(out);
  for (const e of entries) t.add(e);
  t.close();
}

export async function readTar(source, passphrase = null) {
  const chunks = passphrase ? unsealed(source, passphrase) : Buffer.isBuffer(source) ? [source] : createReadStream(source);
  const entries = [];
  await streamTar(chunks, (name) => {
    const parts = [];
    return { write: (b) => parts.push(Buffer.from(b)), close: () => entries.push({ name, data: Buffer.concat(parts) }) };
  });
  return entries;
}
