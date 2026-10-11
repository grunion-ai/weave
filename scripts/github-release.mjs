import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateRun(run, jobs, repo, { activeRunId } = {}) {
  if (run.name !== 'tests' || run.path !== '.github/workflows/test.yml' || run.event !== 'push' || run.head_branch !== 'main' || run.head_repository?.full_name !== repo || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) throw new Error('Release requires same-repository main push tests');
  if (!jobs.some((job) => job.name === 'CI gate' && job.status === 'completed' && job.conclusion === 'success')) throw new Error('Required CI gate did not succeed');
  const deliveryJobs = new Set(['Release / guard', 'Release / publish']);
  const failed = jobs.filter((job) => job.conclusion && !['success', 'skipped', 'neutral'].includes(job.conclusion));
  const deliveryFailed = failed.length > 0 && failed.every((job) => deliveryJobs.has(job.name));
  const active = activeRunId !== undefined && String(run.id) === String(activeRunId) && run.status === 'in_progress';
  const completed = run.status === 'completed' && (run.conclusion === 'success' || (run.conclusion === 'failure' && deliveryFailed));
  if (!active && !completed) throw new Error('Release requires completed successful tests or its own active gated run');
  if (failed.some((job) => !deliveryJobs.has(job.name))) throw new Error('Required test job failed');
  return run.head_sha;
}

export function releaseMetadata(pkg, changelog, manifest) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version ?? '')) throw new Error('Invalid release version');
  const tag = `v${pkg.version}`;
  const release = manifest.releases?.find((entry) => entry.name === tag);
  if (manifest.version !== pkg.version || !release?.description?.trim()) throw new Error('Release requires matching tracker manifest and release notes');
  const section = changelog.split(/^## /m).find((part) => part.split(/\s/)[0] === tag);
  const notes = section?.split('\n').slice(1).join('\n').trim();
  if (!notes) throw new Error(`CHANGELOG.md requires nonempty ## ${tag} section`);
  return { version: pkg.version, tag, notes };
}

export async function publishRelease(metadata, sha, io) {
  if (await io.main() !== sha) return { state: 'superseded', ...metadata };
  const existing = await io.tag(metadata.tag);
  const release = await io.release(metadata.tag);
  if (release && (release.draft || release.prerelease)) throw new Error('Existing release is draft or prerelease');
  if (existing && existing !== sha) {
    if (release && await io.ancestor(existing, sha, metadata.version)) return { state: 'unchanged', ...metadata };
    throw new Error(`Existing ${metadata.tag} names a different commit; refusing to move it`);
  }
  if (await io.main() !== sha) return { state: 'superseded', ...metadata };
  if (!existing) await io.createTag(metadata.tag, sha);
  if (await io.tag(metadata.tag) !== sha) throw new Error('Published tag does not match tested SHA');
  if (!release) await io.createRelease(metadata, sha);
  const published = await io.release(metadata.tag);
  if (!published || published.draft || published.prerelease) throw new Error('GitHub release was not published');
  return { state: 'published', ...metadata };
}

export async function waitForDeployment(url, metadata, { attempts = 90, delayMs = 10_000, allowImage = false, fetch = globalThis.fetch } = {}) {
  let last = 'no health response';
  for (let attempt = 0; attempt < attempts; attempt++) {
    let health;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'cache-control': 'no-cache' } });
      health = await response.json();
      if (response.ok && health.ok && health.version === metadata.version && (health.supervisor?.release === metadata.tag || (allowImage && health.supervisor?.release === 'image'))) return health;
      last = `HTTP ${response.status}, version ${health.version}, release ${health.supervisor?.release}`;
    } catch (error) { last = error.message; }
    if (health?.supervisor?.failed?.includes(metadata.version)) throw new Error(`Supervisor rejected ${metadata.tag}`);
    if (attempt + 1 < attempts) await new Promise((done) => setTimeout(done, delayMs));
  }
  throw new Error(`Deployment did not reach ${metadata.tag}: ${last}`);
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000, ...options }).trim();
}

function api(path, { optional = false, ...options } = {}) {
  try { return JSON.parse(gh(['api', path, ...(options.input ? ['--input', '-'] : [])], options)); }
  catch (error) {
    if (optional && /HTTP 404/.test(String(error.stderr))) return null;
    throw error;
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.CI_RUN_ID;
  if (repo !== 'grunion-ai/weave' || !/^\d+$/.test(runId ?? '')) throw new Error('Expected repository and numeric CI_RUN_ID');
  const base = `repos/${repo}`;
  const run = api(`${base}/actions/runs/${runId}`);
  const pages = JSON.parse(gh(['api', `${base}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, '--paginate', '--slurp']));
  const activeRunId = process.env.GITHUB_EVENT_NAME === 'push' ? process.env.GITHUB_RUN_ID : undefined;
  const sha = validateRun(run, pages.flatMap((page) => page.jobs), repo, { activeRunId });
  const io = {
    main: async () => api(`${base}/git/ref/heads/main`).object.sha,
    tag: async (tag) => {
      let object = api(`${base}/git/ref/tags/${tag}`, { optional: true })?.object;
      for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) object = api(`${base}/git/tags/${object.sha}`).object;
      if (object && object.type !== 'commit') throw new Error('Tag does not resolve to a commit');
      return object?.sha ?? null;
    },
    release: async (tag) => api(`${base}/releases/tags/${tag}`, { optional: true }),
    ancestor: async (older, newer, version) => {
      const comparison = api(`${base}/compare/${older}...${newer}`);
      const pkg = api(`${base}/contents/package.json?ref=${older}`);
      return ['ahead', 'identical'].includes(comparison.status) && JSON.parse(Buffer.from(pkg.content, 'base64')).version === version;
    },
    createTag: async (tag, commit) => api(`${base}/git/refs`, { input: JSON.stringify({ ref: `refs/tags/${tag}`, sha: commit }) }),
    createRelease: async (metadata, commit) => gh(['release', 'create', metadata.tag, '--repo', repo, '--verify-tag', '--target', commit, '--title', `weave ${metadata.tag}`, '--notes-file', '-', '--latest'], { input: metadata.notes }),
  };
  if (process.argv.includes('--guard')) {
    const current = await io.main() === sha;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\ncurrent=${current}\n`);
    console.log(JSON.stringify({ sha, current }));
    return;
  }
  if (gitHead() !== sha) throw new Error('Checkout is not the tested commit');
  const metadata = releaseMetadata(JSON.parse(readFileSync('package.json', 'utf8')), readFileSync('CHANGELOG.md', 'utf8'), JSON.parse(readFileSync('docs/development.json', 'utf8')));
  const result = await publishRelease(metadata, sha, io);
  console.log(JSON.stringify({ state: result.state, tag: result.tag, sha }));
  if (result.state !== 'superseded') {
    const health = await waitForDeployment('https://weave.grunion.ai/api/health', metadata, { allowImage: result.state === 'unchanged' });
    console.log(JSON.stringify({ healthy: true, version: health.version, release: health.supervisor.release }));
  }
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
