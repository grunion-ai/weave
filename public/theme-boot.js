(function (win) {
  let pref = null;
  try { pref = win.localStorage.getItem('weave-theme'); } catch { pref = null; }
  const dark = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)').matches : false;
  win.document.documentElement.dataset.bsTheme = pref === 'dark' || pref === 'light' ? pref : dark ? 'dark' : 'light';
})(window);
