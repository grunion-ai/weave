import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const ISS = 'https://clerk.example.com';

const linked = () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const inv = w.linkIdentity('kyle', { issuer: ISS });
  w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1' });
  return w;
};

test('unlinking a subject the account does not have is not-found and keeps the identity', () => {
  const w = linked();
  assert.throws(() => w.unlinkIdentity('kyle', { issuer: ISS, subject: 'user_9' }), (err) => {
    assert.equal(err.code, 'not-found');
    assert.match(err.message, /No identity 'user_9' on 'kyle'/);
    return true;
  });
  assert.ok(w.accountForIdentity({ issuer: ISS, subject: 'user_1' }));
});

test('unlinking with no subject is not-found', () => {
  const w = linked();
  assert.throws(() => w.unlinkIdentity('kyle', { issuer: ISS }), (err) => err.code === 'not-found');
  assert.ok(w.accountForIdentity({ issuer: ISS, subject: 'user_1' }));
});

test('unlinking the linked subject reports one removed and none left', () => {
  const w = linked();
  assert.deepEqual(w.unlinkIdentity('kyle', { issuer: ISS, subject: 'user_1' }), { unlinked: 1, remaining: 0 });
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1' }), null);
});
