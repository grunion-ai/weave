import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRun, releaseMetadata, publishRelease, waitForDeployment } from '../scripts/github-release.mjs';

const sha = 'a'.repeat(40);
const repo = 'grunion-ai/weave';
const run = { id: 123, name: 'tests', path: '.github/workflows/test.yml', event: 'push', head_branch: 'main', head_sha: sha, head_repository: { full_name: repo }, status: 'completed', conclusion: 'success' };
const jobs = [{ name: 'CI gate', conclusion: 'success', status: 'completed' }];
const metadata = { version: '1.2.3', tag: 'v1.2.3', notes: '- Fixed delivery.' };
const manifest = { version: '1.2.3', releases: [{ name: 'v1.2.3', description: 'Fixed delivery.' }] };

test('only successful same-repository main push CI with its required gate authorizes delivery', () => {
  assert.equal(validateRun(run, jobs, repo), sha);
  for (const patch of [{ event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/fake.yml' }, { head_repository: { full_name: 'fork/weave' } }, { head_sha: 'main' }]) {
    assert.throws(() => validateRun({ ...run, ...patch }, jobs, repo));
  }
  for (const invalid of [[], [{ ...jobs[0], conclusion: 'skipped' }], [{ ...jobs[0], status: 'queued' }]]) assert.throws(() => validateRun(run, invalid, repo));
});

test('release requires matching manifest notes and nonempty exact changelog section', () => {
  assert.deepEqual(releaseMetadata({ version: '1.2.3' }, '## v1.2.3\n\n- Fixed delivery.\n\n## v1.2.2\nOld', manifest), metadata);
  for (const version of ['1.2', '1.2.3;bad', '01.2.3']) assert.throws(() => releaseMetadata({ version }, '', manifest));
  for (const invalid of [{ ...manifest, version: '1.2.2' }, { ...manifest, releases: [] }, { ...manifest, releases: [{ name: 'v1.2.3', description: ' ' }] }]) assert.throws(() => releaseMetadata({ version: '1.2.3' }, '## v1.2.3\nNotes', invalid));
  assert.throws(() => releaseMetadata({ version: '1.2.3' }, '## v1.2.30\nNotes', manifest));
});

function fixture({ main = sha, tag = null, release = null, ancestor = false } = {}) {
  const writes = [];
  return { writes, io: {
    main: async () => main,
    tag: async () => tag,
    release: async () => release,
    ancestor: async () => ancestor,
    createTag: async (name, commit) => { writes.push(['tag', name, commit]); tag = commit; },
    createRelease: async (value, commit) => { writes.push(['release', value.tag, commit]); release = { draft: false, prerelease: false }; },
  } };
}

test('publishes exact tested SHA once and retry resumes after tag creation', async () => {
  const f = fixture();
  assert.equal((await publishRelease(metadata, sha, f.io)).state, 'published');
  assert.deepEqual(f.writes, [['tag', 'v1.2.3', sha], ['release', 'v1.2.3', sha]]);
  assert.equal((await publishRelease(metadata, sha, f.io)).state, 'published');
  assert.equal(f.writes.length, 2);
  const partial = fixture({ tag: sha });
  await publishRelease(metadata, sha, partial.io);
  assert.deepEqual(partial.writes, [['release', 'v1.2.3', sha]]);
});

test('stale runs skip, mismatched tags fail, published ancestor versions remain unchanged', async () => {
  const stale = fixture({ main: 'b'.repeat(40) });
  assert.equal((await publishRelease(metadata, sha, stale.io)).state, 'superseded');
  assert.equal(stale.writes.length, 0);
  for (const options of [{ tag: 'b'.repeat(40) }, { tag: 'b'.repeat(40), ancestor: true }, { tag: sha, release: { draft: true } }]) await assert.rejects(publishRelease(metadata, sha, fixture(options).io));
  const old = fixture({ tag: 'b'.repeat(40), ancestor: true, release: { draft: false, prerelease: false } });
  assert.equal((await publishRelease(metadata, sha, old.io)).state, 'unchanged');
  assert.equal(old.writes.length, 0);
});

test('health waits for exact version and tag; baseline image allowed only for unchanged releases', async () => {
  let calls = 0;
  const health = { ok: true, version: '1.2.3', supervisor: { release: 'v1.2.3', failed: [] } };
  const options = { attempts: 2, delayMs: 0, fetch: async () => ({ ok: true, json: async () => ++calls === 1 ? { ...health, version: '1.2.2' } : health }) };
  assert.deepEqual(await waitForDeployment('https://example.com/api/health', metadata, options), health);
  const image = { ...options, attempts: 1, fetch: async () => ({ ok: true, json: async () => ({ ...health, supervisor: { release: 'image' } }) }) };
  await assert.rejects(waitForDeployment('https://example.com/api/health', metadata, image));
  await waitForDeployment('https://example.com/api/health', metadata, { ...image, allowImage: true });
  await assert.rejects(waitForDeployment('https://example.com/api/health', metadata, { ...image, fetch: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(waitForDeployment('https://example.com/api/health', metadata, { ...image, fetch: async () => ({ ok: true, json: async () => ({ ...health, supervisor: { release: 'v1.2.2', failed: ['1.2.3'] } }) }) }), /rejected/);
});

test('publication stops on write failures and a later retry resumes safely', async () => {
  const f = fixture();
  const publish = f.io.createRelease;
  f.io.createRelease = async () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(publishRelease(metadata, sha, f.io), /GitHub unavailable/);
  assert.deepEqual(f.writes, [['tag', metadata.tag, sha]]);
  f.io.createRelease = publish;
  await publishRelease(metadata, sha, f.io);
  assert.deepEqual(f.writes, [['tag', metadata.tag, sha], ['release', metadata.tag, sha]]);
  const race = fixture();
  let checks = 0;
  race.io.main = async () => ++checks === 1 ? sha : 'b'.repeat(40);
  assert.equal((await publishRelease(metadata, sha, race.io)).state, 'superseded');
  assert.equal(race.writes.length, 0);
});


test('reusable delivery accepts only its own active run after CI gate completes', () => {
  const active = { ...run, status: 'in_progress', conclusion: null };
  assert.equal(validateRun(active, jobs, repo, { activeRunId: run.id }), sha);
  assert.throws(() => validateRun(active, jobs, repo));
  assert.throws(() => validateRun(active, jobs, repo, { activeRunId: 456 }));
  assert.throws(() => validateRun(active, [{ ...jobs[0], conclusion: 'skipped' }], repo, { activeRunId: run.id }));
});

test('recovery accepts a delivery failure but refuses failed or canceled required tests', () => {
  const failed = { ...run, conclusion: 'failure' };
  const delivery = { name: 'Release / publish', conclusion: 'failure', status: 'completed' };
  assert.equal(validateRun(failed, [...jobs, delivery], repo), sha);
  assert.throws(() => validateRun(failed, [...jobs, { ...delivery, name: 'Unit tests' }], repo));
  assert.throws(() => validateRun(failed, [...jobs, { name: 'Browser 1', conclusion: 'cancelled', status: 'completed' }], repo));
});
