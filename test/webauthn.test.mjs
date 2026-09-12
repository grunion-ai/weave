/* The zero-dependency WebAuthn verifier (Feature #222 part 2, Feature #208).

   Every fixture is built here from a key pair node:crypto generates, the way
   an authenticator would build it: a hand-assembled authData, a CBOR
   attestation object with fmt "none", a clientDataJSON that names the
   challenge and the origin, and a real signature over
   authData || sha256(clientDataJSON). Nothing is recorded from a browser, so
   a negative case is a fixture with one byte turned, not a captured blob. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  b64url, decodeCbor, parseAuthData, coseToJwk, derToRaw, verifyRegistration, verifyAssertion, newChallenge, ALGS, FLAGS,
} from '../src/webauthn.js';
import { encodeCbor, keyPair, authData, clientData, registration, assertion, sha256, RP_ID, ORIGIN } from './lib/authenticator.mjs';

async function registered(opts = {}) {
  const challenge = newChallenge();
  const reg = registration({ challenge, ...opts });
  const cred = await verifyRegistration({ response: reg.response, expectedChallenge: challenge, origin: ORIGIN, rpId: RP_ID });
  return { ...reg, cred };
}

/* ---------------------------------------------------------------- primitives */
test('the CBOR decoder reads the five shapes a none attestation is made of', () => {
  const doc = new Map([['fmt', 'none'], ['n', 300], ['neg', -5], ['bytes', Buffer.from([1, 2, 3])], ['list', [1, 'two', true, null]], ['big', 70000]]);
  const { value, rest } = decodeCbor(encodeCbor(doc));
  assert.equal(value.get('fmt'), 'none');
  assert.equal(value.get('n'), 300);
  assert.equal(value.get('neg'), -5);
  assert.deepEqual([...value.get('bytes')], [1, 2, 3]);
  assert.deepEqual(value.get('list'), [1, 'two', true, null]);
  assert.equal(value.get('big'), 70000);
  assert.equal(rest.length, 0);
  assert.throws(() => decodeCbor(Buffer.from([0x5f])), /indefinite/, 'an indefinite byte string is refused, not hung on');
  assert.throws(() => decodeCbor(Buffer.from([0x58, 0x05, 0x01])), /truncated/);
  assert.throws(() => decodeCbor(Buffer.from([0xc0, 0x01])), /tags/);
});

test('parseAuthData reads the header, the flags, the counter and the attested credential', () => {
  const key = keyPair();
  const credId = randomBytes(20);
  const parsed = parseAuthData(authData({ counter: 42, credId, cose: key.cose, flags: FLAGS.UP }));
  assert.deepEqual([...parsed.rpIdHash], [...sha256(RP_ID)]);
  assert.equal(parsed.counter, 42);
  assert.deepEqual(parsed.flags, { up: true, uv: false, at: true, ed: false });
  assert.deepEqual([...parsed.credentialId], [...credId]);
  assert.equal(parsed.cosePublicKey.get(3), -7);
  const bare = parseAuthData(authData({ counter: 7 }));
  assert.equal(bare.credentialId, null);
  assert.equal(bare.counter, 7);
  assert.throws(() => parseAuthData(Buffer.alloc(10)), /too short/);
});

test('COSE keys become JWKs for the two algorithms weave accepts, and nothing else', () => {
  const ec = coseToJwk(keyPair(ALGS.ES256).cose);
  assert.equal(ec.alg, -7);
  assert.deepEqual(Object.keys(ec.jwk).sort(), ['crv', 'kty', 'x', 'y']);
  const rsa = coseToJwk(keyPair(ALGS.RS256).cose);
  assert.equal(rsa.alg, -257);
  assert.equal(rsa.jwk.kty, 'RSA');
  assert.throws(() => coseToJwk(new Map([[1, 2], [3, -8]])), /Unsupported passkey algorithm -8/, 'EdDSA is refused with the number named');
  assert.throws(() => coseToJwk(new Map([[1, 2], [3, -7], [-1, 2], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]])), /P-256/, 'a P-384 point under -7 is refused');
});

test('a DER ECDSA signature becomes the raw r||s WebCrypto verifies', () => {
  const key = keyPair();
  const der = key.sign(Buffer.from('hello'));
  const raw = derToRaw(der);
  assert.equal(raw.length, 64);
  assert.throws(() => derToRaw(Buffer.from([0x31, 0x00])), /not DER/);
});

/* ---------------------------------------------------------------- registration */
test('registration: a none attestation with an ES256 key verifies and yields the stored credential', async () => {
  const { cred, credId } = await registered();
  assert.equal(cred.id, b64url.encode(credId));
  assert.equal(cred.alg, -7);
  assert.equal(cred.publicKeyJwk.kty, 'EC');
  assert.equal(cred.counter, 0);
  assert.equal(cred.uv, true);
  assert.deepEqual(cred.transports, ['internal']);
});

test('registration: an RS256 key is accepted too', async () => {
  const { cred } = await registered({ key: keyPair(ALGS.RS256) });
  assert.equal(cred.alg, -257);
  assert.equal(cred.publicKeyJwk.kty, 'RSA');
});

test('registration: wrong origin, wrong challenge, wrong RP ID, packed attestation and an unsupported key are each refused by name', async () => {
  const challenge = newChallenge();
  const verify = (reg, over = {}) => verifyRegistration({ response: reg.response, expectedChallenge: challenge, origin: ORIGIN, rpId: RP_ID, ...over });
  await assert.rejects(verify(registration({ challenge, origin: 'https://evil.example.com' })), /Origin mismatch/);
  await assert.rejects(verify(registration({ challenge: newChallenge() })), /Challenge mismatch/);
  await assert.rejects(verify(registration({ challenge, rpId: 'other.example.com' })), /RP ID mismatch/);
  await assert.rejects(verify(registration({ challenge, fmt: 'packed' })), /'packed' is not supported/);
  await assert.rejects(verify(registration({ challenge, flags: FLAGS.UV })), /User presence/);
  const ed = keyPair();
  ed.cose = new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.alloc(32)]]);
  await assert.rejects(verify(registration({ challenge, key: ed })), /Unsupported passkey algorithm -8/);
  const wrongType = registration({ challenge });
  wrongType.response.response.clientDataJSON = clientData('webauthn.get', challenge);
  await assert.rejects(verify(wrongType), /type is 'webauthn.get'/);
});

/* ---------------------------------------------------------------- assertion */
test('assertion: a signature over authData || sha256(clientDataJSON) verifies for ES256 and RS256, and reports the counter', async () => {
  for (const alg of [ALGS.ES256, ALGS.RS256]) {
    const { key, credId, cred } = await registered({ key: keyPair(alg) });
    const challenge = newChallenge();
    const res = assertion({ key, credId, challenge, counter: 5 });
    const ok = await verifyAssertion({ response: res, credential: cred, expectedChallenge: challenge, origin: ORIGIN, rpId: RP_ID });
    assert.deepEqual(ok, { counter: 5, uv: true });
  }
});

test('assertion: UV is preferred, not required — a UP-only assertion still verifies and says uv: false', async () => {
  const { key, credId, cred } = await registered();
  const challenge = newChallenge();
  const ok = await verifyAssertion({ response: assertion({ key, credId, challenge, flags: FLAGS.UP }), credential: cred, expectedChallenge: challenge, origin: ORIGIN, rpId: RP_ID });
  assert.equal(ok.uv, false);
});

test('assertion: the negative cases — wrong origin, wrong challenge, wrong rpIdHash, a tampered signature, another key, a replayed counter', async () => {
  const { key, credId, cred } = await registered();
  const challenge = newChallenge();
  const verify = (res, credential = cred) => verifyAssertion({ response: res, credential, expectedChallenge: challenge, origin: ORIGIN, rpId: RP_ID });
  await assert.rejects(verify(assertion({ key, credId, challenge, origin: 'http://localhost:4400' })), /Origin mismatch/);
  await assert.rejects(verify(assertion({ key, credId, challenge: newChallenge() })), /Challenge mismatch/);
  await assert.rejects(verify(assertion({ key, credId, challenge, rpId: 'other.example.com' })), /RP ID mismatch/);
  await assert.rejects(verify(assertion({ key, credId, challenge, tamper: 'signature' })), /does not verify/);
  await assert.rejects(verify(assertion({ key: keyPair(), credId, challenge })), /does not verify/, 'a different private key for the same id');
  // The counter: stored 5, presented 5 (replay) or 3 (clone) are refused; 6 passes.
  await assert.rejects(verify(assertion({ key, credId, challenge, counter: 5 }), { ...cred, counter: 5 }), /counter did not advance/);
  await assert.rejects(verify(assertion({ key, credId, challenge, counter: 3 }), { ...cred, counter: 5 }), /counter did not advance/);
  assert.equal((await verify(assertion({ key, credId, challenge, counter: 6 }), { ...cred, counter: 5 })).counter, 6);
  // Both zero: an authenticator that does not count (synced passkeys) is allowed.
  assert.equal((await verify(assertion({ key, credId, challenge, counter: 0 }), { ...cred, counter: 0 })).counter, 0);
  // Stored zero, presented nonzero: it started counting — fine, and now it must keep going.
  assert.equal((await verify(assertion({ key, credId, challenge, counter: 1 }), { ...cred, counter: 0 })).counter, 1);
  // A response for a credential id the row does not hold.
  await assert.rejects(verify(assertion({ key, credId: randomBytes(16), challenge })), /Unknown credential/);
});

test('challenges are 32 random bytes, base64url, never repeated', () => {
  const a = newChallenge(), b = newChallenge();
  assert.equal(b64url.decode(a).length, 32);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});
