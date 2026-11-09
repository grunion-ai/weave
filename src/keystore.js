import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { userInfo } from 'node:os';
import { WeaveError } from './store.js';

export const KEYSTORE_KINDS = ['file', 'keychain'];
export const SECURITY = '/usr/bin/security';
export const INDEX_SERVICE = 'weave:keystore';
export const KEYCHAIN_ACCOUNT = 'weave';
const MISSING = 44;

export const keyFilePath = (path) => path.replace(/\.json$/, '') + '.key';

export const keystoreFilePath = (value) => (value && !KEYSTORE_KINDS.includes(value) ? value : null);

export function keystoreKind({ path, pick = null, platform = process.platform, home = userInfo().homedir, security = SECURITY } = {}) {
  if (KEYSTORE_KINDS.includes(pick)) return pick;
  if (existsSync(path) || path !== join(home, '.weave', 'keystore.json')) return 'file';
  return platform === 'darwin' && existsSync(security) ? 'keychain' : 'file';
}

export function openKeyStore({ path, env = process.env, kind = null } = {}) {
  const chosen = kind ?? keystoreKind({ path, pick: env?.WEAVE_KEYSTORE ?? process.env.WEAVE_KEYSTORE });
  if (!KEYSTORE_KINDS.includes(chosen)) throw new WeaveError(`Unknown key store '${chosen}' (${KEYSTORE_KINDS.join(', ')})`, 'invalid');
  return chosen === 'keychain'
    ? keychainStore({ keychain: env?.WEAVE_KEYCHAIN ?? process.env.WEAVE_KEYCHAIN ?? null })
    : fileStore({ path, env });
}

export function fileStore({ path, env = process.env }) {
  const secret = () => {
    const pass = env?.WEAVE_KEYSTORE_PASSPHRASE;
    if (pass) return scryptSync(String(pass), 'weave-keystore-v2', 32);
    const keyPath = keyFilePath(path);
    try {
      const b = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
      if (b.length === 32) return b;
    } catch {}
    const fresh = randomBytes(32);
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, fresh.toString('base64'), { mode: 0o600 });
    return fresh;
  };
  const seal = (plain) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', secret(), iv);
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
  };
  const open = (entry, name) => {
    try {
      const d = createDecipheriv('aes-256-gcm', secret(), Buffer.from(entry.iv, 'base64'), { authTagLength: 16 });
      d.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(entry.ct, 'base64')), d.final()]).toString('utf8');
    } catch {
      throw new WeaveError(`Cannot decrypt '${name}' — wrong passphrase, or the keystore was edited outside weave`, 'invalid');
    }
  };
  return {
    kind: 'file',
    path,
    read() {
      let raw;
      try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return { v: 2, keys: {} }; }
      if (raw && raw.v === 2 && raw.keys) return raw;
      const keys = {};
      for (const [name, value] of Object.entries(raw ?? {})) keys[name] = { legacy: String(value) };
      return { v: 2, keys, migrated: true };
    },
    write(data) {
      for (const [name, entry] of Object.entries(data.keys)) {
        if (!('value' in entry) && !('legacy' in entry)) continue;
        const { value, legacy, iv, ct, tag, ...rest } = entry;
        data.keys[name] = { ...rest, ...seal('value' in entry ? value : legacy) };
      }
      delete data.migrated;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data, null, 1), { mode: 0o600 });
    },
    value(name, entry) {
      if ('value' in entry) return String(entry.value);
      return 'legacy' in entry ? entry.legacy : open(entry, name);
    },
    clear() {
      rmSync(path, { force: true });
      rmSync(keyFilePath(path), { force: true });
    },
  };
}

export function runSecurity(security, args, input = '') {
  const r = spawnSync(security, args, { input, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const readPassword = (stderr) => {
  const m = /^password: (?:0x([0-9A-Fa-f]*)(?:\s.*)?|"(.*)")?$/m.exec(stderr);
  if (!m) return null;
  return m[1] != null ? Buffer.from(m[1], 'hex').toString('utf8') : (m[2] ?? '');
};

export function keychainStore({ keychain = null, security = SECURITY, run = runSecurity } = {}) {
  const at = keychain ? [keychain] : [];
  const service = (name, entry) => `weave:${entry?.workspace ?? 'local'}:${name}`;
  const quoted = (s) => {
    if (/["\r\n\\]/.test(s)) throw new WeaveError(`The keychain cannot name an item with a quote, a backslash or a line break: '${s}'`, 'invalid');
    return `"${s}"`;
  };
  const failed = (what, r) => new WeaveError(`The keychain refused ${what}: ${(r.stderr || r.stdout).trim() || `security exited ${r.status}`}`, 'invalid');
  const put = (svc, value) => {
    const hex = Buffer.from(String(value), 'utf8').toString('hex');
    const line = ['add-generic-password', '-U', '-s', quoted(svc), '-a', KEYCHAIN_ACCOUNT, '-X', `"${hex}"`, ...at.map(quoted)].join(' ');
    const r = run(security, ['-i'], `${line}\n`);
    if (r.status !== 0 || /returned -?\d+/.test(r.stderr)) throw failed(`to store ${svc}`, r);
  };
  const get = (svc) => {
    const r = run(security, ['find-generic-password', '-s', svc, '-a', KEYCHAIN_ACCOUNT, '-g', ...at]);
    if (r.status === MISSING) return null;
    if (r.status !== 0) throw failed(`to read ${svc}`, r);
    const value = readPassword(r.stderr);
    if (value == null) throw failed(`to read ${svc}`, r);
    return value;
  };
  const drop = (svc) => {
    const r = run(security, ['delete-generic-password', '-s', svc, '-a', KEYCHAIN_ACCOUNT, ...at]);
    if (r.status !== 0 && r.status !== MISSING) throw failed(`to delete ${svc}`, r);
  };
  const read = () => {
    const raw = get(INDEX_SERVICE);
    if (!raw) return { v: 2, keys: {} };
    const index = JSON.parse(raw);
    return { v: 2, keys: index?.keys ?? {} };
  };
  return {
    kind: 'keychain',
    keychain,
    service,
    read,
    write(data) {
      const before = read().keys;
      const keys = {};
      for (const [name, entry] of Object.entries(data.keys)) {
        const { value, legacy, iv, ct, tag, ...meta } = entry;
        let plain = 'value' in entry ? value : legacy;
        const was = Object.hasOwn(before, name) ? service(name, before[name]) : null;
        if (plain === undefined && was && was !== service(name, meta)) plain = get(was);
        if (plain !== undefined) put(service(name, meta), plain);
        keys[name] = meta;
      }
      put(INDEX_SERVICE, JSON.stringify({ v: 2, keys }));
      for (const [name, entry] of Object.entries(before)) {
        if (!Object.hasOwn(keys, name) || service(name, keys[name]) !== service(name, entry)) drop(service(name, entry));
      }
    },
    value(name, entry) {
      if ('value' in entry) return String(entry.value);
      const v = get(service(name, entry));
      if (v == null) throw new WeaveError(`Key '${name}' has no value in the keychain (${service(name, entry)})`, 'not-found');
      return v;
    },
    clear() {
      for (const [name, entry] of Object.entries(read().keys)) drop(service(name, entry));
      drop(INDEX_SERVICE);
    },
  };
}
