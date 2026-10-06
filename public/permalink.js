/* A permalink's own page (Feature #264). The server answers /e/<id>,
   /s/<id> and /t/<id> with the app shell and a preview head, and names the
   route the app opens in <meta name="weave-route">. This runs in the head,
   before any deferred script: the address moves to that route in place, so
   the app boots on it and Back leaves in one step, as the old 302 did. A
   signed-out preview names the sign-in page instead, which is a real
   navigation, replacing this entry the same way. */
(function () {
  const meta = document.querySelector('meta[name="weave-route"]');
  if (!meta) return;
  if (meta.hasAttribute('data-sign-in')) location.replace(meta.content);
  else history.replaceState(history.state, '', meta.content);
})();
