import test from 'node:test';
import assert from 'node:assert/strict';
import { methodsOf, parityGaps } from '../scripts/clerk-methods.mjs';

const environment = ({ firstFactor }) => ({
  user_settings: {
    attributes: {
      email_address: { enabled: true, required: true, used_for_first_factor: firstFactor, first_factors: firstFactor ? ['email_code'] : [], verifications: ['email_code'] },
      first_name: { enabled: true, used_for_first_factor: false, first_factors: [], verifications: [] },
    },
    social: {
      oauth_google: { enabled: true, authenticatable: true, strategy: 'oauth_google' },
      oauth_apple: { enabled: false, authenticatable: false, strategy: 'oauth_apple' },
    },
  },
});

test('the shape production had on 2026-11-04 is a gap: email signs up but never signs in (Issue #1330)', () => {
  const was = environment({ firstFactor: false });
  assert.deepEqual(methodsOf(was), { signIn: ['oauth_google'], signUp: ['email_code', 'oauth_google'] });
  assert.deepEqual(parityGaps(was), { signUpOnly: ['email_code'], signInOnly: [] });
});

test('email code as a first factor closes the gap', () => {
  const fixed = environment({ firstFactor: true });
  assert.deepEqual(methodsOf(fixed), { signIn: ['email_code', 'oauth_google'], signUp: ['email_code', 'oauth_google'] });
  assert.deepEqual(parityGaps(fixed), { signUpOnly: [], signInOnly: [] });
});

test('a provider enabled only for connecting accounts counts at neither pane', () => {
  const env = environment({ firstFactor: true });
  env.user_settings.social.oauth_apple = { enabled: true, authenticatable: false, strategy: 'oauth_apple' };
  assert.deepEqual(methodsOf(env), { signIn: ['email_code', 'oauth_google'], signUp: ['email_code', 'oauth_google'] });
});
