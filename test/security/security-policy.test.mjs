import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../lib/source.mjs';

const POLICY = read('SECURITY.md');
const README = read('README.md');
const LLMS = read('llms.txt');
const section = (doc, title) => doc.split(`\n## ${title}\n`)[1]?.split('\n## ')[0] ?? '';

test('SECURITY.md describes the product that ships: roles, tokens, provider sign-in and the auth switch', () => {
  for (const word of ['architect', 'editor', 'observer', 'wv_', 'OpenID Connect', 'require-auth', 'requireAuth']) {
    assert.ok(POLICY.includes(word), `SECURITY.md never names ${word}`);
  }
  assert.doesNotMatch(POLICY, /no authentication and no per-user permissions|working-as-documented|binds\s+`127\.0\.0\.1`;/i,
    'SECURITY.md still describes an unauthenticated loopback product');
});

test('SECURITY.md names both binds and every request-level guard', () => {
  for (const word of ['127.0.0.1', '0.0.0.0', 'WEAVE_ALLOWED_HOSTS', '421', 'Origin', '403', 'frame-ancestors', 'nosniff', 'sandbox', 'WEAVE_INLINE_FILE_TYPES']) {
    assert.ok(POLICY.includes(word), `SECURITY.md never names ${word}`);
  }
  assert.match(POLICY, /kind `html`[\s\S]*origin[\s\S]*limitation/i, 'the html document limitation is stated as a limitation');
});

test('the scope list keeps its items and adds roles, share links and stored content', () => {
  const scope = section(POLICY, 'In scope');
  assert.ok(scope, 'SECURITY.md has an In scope section');
  for (const item of ['crafted entity ref', 'path traversal', 'data directory', 'Remote code execution', 'formula evaluator', 'CSV import', 'DNS rebinding', 'Host', 'Corruption or loss',
    'between roles', 'share link', "another signed-in user's browser"]) {
    assert.ok(scope.includes(item), `the scope list dropped ${item}`);
  }
});

test('private reporting stays, and the page carries no em dash', () => {
  assert.ok(POLICY.includes('https://github.com/grunion-ai/weave/security/advisories/new'));
  assert.match(POLICY, /do not open a public issue/i);
  for (const [name, doc] of [['SECURITY.md', POLICY], ['llms.txt', LLMS]]) assert.equal(doc.includes('—'), false, `${name} carries an em dash`);
});

test('the README and llms.txt point at the same model', () => {
  const security = section(README, 'Security');
  for (const word of ['require-auth', '127.0.0.1', '0.0.0.0', 'SECURITY.md', '`html`']) assert.ok(security.includes(word), `README Security never names ${word}`);
  assert.doesNotMatch(security, /renders same-origin — treat/, 'the README still states the html limitation as design');
  const hosting = section(README, 'Self-hosting');
  assert.ok(hosting.includes('require-auth'), 'README Self-hosting never names the auth switch');
  assert.match(LLMS, /SECURITY\.md\):[^\n]*(roles|tokens)[^\n]*private reporting/, 'the llms.txt SECURITY line names the current model');
  assert.match(LLMS, /require-auth/, 'llms.txt never names the auth switch');
});
