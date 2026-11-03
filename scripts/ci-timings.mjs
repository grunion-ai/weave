import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function timingsFrom(results) {
  const newest = new Map();
  for (const result of results) {
    const held = newest.get(result.id);
    if (!held || (result.attempt ?? 1) > (held.attempt ?? 1)) newest.set(result.id, result);
  }
  const files = {};
  const lanes = {};
  for (const result of newest.values()) {
    const lane = result.lane === 'unit' ? 'unit' : 'browser';
    lanes[lane] ??= { work: 0, wall: 0 };
    for (const summary of result.summaries ?? []) {
      if (!summary?.file || !(summary.duration_ms > 0)) continue;
      files[summary.file] = Math.max(files[summary.file] ?? 0, Math.round(summary.duration_ms));
      lanes[lane].work += summary.duration_ms;
    }
    if (result.durationMs > 0) lanes[lane].wall += result.durationMs;
  }
  const parallelism = Object.fromEntries(Object.entries(lanes)
    .filter(([, { work, wall }]) => work > 0 && wall > 0)
    .map(([lane, { work, wall }]) => [lane, Math.round((work / wall) * 100) / 100]));
  return { files, parallelism };
}

async function api(path, token, repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res;
}

export async function fetchTimings({ token, repo, workflow = 'test.yml' }) {
  const runs = await (await api(`/actions/workflows/${workflow}/runs?branch=main&event=push&status=success&per_page=1`, token, repo)).json();
  const run = runs.workflow_runs?.[0];
  if (!run) throw new Error('no successful main push run to read timings from');
  const listing = await (await api(`/actions/runs/${run.id}/artifacts?per_page=100`, token, repo)).json();
  const shards = (listing.artifacts ?? []).filter(a => /^ci-(unit|browser)-\d+-\d+$/.test(a.name) && !a.expired);
  if (!shards.length) throw new Error(`run ${run.id} kept no shard evidence`);
  const dir = mkdtempSync(join(tmpdir(), 'weave-ci-timings-'));
  try {
    const results = [];
    for (const artifact of shards) {
      const zip = join(dir, `${artifact.name}.zip`);
      writeFileSync(zip, Buffer.from(await (await api(`/actions/artifacts/${artifact.id}/zip`, token, repo)).arrayBuffer()));
      const out = join(dir, artifact.name);
      execFileSync('unzip', ['-q', '-o', zip, '-d', out]);
      for (const name of readdirSync(out)) if (name.endsWith('.json')) results.push(JSON.parse(readFileSync(join(out, name), 'utf8')));
    }
    return { run: run.id, sha: run.head_sha, ...timingsFrom(results) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node scripts/ci-timings.mjs <out.json>');
  let timings = { files: {}, parallelism: {} };
  try {
    timings = await fetchTimings({ token: process.env.GH_TOKEN, repo: process.env.GITHUB_REPOSITORY });
    console.log(`read ${Object.keys(timings.files).length} file timings from run ${timings.run} (${timings.sha}), parallelism ${JSON.stringify(timings.parallelism)}`);
  } catch (error) {
    console.log(`::warning::no file timings (${error.message}); the plan falls back to file sizes`);
  }
  writeFileSync(out, JSON.stringify(timings) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
