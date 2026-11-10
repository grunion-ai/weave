(function (root) {
  const WORDS = new Set(['w', 's', 'e', 't', 'table', 'db', 'entity', 'space', 'activity', 'view', 'trash', 'templates', 'settings', 'map', 'resume', 'start', 'auth', 'doc', 'docs', 'billing', 'status', 'privacy', 'terms']);
  const THRESHOLD = 0.1;
  const GAP_MS = 1000;
  const SESSION_MS = 5000;
  const FRAME_MS = 200;
  const EVERY_MS = 10000;
  const BATCH = 10;
  const PER_PAGE = 50;

  const strip = (part) => part.split('/').map((seg) => (!seg || WORDS.has(seg) ? seg : ':id')).join('/');
  function routeOf(pathname = '/', hash = '') {
    const path = strip(String(pathname).split('?')[0]);
    const h = String(hash).split('?')[0].replace(/^#/, '');
    return (h ? `${path}#${strip(h)}` : path).slice(0, 120);
  }

  const plain = (name) => /^[a-z][a-z-]{0,39}$/i.test(name);
  function selectorOf(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement ?? null;
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 4) {
      const tag = String(el.tagName).toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      const id = el.id && plain(el.id) ? `#${el.id}` : '';
      const classes = [...(el.classList ?? [])].filter(plain).slice(0, 3).map((c) => `.${c}`).join('');
      parts.unshift(`${tag}${id}${classes}`);
      if (id) break;
      el = el.parentElement;
    }
    return parts.length ? parts.join(' > ').slice(0, 200) : null;
  }

  const area = (r) => (r ? Math.max(0, r.width) * Math.max(0, r.height) : 0);
  const size = (s) => Math.max(area(s.previousRect), area(s.currentRect));
  const largest = (sources = []) => [...sources].sort((a, b) => size(b) - size(a))[0] ?? null;
  const moveOf = (s) => (s?.previousRect && s?.currentRect
    ? Math.round(Math.max(Math.abs(s.currentRect.x - s.previousRect.x), Math.abs(s.currentRect.y - s.previousRect.y)))
    : 0);
  const round = (n) => Math.round(n * 10000) / 10000;

  function createShiftSession(report) {
    let s = null;
    const close = () => {
      if (s && s.score > THRESHOLD) report({ kind: 'shift', score: round(s.score), selector: s.selector, move: s.move, route: s.route });
      s = null;
    };
    const add = (entry, route) => {
      if (entry.hadRecentInput) return;
      const t = entry.startTime;
      if (s && (t - s.last > GAP_MS || t - s.first > SESSION_MS)) close();
      if (!s) s = { first: t, last: t, score: 0, top: -1, selector: null, move: 0, route };
      s.score += entry.value;
      s.last = t;
      if (entry.value > s.top) {
        const src = largest(entry.sources);
        s.top = entry.value;
        s.selector = selectorOf(src?.node);
        s.move = moveOf(src);
      }
    };
    return { add, close };
  }

  const frameOf = (entry, route) => (entry.duration >= FRAME_MS
    ? { kind: 'frame', ms: Math.round(entry.duration), blocking: Math.round(entry.blockingDuration ?? 0), route }
    : null);

  function engineOf(ua = '') {
    if (/Firefox\//.test(ua)) return 'gecko';
    if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'blink';
    if (/AppleWebKit\//.test(ua)) return 'webkit';
    return 'other';
  }
  const payload = ({ build, ua, vw, vh, reports }) => ({ build, engine: engineOf(ua), vw: Math.round(vw), vh: Math.round(vh), reports });

  function start({ build, endpoint = '/api/paint' } = {}) {
    if (!build || typeof PerformanceObserver === 'undefined' || !navigator.sendBeacon) return;
    const types = PerformanceObserver.supportedEntryTypes ?? [];
    const queue = [];
    let left = PER_PAGE;
    let timer = null;
    let sentAt = -Infinity;
    const route = () => routeOf(location.pathname, location.hash);
    const send = () => {
      clearTimeout(timer);
      timer = null;
      if (!queue.length) return;
      sentAt = performance.now();
      navigator.sendBeacon(endpoint, JSON.stringify(payload({ build, ua: navigator.userAgent, vw: innerWidth, vh: innerHeight, reports: queue.splice(0, BATCH) })));
    };
    const report = (r) => {
      if (left <= 0 || queue.length >= BATCH) return;
      left -= 1;
      queue.push(r);
      if (!timer) timer = setTimeout(send, Math.max(0, sentAt + EVERY_MS - performance.now()));
    };
    const session = createShiftSession(report);
    let idle = null;
    if (types.includes('layout-shift')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) session.add(entry, route());
        clearTimeout(idle);
        idle = setTimeout(session.close, GAP_MS + 100);
      }).observe({ type: 'layout-shift', buffered: true });
    }
    if (types.includes('long-animation-frame')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) { const f = frameOf(entry, route()); if (f) report(f); }
      }).observe({ type: 'long-animation-frame', buffered: true });
    }
    const flush = () => { session.close(); send(); };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  root.WeavePaint = { routeOf, selectorOf, largest, moveOf, createShiftSession, frameOf, engineOf, payload, start };
  const tag = typeof document !== 'undefined' ? document.currentScript : null;
  if (tag?.dataset.build) start({ build: tag.dataset.build });
})(globalThis);
