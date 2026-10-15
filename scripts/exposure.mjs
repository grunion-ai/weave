import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROD = 'https://weave.grunion.ai';

export function probeUrls(name, { base, hostDomain = null }) {
  const urls = [`${base}/w/${encodeURIComponent(name)}/api/tables`];
  if (hostDomain && /^[a-z0-9-]+$/i.test(name)) urls.push(`${new URL(base).protocol}//${name.toLowerCase()}.${hostDomain}/api/tables`);
  return urls;
}

export async function exposed(io, { base, hostDomain = null, publicNames = [] }) {
  const workspaces = await io.list();
  if (!Array.isArray(workspaces) || !workspaces.length) throw new Error('the workspace list came back with no workspaces');
  const open = new Set(publicNames.map((n) => String(n).toLowerCase()));
  const found = [];
  for (const { name } of workspaces) {
    for (const url of probeUrls(name, { base, hostDomain })) {
      const status = await io.status(url);
      if (status === 200 && !open.has(String(name).toLowerCase())) found.push({ name, url, status });
    }
  }
  return found;
}

export function realIO({ base, token }) {
  return {
    list: async () => {
      if (!token) throw new Error('no deploy token: set WEAVE_DEPLOY_TOKEN to the instance supervisor token');
      const r = await fetch(`${base}/_supervisor/workspaces`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`the workspace list answered HTTP ${r.status}`);
      return r.json();
    },
    status: async (url) => (await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })).status,
  };
}

async function main(env = process.env) {
  const base = (env.WEAVE_PROBE_BASE || PROD).replace(/\/$/, '');
  const hostDomain = env.WEAVE_PROBE_HOST_DOMAIN ?? new URL(base).hostname;
  const publicNames = String(env.PUBLIC_WORKSPACES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const found = await exposed(realIO({ base, token: env.WEAVE_DEPLOY_TOKEN }), { base, hostDomain: hostDomain || null, publicNames });
  const lines = found.length
    ? found.map((x) => `EXPOSED ${x.name}: GET ${x.url} answered ${x.status} to an anonymous caller`)
    : [`No workspace on ${base} answers its tables anonymously${publicNames.length ? ` (public by choice: ${publicNames.join(', ')})` : ''}`];
  for (const line of lines) console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (found.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
