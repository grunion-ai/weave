(function () {
  const meta = document.querySelector('meta[name="weave-route"]');
  if (!meta) return;
  if (meta.hasAttribute('data-sign-in')) location.replace(meta.content);
  else history.replaceState(history.state, '', meta.content);
})();
