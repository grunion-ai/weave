import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, plan } from './ci-test.mjs';
import { testFiles, lanes } from './test.mjs';

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const allowedSkip = ({ file, reason }) => (file === 'test/security/security-scan.test.mjs' && reason === 'semgrep not installed') || (file === 'test/ws-rail-inset-browser.test.mjs' && reason.startsWith('overlay scrollbars here: no gutter to measure ('));

export function evidenceURL(origin, tree) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !SHA.test(tree)) throw new Error('Expected trusted HTTPS evidence origin and immutable tree');
  return `${url.origin}/evidence/tree/${tree}`;
}

export function verifyEvidence(evidence, policy, pr, merge) {
  const candidate = evidence.candidate ?? {};
  if (evidence.schemaVersion !== 1 || evidence.repository !== policy.repository || evidence.scope !== 'full' || evidence.state !== 'passed') throw new Error('Full passed cloud evidence required');
  for (const key of ['baseSha', 'headSha', 'mergeSha', 'tree']) if (!SHA.test(candidate[key] ?? '')) throw new Error(`Invalid candidate ${key}`);
  if (candidate.tree !== policy.tree || candidate.baseSha !== policy.parent || !Number.isSafeInteger(candidate.pr) || candidate.pr < 1) throw new Error('Evidence is for a different integrated tree or base');
  if (pr.number !== candidate.pr || pr.merged !== true || pr.merge_commit_sha !== policy.mainSha || pr.head?.sha !== candidate.headSha || pr.head?.repo?.full_name !== policy.repository || pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== policy.repository) throw new Error('Merged PR identity does not match tested candidate');
  if (merge.sha !== candidate.mergeSha || merge.tree?.sha !== policy.tree || merge.parents?.length !== 2 || merge.parents[0].sha !== candidate.baseSha || merge.parents[1].sha !== candidate.headSha) throw new Error('Tested merge commit does not bind the recorded base, head and tree');
  for (const key of ['node', 'playwright', 'image', 'controllerRevision']) if (!policy[key] || evidence.toolchain?.[key] !== policy[key]) throw new Error(`Untrusted toolchain ${key}`);
  if (!SHA.test(policy.controllerRevision) || !HASH.test(evidence.manifestDigest ?? '') || evidence.manifestDigest !== policy.manifestDigest || evidence.files !== policy.files) throw new Error('Test inventory or controller revision mismatch');
  if (!Number.isSafeInteger(evidence.tests) || evidence.tests < evidence.files || !Number.isSafeInteger(evidence.retries) || evidence.retries < 0 || !Number.isSafeInteger(evidence.skipped) || evidence.skipped < 0 || !Array.isArray(evidence.skipReasons) || evidence.skipReasons.length !== evidence.skipped || !evidence.skipReasons.every(allowedSkip)) throw new Error('Invalid execution counts or skipped coverage');
  if (!evidence.attemptId || !HASH.test(evidence.logsSha256 ?? '') || !Number.isFinite(Date.parse(evidence.startedAt)) || !Number.isFinite(Date.parse(evidence.completedAt)) || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt) || Date.parse(evidence.completedAt) > Date.now() + 60_000) throw new Error('Incomplete execution provenance');
  return { commit: policy.mainSha, tree: policy.tree, candidate: candidate.mergeSha, files: evidence.files, tests: evidence.tests, attemptId: evidence.attemptId };
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'grunion-ai/weave' || process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Cloud evidence promotion only runs for main push');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const sha = git('rev-parse', 'HEAD');
  if (sha !== process.env.GITHUB_SHA) throw new Error('Checkout differs from main event');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const files = testFiles();
  const manifest = plan(files, lanes(files), file => statSync(file).size);
  const response = await fetch(evidenceURL(process.env.CLOUD_CI_ORIGIN, tree), { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`Cloud evidence unavailable: HTTP ${response.status}`);
  const evidence = await response.json();
  if (!Number.isSafeInteger(evidence.candidate?.pr) || !SHA.test(evidence.candidate?.mergeSha ?? '')) throw new Error('Invalid evidence candidate');
  const api = path => JSON.parse(execFileSync('gh', ['api', `repos/grunion-ai/weave/${path}`], { encoding: 'utf8', timeout: 30_000 }));
  const pr = api(`pulls/${evidence.candidate.pr}`);
  const merge = api(`git/commits/${evidence.candidate.mergeSha}`);
  const node = /^FROM node:([\d.]+)-/m.exec(readFileSync('Dockerfile', 'utf8'))?.[1];
  const playwright = JSON.parse(readFileSync('.github/test-tools/package.json')).devDependencies.playwright;
  console.log(JSON.stringify(verifyEvidence(evidence, {
    repository: process.env.GITHUB_REPOSITORY, mainSha: sha, tree, parent: git('rev-parse', 'HEAD^'),
    manifestDigest: digest(manifest), files: files.length, node, playwright,
    image: process.env.CLOUD_CI_IMAGE, controllerRevision: process.env.CLOUD_CI_REVISION,
  }, pr, merge), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
