(function (root) {
  const MARK = '#/resume';
  const KEY = 'wv-last-route';
  const keep = (hash) => !!hash && hash !== MARK;
  const land = (hash, stored) => (hash === MARK ? (keep(stored) ? stored : '#/') : hash);
  root.WeaveResume = { MARK, KEY, keep, land };
})(globalThis);
