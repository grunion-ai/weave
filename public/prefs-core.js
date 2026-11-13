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
  root.WeavePrefs = { of: store, read, write, drop, list };
})(globalThis);
