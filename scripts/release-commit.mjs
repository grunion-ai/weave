#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE = 'Development/Release';

export function landedLine(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(String(sha))) throw new Error(`${sha} is not a commit sha`);
  return `\n\nLanded on main as ${sha}.`;
}

export async function writeReleaseCommit(call, { id, name, sha }) {
  const line = landedLine(sha);
  await call(`/api/entities/${id}`, { method: 'PATCH', body: { Commit: sha } });
  await call(`/api/entities/${id}/doc`, { method: 'POST', body: { doc: line } });
  const after = await call(`/api/entities/${id}`);
  const notes = after.docs?.Description ?? '';
  if (!notes.trim()) {
    throw new Error(`Release ${name} came back with no notes after the commit write — restore them from docs/development.json on the tracker before the next release`);
  }
  if (!notes.includes(sha)) {
    throw new Error(`Release ${name} came back without ${sha} after the commit write — read the row on the tracker before the next release`);
  }
  return { sha, notes: notes.length };
}

export function httpTracker(base, token, { fetchImpl = fetch } = {}) {
  const root = base.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return async (path, init = {}) => {
    const res = await fetchImpl(`${root}${path}`, { ...init, headers, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
    if (!res.ok) throw new Error(`${root}${path} answered ${res.status}`);
    return res.json();
  };
}

export async function findRelease(call, name) {
  const page = await call(`/api/tables/${encodeURIComponent(TABLE)}/query`, { method: 'POST', body: { where: [['Name', '=', name]], limit: 2 } });
  const row = (page.items ?? []).find((r) => r.name === name);
  if (!row) throw new Error(`No ${TABLE} row named ${name} on the tracker`);
  return row;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: opts } = parseArgs({
    options: { from: { type: 'string' }, 'token-env': { type: 'string' }, release: { type: 'string' }, sha: { type: 'string' } },
  });
  try {
    if (!opts.from || !opts.release || !opts.sha) throw new Error('usage: release-commit.mjs --from <workspace base url> --token-env <var> --release v<version> --sha <merged sha>');
    const token = opts['token-env'] ? process.env[opts['token-env']] : '';
    if (opts['token-env'] && !token) throw new Error(`--token-env ${opts['token-env']}: that variable is empty`);
    const call = httpTracker(opts.from, token);
    const row = await findRelease(call, opts.release);
    const done = await writeReleaseCommit(call, { id: row.id, name: row.name, sha: opts.sha });
    console.log(`${opts.release}: Commit ${done.sha}, ${done.notes} characters of notes read back`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
