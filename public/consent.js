(function (root) {
  const NAME = 'grunion_consent';
  const YEAR = 31536000;
  const BANNER = 'If you accept, PostHog records pages viewed, calls to action clicked, the link that brought you here and how far you get in weave setup. One cookie choice covers grunion.ai and weave.grunion.ai.';
  const OPTIONS = {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: true,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: false,
    opt_out_capturing_by_default: true,
  };
  const onGrunion = (hostname) => hostname === 'grunion.ai' || hostname.endsWith('.grunion.ai');

  function consentCookie(value, { hostname, https }) {
    const shared = onGrunion(hostname);
    return `${NAME}=${value}; Path=/; Max-Age=${YEAR}; SameSite=Lax${shared ? '; Domain=.grunion.ai' : ''}${shared || https ? '; Secure' : ''}`;
  }

  const state = { key: null, user: null, ph: null, loading: false, on: false, queue: [], banner: null };

  const choice = () => {
    const jar = document.cookie.split('; ');
    if (jar.includes(`${NAME}=granted`)) return 'granted';
    if (jar.includes(`${NAME}=denied`)) return 'denied';
    return null;
  };
  const remember = (value) => {
    document.cookie = consentCookie(value, { hostname: location.hostname, https: location.protocol === 'https:' });
  };

  function send(method, args) {
    if (!state.on) return;
    if (state.ph) state.ph[method](...args);
    else state.queue.push([method, args]);
  }
  const capture = (name, props) => send('capture', props === undefined ? [name] : [name, props]);
  function identify(user) {
    if (!user || state.user === user) return;
    state.user = user;
    send('identify', [user]);
  }

  function load() {
    state.on = true;
    if (state.ph) { state.ph.opt_in_capturing(); return; }
    if (state.loading) return;
    state.loading = true;
    if (state.user) state.queue.unshift(['identify', [state.user]]);
    const script = document.createElement('script');
    script.src = '/ingest/static/array.js';
    script.async = true;
    script.onload = () => {
      const ph = root.posthog;
      if (!ph?.init) return;
      ph.init(state.key, OPTIONS);
      if (!state.on) { ph.opt_out_capturing(); state.queue = []; return; }
      ph.opt_in_capturing();
      state.ph = ph;
      for (const [method, args] of state.queue.splice(0)) ph[method](...args);
    };
    document.head.append(script);
  }

  const STYLE = `.wv-consent{position:fixed;left:16px;bottom:16px;z-index:1000;max-width:min(480px,calc(100vw - 32px));padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel,var(--surface));color:var(--body);box-shadow:0 4px 18px rgba(0,0,0,.12);font:13.5px/1.5 var(--app,inherit)}
.wv-consent p{margin:0 0 12px}
.wv-consent a{color:var(--accent)}
.wv-consent-actions{display:flex;justify-content:flex-end;gap:8px}
.wv-consent button{min-height:36px;padding:6px 16px;border:1px solid var(--line);border-radius:8px;background:var(--panel,var(--surface));color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
.wv-consent button:hover{border-color:var(--muted)}
.wv-consent button.accept{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.wv-consent button:focus-visible,.wv-consent a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

  function close() {
    state.banner?.remove();
    state.banner = null;
  }
  function decide(value) {
    remember(value);
    close();
    if (value === 'granted') {
      load();
      root.dispatchEvent(new Event('grunion:consent-granted'));
      return;
    }
    state.on = false;
    state.queue = [];
    state.ph?.opt_out_capturing();
  }
  function ask() {
    if (state.banner) return;
    if (!document.getElementById('wv-consent-style')) {
      const style = document.createElement('style');
      style.id = 'wv-consent-style';
      style.textContent = STYLE;
      document.head.append(style);
    }
    const box = document.createElement('div');
    box.className = 'wv-consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Cookies');
    const text = document.createElement('p');
    const privacy = document.createElement('a');
    privacy.href = '/privacy#cookies';
    privacy.textContent = 'Privacy';
    text.append(`${BANNER} `, privacy);
    const actions = document.createElement('div');
    actions.className = 'wv-consent-actions';
    const button = (label, cls, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => decide(value));
      return b;
    };
    actions.append(button('Decline', 'decline', 'denied'), button('Accept', 'accept', 'granted'));
    box.append(text, actions);
    document.body.append(box);
    state.banner = box;
  }

  function start({ key, user } = {}) {
    if (!key || state.key) { if (state.key && user) identify(user); return; }
    state.key = key;
    if (user) identify(user);
    for (const slot of document.querySelectorAll('[data-consent-slot]')) {
      const link = document.createElement('a');
      link.href = '/privacy#cookies';
      link.dataset.consentOpen = '';
      link.textContent = 'Cookies';
      slot.append(' · ', link);
    }
    for (const link of document.querySelectorAll('[data-consent-open]')) link.addEventListener('click', (ev) => { ev.preventDefault(); ask(); });
    const was = choice();
    if (was === 'granted') load();
    else if (was === null) ask();
  }

  root.WeaveConsent = { start, capture, identify, consentCookie, OPTIONS, BANNER };
  const tag = typeof document !== 'undefined' ? document.currentScript : null;
  if (tag?.dataset.posthogKey) {
    const go = () => start({ key: tag.dataset.posthogKey });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(globalThis);
