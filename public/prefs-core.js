(function (root) {
  const store = (storage) => {
    try { return storage ?? root.localStorage ?? null; } catch { return null; }
  };
  const read = (key, storage) => {
    try { return store(storage)?.getItem(key) ?? null; } catch { return null; }
  };
  const write = (key, value, storage) => {
    const s = store(storage);
    if (!s) return false;
    try { s.setItem(key, value); return true; } catch { return false; }
  };
  const drop = (key, storage) => {
    const s = store(storage);
    if (!s) return false;
    try { s.removeItem(key); return true; } catch { return false; }
  };
  const list = (key, storage) => {
    const raw = read(key, storage);
    if (raw === null) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
    drop(key, storage);
    return [];
  };
  const PERSONAL = {
    theme: { key: 'weave-theme', choices: ['auto', 'light', 'dark'] },
    weekStart: { key: 'weave-week-start', choices: [0, 1] },
    dateFormat: { key: 'weave-date-format', choices: ['long', 'us', 'eu', 'iso'] },
    clock: { key: 'weave-clock', choices: ['12h', '24h'] },
    startPage: { key: 'weave-start-page', choices: ['last', 'home'] },
  };
  const choose = (name, raw) => PERSONAL[name].choices.find((c) => String(c) === raw) ?? PERSONAL[name].choices[0];
  const personal = (storage) => Object.fromEntries(Object.keys(PERSONAL).map((name) => [name, choose(name, read(PERSONAL[name].key, storage))]));
  const setPersonal = (name, value, storage) => {
    const pref = PERSONAL[name];
    if (!pref || !pref.choices.some((c) => String(c) === String(value))) return false;
    return write(pref.key, String(value), storage);
  };
  const lastKey = (ws) => `weave-last:${ws}`;
  const bare = (hash) => !hash || hash === '#' || hash === '#/';
  const routeLike = (hash) => typeof hash === 'string' && hash.startsWith('#/') && !bare(hash);
  const remember = (ws, hash, storage) => (routeLike(hash) ? write(lastKey(ws), hash, storage) : false);
  const startHash = (ws, hash, storage) => {
    if (!bare(hash) || personal(storage).startPage !== 'last') return null;
    const last = read(lastKey(ws), storage);
    return routeLike(last) ? last : null;
  };
  root.WeavePrefs = { of: store, read, write, drop, list, PERSONAL, personal, setPersonal, remember, startHash };
})(globalThis);
