import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runId, signUpHrefProblem, clerkClient, weaveAdmin, CLERK_API, WEAVE, SIGN_UP_PATH } from '../scripts/signup-e2e.mjs';

const spy = (answer = () => new Response('{}', { status: 200 })) => {
  const calls = [];
  return { calls, fetch: async (url, init = {}) => { calls.push(`${init.method ?? 'GET'} ${url}${init.body ? ` ${init.body}` : ''}`); return answer(url, init); } };
};

test('a run id is stamped to the minute and safe as a Clerk external id', () => {
  assert.equal(runId(new Date('2026-10-15T21:07:09Z')), 'e2e-261015210709');
});

test('the grunion.ai link must be the self-serve sign-up entry, nothing else', () => {
  assert.equal(signUpHrefProblem(`${WEAVE}${SIGN_UP_PATH}`), null);
  assert.match(signUpHrefProblem(`${WEAVE}/auth`), /points at https:\/\/weave.grunion.ai\/auth/);
  assert.match(signUpHrefProblem(null), /no Get started link/);
});

test('the Clerk client makes a tagged test user, a sign-in ticket and a testing token, and deletes the user', async () => {
  const { calls, fetch } = spy((url) => new Response(JSON.stringify(url.endsWith('/sign_in_tokens') ? { token: 'ticket_1' } : url.endsWith('/testing_tokens') ? { token: 'tt_1' } : { id: 'user_1' }), { status: 200 }));
  const clerk = clerkClient({ key: 'sk_test_x', fetch });
  assert.equal((await clerk.createUser('e2e-1')).id, 'user_1');
  assert.equal(await clerk.ticket('user_1'), 'ticket_1');
  assert.equal(await clerk.testingToken(), 'tt_1');
  await clerk.deleteUser('user_1');
  assert.deepEqual(calls, [
    `POST ${CLERK_API}/users {"first_name":"E2E","last_name":"Test","username":"weave_e2e-1","external_id":"weave-e2e-1","public_metadata":{"weave_e2e":true}}`,
    `POST ${CLERK_API}/sign_in_tokens {"user_id":"user_1","expires_in_seconds":600}`,
    `POST ${CLERK_API}/testing_tokens`,
    `DELETE ${CLERK_API}/users/user_1`,
  ]);
});

test('a Clerk refusal names its status and code', async () => {
  const { fetch } = spy(() => new Response('{"errors":[{"code":"form_identifier_exists"}]}', { status: 422 }));
  await assert.rejects(clerkClient({ key: 'k', fetch }).createUser('e2e-2'), /422 at POST \/users: form_identifier_exists/);
});

test('cleanup trashes the workspace, then deletes it for good, and a missing one is fine', async () => {
  const { calls, fetch } = spy((url) => new Response('{}', { status: url.includes('gone') ? 404 : 200 }));
  const admin = weaveAdmin({ token: 'wv_x', fetch });
  await admin.deleteWorkspace('e2e-desk');
  await admin.deleteWorkspace('gone');
  assert.deepEqual(calls, [
    `DELETE ${WEAVE}/api/workspaces/e2e-desk`, `DELETE ${WEAVE}/api/workspaces/e2e-desk?hard=1`,
    `DELETE ${WEAVE}/api/workspaces/gone`, `DELETE ${WEAVE}/api/workspaces/gone?hard=1`,
  ]);
});

test('the workflow runs the sign-up against production on demand, with both secrets', () => {
  const yml = readFileSync(new URL('../.github/workflows/signup-e2e.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /node scripts\/signup-e2e\.mjs/);
  assert.match(yml, /WEAVE_E2E_CLERK_SECRET_KEY: \$\{\{ secrets\.WEAVE_E2E_CLERK_SECRET_KEY \}\}/);
  assert.match(yml, /WEAVE_E2E_ADMIN_TOKEN: \$\{\{ secrets\.WEAVE_E2E_ADMIN_TOKEN \}\}/);
  assert.match(yml, /actions\/upload-artifact@[0-9a-f]{40}/);
});
