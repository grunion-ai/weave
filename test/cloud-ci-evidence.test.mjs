import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEvidence, evidenceURL } from '../scripts/cloud-ci-evidence.mjs';

const sha = (n) => n.repeat(40);
const policy = { repository: 'grunion-ai/weave', mainSha: sha('a'), tree: sha('b'), parent: sha('c'), manifestDigest: 'd'.repeat(64), files: 490, node: '22.23.2', playwright: '1.62.1', image: 'harness:' + sha('f') + ':dockerfile:' + 'e'.repeat(64), controllerRevision: sha('f') };
const evidence = { schemaVersion: 1, repository: policy.repository, scope: 'full', state: 'passed', candidate: { baseSha: policy.parent, headSha: sha('1'), mergeSha: sha('2'), tree: policy.tree, pr: 42 }, toolchain: { node: policy.node, playwright: policy.playwright, image: policy.image, controllerRevision: policy.controllerRevision }, manifestDigest: policy.manifestDigest, files: policy.files, tests: 4500, skipped: 0, skipReasons: [], retries: 0, startedAt: '2026-10-11T00:00:00Z', completedAt: '2026-10-11T00:10:00Z', attemptId: 'candidate-42', logsSha256: '3'.repeat(64) };
const pr = { number: 42, merged: true, merge_commit_sha: policy.mainSha, head: { sha: evidence.candidate.headSha, repo: { full_name: policy.repository } }, base: { ref: 'main', repo: { full_name: policy.repository } } };
const merge = { sha: evidence.candidate.mergeSha, tree: { sha: policy.tree }, parents: [{ sha: policy.parent }, { sha: evidence.candidate.headSha }] };

test('main promotion reuses only full evidence for the exact integrated tree and PR', () => {
  assert.equal(verifyEvidence(evidence, policy, pr, merge).tests, 4500);
  for (const patch of [{ scope: 'targeted' }, { state: 'running' }, { repository: 'fork/weave' }, { manifestDigest: 'f'.repeat(64) }, { files: 489 }, { tests: 0 }, { logsSha256: '' }, { attemptId: '' }, { retries: -1 }, { skipped: 1 }, { completedAt: '2026-10-10T00:00:00Z' }]) assert.throws(() => verifyEvidence({ ...evidence, ...patch }, policy, pr, merge));
  for (const field of ['tree', 'baseSha', 'headSha', 'mergeSha']) assert.throws(() => verifyEvidence({ ...evidence, candidate: { ...evidence.candidate, [field]: sha('9') } }, policy, pr, merge));
  for (const field of ['node', 'playwright', 'image', 'controllerRevision']) assert.throws(() => verifyEvidence({ ...evidence, toolchain: { ...evidence.toolchain, [field]: 'wrong' } }, policy, pr, merge));
});

test('unmerged PRs, moved heads, another repository and mismatched merge parents fail closed', () => {
  for (const patch of [{ merged: false }, { merge_commit_sha: sha('9') }, { head: { ...pr.head, sha: sha('9') } }, { head: { ...pr.head, repo: { full_name: 'fork/weave' } } }, { base: { ...pr.base, ref: 'dev' } }]) assert.throws(() => verifyEvidence(evidence, policy, { ...pr, ...patch }, merge));
  assert.throws(() => verifyEvidence(evidence, policy, pr, { ...merge, tree: { sha: sha('9') } }));
  assert.throws(() => verifyEvidence(evidence, policy, pr, { ...merge, parents: [{ sha: sha('9') }, merge.parents[1]] }));
  assert.throws(() => verifyEvidence(evidence, { ...policy, image: '' }, pr, merge));
});

test('only existing declared capability skips can accompany complete full coverage', () => {
  const skipped = { ...evidence, skipped: 1, skipReasons: [{ file: 'test/security/security-scan.test.mjs', reason: 'semgrep not installed' }] };
  verifyEvidence(skipped, policy, pr, merge);
  assert.throws(() => verifyEvidence({ ...skipped, skipReasons: [{ file: 'test/browser.test.mjs', reason: 'playwright not installed' }] }, policy, pr, merge));
});

test('evidence URLs are pinned to a configured HTTPS origin and immutable tree', () => {
  assert.equal(evidenceURL('https://ci.example.com', policy.tree), `https://ci.example.com/evidence/tree/${policy.tree}`);
  for (const origin of ['', 'http://ci.example.com', 'https://token@ci.example.com', 'https://ci.example.com/path', 'https://ci.example.com?x=1']) assert.throws(() => evidenceURL(origin, policy.tree));
  assert.throws(() => evidenceURL('https://ci.example.com', '../main'));
});
