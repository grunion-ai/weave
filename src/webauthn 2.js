/* WebAuthn verification with no dependencies (Feature #222 part 2, door B;
   Feature #208). The two ceremonies a passkey sign-in needs — registration
   with `none` attestation, and an assertion — verified with node:crypto and
   a CBOR decoder that knows the five shapes an attestation object and a COSE
   key are made of. ES256 (-7) keys import as raw P-256 points, RS256 (-257)
   keys as JWK; anything else is refused at registration with a clear
   message. ponytail: the seam is verifyRegistration — @simplewebauthn/server
   replaces it if a platform ever demands packed or TPM attestation. */
import { createHash, webcrypto } from 'node:crypto';
import { WeaveError } from './store.js';

const { subtle } = webcrypto;

/* ---------------------------------------------------------------- base64url */
export const b64url = {
  encode: (bytes) => Buffer.from(bytes).toString('base64url'),
  decode: (text) => {
    if (typeof text !== 'string') throw new WeaveError('Expected a base64url string', 'invalid');
    return new Uint8Array(Buffer.from(text, 'base64url'));
  },
};

/* ---------------------------------------------------------------- CBOR */
/* Decodes the subset WebAuthn uses: unsigned and negative integers, byte and
   text strings, arrays, maps, and the simple values false/true/null. Indefinite
   lengths, tags and floats are refused — a `none` attestation never carries
   them. Returns { value, rest } so a caller can read what follows. */
export function decodeCbor(bytes, offset = 0) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let pos = offset;
  const need = (n) => { if (pos + n > view.length) throw new WeaveError('CBOR: truncated', 'invalid'); };
  const readLen = (info) => {
    if (info < 24) return info;
    const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!width) throw new WeaveError('CBOR: indefinite lengths are not supported', 'invalid');
    need(width);
    let n = 0n;
    for (let i = 0; i < width; i++) n = (n << 8n) | BigInt(view[pos + i]);
    pos += width;
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new WeaveError('CBOR: integer too large', 'invalid');
    return Number(n);
  };
  const item = () => {
    need(1);
    const head = view[pos++];
    const major = head >> 5, info = head & 0x1f;
    switch (major) {
      case 0: return readLen(info);
      case 1: return -1 - readLen(info);
      case 2: { const n = readLen(info); need(n); const out = view.slice(pos, pos + n); pos += n; return out; }
      case 3: { const n = readLen(info); need(n); const out = Buffer.from(view.subarray(pos, pos + n)).toString('utf8'); pos += n; return out; }
      case 4: { const n = readLen(info); const out = []; for (let i = 0; i < n; i++) out.push(item()); return out; }
      case 5: { const n = readLen(info); const out = new Map(); for (let i = 0; i < n; i++) { const k = item(); out.set(k, item()); } return out; }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new WeaveError('CBOR: floats and simple values are not supported', 'invalid');
      default:
        throw new WeaveError('CBOR: tags are not supported', 'invalid');
    }
  };
  const value = item();
  return { value, rest: view.slice(pos) };
}

/* ---------------------------------------------------------------- authData */
export const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

/* authData: rpIdHash(32) | flags(1) | counter(4, BE) | [aaguid(16) |
   credIdLen(2) | credId | COSE key (CBOR)] when AT is set. */
export function parseAuthData(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < 37) throw new WeaveError('authenticatorData is too short', 'invalid');
  const flagByte = buf[32];
  const flags = { up: !!(flagByte & FLAGS.UP), uv: !!(flagByte & FLAGS.UV), at: !!(flagByte & FLAGS.AT), ed: !!(flagByte & FLAGS.ED) };
  const counter = new DataView(buf.buffer, buf.byteOffset + 33, 4).getUint32(0);
  const out = { rpIdHash: buf.slice(0, 32), flags, counter, aaguid: null, credentialId: null, cosePublicKey: null };
  if (flags.at) {
    if (buf.length < 55) throw new WeaveError('attested credential data is truncated', 'invalid');
    out.aaguid = buf.slice(37, 53);
    const idLen = (buf[53] << 8) | buf[54];
    if (buf.length < 55 + idLen) throw new WeaveError('credential id is truncated', 'invalid');
    out.credentialId = buf.slice(55, 55 + idLen);
    out.cosePublicKey = decodeCbor(buf, 55 + idLen).value;
  }
  return out;
}

/* ---------------------------------------------------------------- COSE → JWK */
export const ALGS = { ES256: -7, RS256: -257 };

/* COSE labels: 1 kty (2 = EC2, 3 = RSA), 3 alg, -1 crv (1 = P-256) or n,
   -2 x or e, -3 y. Only the two algorithms every platform authenticator
   speaks are accepted. */
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new WeaveError('COSE key is not a map', 'invalid');
  const kty = cose.get(1), alg = cose.get(3);
  if (alg === ALGS.ES256) {
    if (kty !== 2 || cose.get(-1) !== 1) throw new WeaveError('ES256 key must be an EC2 P-256 key', 'invalid');
    const x = cose.get(-2), y = cose.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new WeaveError('ES256 key has a malformed point', 'invalid');
    return { jwk: { kty: 'EC', crv: 'P-256', x: b64url.encode(x), y: b64url.encode(y) }, alg };
  }
  if (alg === ALGS.RS256) {
    if (kty !== 3) throw new WeaveError('RS256 key must be an RSA key', 'invalid');
    const n = cose.get(-1), e = cose.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) throw new WeaveError('RS256 key is malformed', 'invalid');
    return { jwk: { kty: 'RSA', n: b64url.encode(n), e: b64url.encode(e) }, alg };
  }
  throw new WeaveError(`Unsupported passkey algorithm ${alg} — weave accepts ES256 (-7) and RS256 (-257)`, 'invalid');
}

/* ---------------------------------------------------------------- helpers */
const sha256 = (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest());
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function readClientData(clientDataJSON, { type, expectedChallenge, origin }) {
  const bytes = b64url.decode(clientDataJSON);
  let data;
  try { data = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new WeaveError('clientDataJSON is not JSON', 'invalid'); }
  if (data.type !== type) throw new WeaveError(`clientDataJSON type is '${data.type}', expected '${type}'`, 'invalid');
  if (data.challenge !== expectedChallenge) throw new WeaveError('Challenge mismatch — the ceremony expired or was replayed', 'invalid');
  if (data.origin !== origin) throw new WeaveError(`Origin mismatch: the browser says ${data.origin}, this server is ${origin} (set WEAVE_ORIGIN)`, 'invalid');
  return { bytes, data };
}

function checkRpId(authData, rpId) {
  if (!same(authData.rpIdHash, sha256(rpId))) throw new WeaveError(`RP ID mismatch: the credential was made for another host than ${rpId}`, 'invalid');
  if (!authData.flags.up) throw new WeaveError('User presence flag is not set', 'invalid');
}

/* ECDSA signatures arrive DER-encoded; WebCrypto wants raw r||s. */
export function derToRaw(der, size = 32) {
  const b = der instanceof Uint8Array ? der : new Uint8Array(der);
  if (b[0] !== 0x30) throw new WeaveError('ECDSA signature is not DER', 'invalid');
  let pos = 2;
  if (b[1] & 0x80) pos += b[1] & 0x7f;
  const readInt = () => {
    if (b[pos++] !== 0x02) throw new WeaveError('ECDSA signature is not DER', 'invalid');
    const len = b[pos++];
    let v = b.slice(pos, pos + len);
    pos += len;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) throw new WeaveError('ECDSA signature integer too long', 'invalid');
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt(), s = readInt();
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0); raw.set(s, size);
  return raw;
}

async function importKey(jwk, alg) {
  if (alg === ALGS.ES256) return subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (alg === ALGS.RS256) return subtle.importKey('jwk', { ...jwk, alg: 'RS256' }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  throw new WeaveError(`Unsupported passkey algorithm ${alg}`, 'invalid');
}

/* ---------------------------------------------------------------- ceremonies */
/* response: the PublicKeyCredential a browser hands back from
   navigator.credentials.create(), every buffer base64url — { id, rawId,
   type, response: { clientDataJSON, attestationObject, transports? } }. */
export async function verifyRegistration({ response, expectedChallenge, origin, rpId }) {
  if (!response || response.type !== 'public-key' || !response.response) throw new WeaveError('Not a public-key credential', 'invalid');
  readClientData(response.response.clientDataJSON, { type: 'webauthn.create', expectedChallenge, origin });
  const att = decodeCbor(b64url.decode(response.response.attestationObject)).value;
  if (!(att instanceof Map)) throw new WeaveError('attestationObject is not a CBOR map', 'invalid');
  const fmt = att.get('fmt');
  if (fmt !== 'none') throw new WeaveError(`Attestation format '${fmt}' is not supported — weave accepts 'none' only (ask for attestation: "none")`, 'invalid');
  const authData = parseAuthData(att.get('authData'));
  checkRpId(authData, rpId);
  if (!authData.flags.at) throw new WeaveError('attestationObject carries no credential', 'invalid');
  const { jwk, alg } = coseToJwk(authData.cosePublicKey);
  const id = b64url.encode(authData.credentialId);
  if (response.id && response.id !== id) throw new WeaveError('Credential id does not match the attested credential', 'invalid');
  await importKey(jwk, alg); // a key WebCrypto refuses is refused here, not at first sign-in
  return {
    id,
    publicKeyJwk: jwk,
    alg,
    counter: authData.counter,
    uv: authData.flags.uv,
    transports: Array.isArray(response.response.transports) ? response.response.transports.filter((t) => typeof t === 'string') : [],
  };
}

/* response: the PublicKeyCredential from navigator.credentials.get() —
   { id, type, response: { clientDataJSON, authenticatorData, signature,
   userHandle? } }. credential: the stored row { id, publicKeyJwk, alg,
   counter }. The signature covers authData || sha256(clientDataJSON). The
   counter must move forward whenever either side reports one; two zeros mean
   an authenticator that does not count (every passkey synced through a
   cloud keychain), and that is allowed. */
export async function verifyAssertion({ response, credential, expectedChallenge, origin, rpId }) {
  if (!response || response.type !== 'public-key' || !response.response) throw new WeaveError('Not a public-key credential', 'invalid');
  if (!credential || response.id !== credential.id) throw new WeaveError('Unknown credential', 'invalid');
  const { bytes: clientData } = readClientData(response.response.clientDataJSON, { type: 'webauthn.get', expectedChallenge, origin });
  const authBytes = b64url.decode(response.response.authenticatorData);
  const authData = parseAuthData(authBytes);
  checkRpId(authData, rpId);
  const key = await importKey(credential.publicKeyJwk, credential.alg);
  const signed = new Uint8Array(authBytes.length + 32);
  signed.set(authBytes, 0);
  signed.set(sha256(clientData), authBytes.length);
  const sig = b64url.decode(response.response.signature);
  const ok = credential.alg === ALGS.ES256
    ? await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), signed)
    : await subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, signed);
  if (!ok) throw new WeaveError('Signature does not verify', 'forbidden');
  const stored = Number(credential.counter ?? 0);
  if ((authData.counter !== 0 || stored !== 0) && authData.counter <= stored) {
    throw new WeaveError('Signature counter did not advance — a cloned authenticator or a replayed assertion', 'forbidden');
  }
  return { counter: authData.counter, uv: authData.flags.uv };
}

/* A fresh challenge: 32 random bytes, base64url, the form clientDataJSON
   echoes back. */
export function newChallenge() {
  return b64url.encode(webcrypto.getRandomValues(new Uint8Array(32)));
}
