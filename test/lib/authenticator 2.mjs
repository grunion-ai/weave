/* A software authenticator for the suites (Feature #222 part 2): builds what
   navigator.credentials.create() and .get() hand back, from a key pair
   node:crypto generates — authData by hand, a CBOR attestation object with
   fmt "none", a clientDataJSON naming challenge and origin, and a real
   signature over authData || sha256(clientDataJSON). Every buffer leaves
   base64url'd, the way the sign-in page sends them. */
import { createHash, generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import { b64url, ALGS, FLAGS } from '../../src/webauthn.js';

/* ---------------------------------------------------------------- a tiny CBOR encoder (test-only) */
export function encodeCbor(v) {
  const head = (major, n) => {
    if (n < 24) return [(major << 5) | n];
    if (n < 0x100) return [(major << 5) | 24, n];
    if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
    return [(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  };
  if (typeof v === 'number') return Buffer.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (v === false) return Buffer.from([0xf4]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === null) return Buffer.from([0xf6]);
  if (v instanceof Uint8Array) return Buffer.concat([Buffer.from(head(2, v.length)), Buffer.from(v)]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([Buffer.from(head(3, b.length)), b]); }
  if (Array.isArray(v)) return Buffer.concat([Buffer.from(head(4, v.length)), ...v.map(encodeCbor)]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([Buffer.from(head(5, entries.length)), ...entries.flatMap(([k, val]) => [encodeCbor(k), encodeCbor(val)])]);
}

/* ---------------------------------------------------------------- an authenticator in 40 lines */
export const sha256 = (b) => createHash('sha256').update(b).digest();
export const RP_ID = 'weave.example.com';
export const ORIGIN = 'https://weave.example.com';

export function keyPair(alg = ALGS.ES256) {
  if (alg === ALGS.ES256) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
    return { alg, privateKey, cose, sign: (data) => cryptoSign('sha256', data, { key: privateKey, dsaEncoding: 'der' }) };
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]);
  return { alg, privateKey, cose, sign: (data) => cryptoSign('sha256', data, privateKey) };
}

export function authData({ rpId = RP_ID, flags = FLAGS.UP | FLAGS.UV, counter = 0, credId = null, cose = null } = {}) {
  const head = Buffer.alloc(37);
  sha256(rpId).copy(head, 0);
  head[32] = flags | (credId ? FLAGS.AT : 0);
  head.writeUInt32BE(counter, 33);
  if (!credId) return head;
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  return Buffer.concat([head, Buffer.alloc(16), idLen, credId, encodeCbor(cose)]);
}

export const clientData = (type, challenge, origin = ORIGIN) => b64url.encode(Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })));

/* A registration response, as navigator.credentials.create() would return
   it once every buffer is base64url'd. */
export function registration({ key = keyPair(), challenge, origin = ORIGIN, rpId = RP_ID, fmt = 'none', flags, counter = 0, credId = randomBytes(16) } = {}) {
  const ad = authData({ rpId, flags, counter, credId, cose: key.cose });
  const attestationObject = encodeCbor(new Map([['fmt', fmt], ['attStmt', new Map()], ['authData', ad]]));
  return {
    key, credId,
    response: {
      id: b64url.encode(credId), rawId: b64url.encode(credId), type: 'public-key',
      response: { clientDataJSON: clientData('webauthn.create', challenge, origin), attestationObject: b64url.encode(attestationObject), transports: ['internal'] },
    },
  };
}

/* An assertion signed by the same key. */
export function assertion({ key, credId, challenge, origin = ORIGIN, rpId = RP_ID, flags = FLAGS.UP | FLAGS.UV, counter = 1, tamper = null }) {
  const ad = authData({ rpId, flags, counter });
  const cd = clientData('webauthn.get', challenge, origin);
  const signature = key.sign(Buffer.concat([ad, sha256(b64url.decode(cd))]));
  if (tamper === 'signature') signature[signature.length - 1] ^= 0x01;
  return {
    id: b64url.encode(credId), rawId: b64url.encode(credId), type: 'public-key',
    response: { clientDataJSON: cd, authenticatorData: b64url.encode(ad), signature: b64url.encode(signature), userHandle: null },
  };
}

