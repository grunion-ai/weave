(function (root) {
  const MARK = '#/resume';
  const KEY = 'wv-last-route';
  const keep = (hash) => !!hash && hash !== MARK;
  const land = (hash, stored) => (hash === MARK ? (keep(stored) ? stored : '#/') : hash);
  function follow(loc, storage) {
    const key = `${KEY}:${loc.pathname}`;
    let stored = null;
    try { stored = storage?.getItem(key) ?? null; } catch {}
    const landed = land(loc.hash, stored);
    if (landed === loc.hash && keep(landed)) try { storage?.setItem(key, landed); } catch {}
    return landed;
  }
  root.WeaveResume = { MARK, KEY, keep, land, follow };
})(globalThis);
