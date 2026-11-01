import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alertRequest } from '../scripts/sheriff.mjs';

test('alertRequest posts the line as the body with a bearer header when a token is set', () => {
  const init = alertRequest({ SHERIFF_ALERT_TOKEN: 'abc123' }, 'weave sheriff: red');
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'weave sheriff: red');
  assert.deepEqual(init.headers, { Authorization: 'Bearer abc123' });
  assert.ok(init.signal);
});

test('alertRequest sends no Authorization header when no token is set', () => {
  const init = alertRequest({}, 'weave sheriff: red');
  assert.deepEqual(init.headers, {});
  assert.equal(init.body, 'weave sheriff: red');
});

for (const workflow of ['sheriff', 'dev-soak', 'promote', 'budgets']) {
  test(`${workflow} workflow hands SHERIFF_ALERT_TOKEN from the Actions secret to the script`, () => {
    const yml = readFileSync(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
    assert.match(yml, /^\s+SHERIFF_ALERT_TOKEN: \$\{\{ secrets\.SHERIFF_ALERT_TOKEN \}\}$/m);
  });
}

test('no script posts to SHERIFF_ALERT_URL without alertRequest', () => {
  for (const [file, line] of [['sheriff', 'line'], ['dev-soak', 'line'], ['ci-trend', 'alert']]) {
    const src = readFileSync(new URL(`../scripts/${file}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /fetch\(env\.SHERIFF_ALERT_URL, \{ method/);
    assert.ok(src.includes(`fetch(env.SHERIFF_ALERT_URL, alertRequest(env, ${line}))`), `${file} posts through alertRequest`);
  }
});
