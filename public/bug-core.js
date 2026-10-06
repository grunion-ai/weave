(function (root) {
  const CATEGORIES = [
    { id: 'slow', label: 'Slow', severity: 'Medium', icon: 'lucide:clock', hint: 'Took too long, or never finished' },
    { id: 'broken-ui', label: 'Looks broken', severity: 'Medium', icon: 'lucide:layout-grid', hint: 'Overlapping, clipped, or misdrawn' },
    { id: 'wrong-data', label: 'Wrong data', severity: 'High', icon: 'lucide:file-minus', hint: "Didn't save, or shows the wrong value" },
    { id: 'error', label: 'Error', severity: 'High', icon: 'lucide:square-x', hint: 'Something threw, or the page is empty' },
  ];

  const MAX_EVENTS = 60;

  const isError = (e) => e.kind === 'error' || e.kind === 'console';

  function createRecorder({ max = MAX_EVENTS } = {}) {
    const buf = [];
    return {
      record(ev) {
        if (!ev || !ev.kind) return;
        buf.push(ev);
        while (buf.length > max) {
          const i = buf.findIndex((e) => !isError(e));
          buf.splice(i === -1 ? 0 : i, 1);
        }
      },
      events: () => buf.slice(),
      lastError: () => { for (let i = buf.length - 1; i >= 0; i--) if (isError(buf[i])) return String(buf[i].message ?? ''); return ''; },
      clear: () => { buf.length = 0; },
      counts() {
        const c = { actions: 0, errors: 0, failedRequests: 0, total: buf.length };
        for (const e of buf) {
          if (isError(e)) c.errors++;
          else if (e.kind === 'api') { if (e.status >= 400 || e.status === 0) c.failedRequests++; }
          else c.actions++;
        }
        return c;
      },
    };
  }

  const NAMEABLE = /^(BUTTON|A|SUMMARY|LABEL|TH|TD|LI|OPTION)$/;

  function ownText(node) {
    const kids = node.childNodes;
    if (!kids || typeof kids.length !== 'number') return node.textContent ?? '';
    let own = '';
    for (const k of kids) if (k.nodeType === 3) own += k.nodeValue ?? '';
    return own.trim() ? own : (node.textContent ?? '');
  }

  function describeTarget(node) {
    if (!node || !node.tagName) return 'unknown';
    const tag = String(node.tagName).toLowerCase();
    const classes = String(node.className ?? '')
      .split(/\s+/)
      .filter((c) => c && !/^(ng-|is-|has-)/.test(c));
    const named = classes.filter((c) => !classes.some((o) => o !== c && o.startsWith(c + '-')));
    const cls = named.length ? '.' + named[0] : '';
    const id = node.id ? '#' + node.id : '';
    const attr = (a) => (typeof node.getAttribute === 'function' ? node.getAttribute(a) : null);
    const field = node.dataset?.field;
    const eid = node.parentElement?.dataset?.eid;
    if (field) return `${tag}${cls}[${field}]${eid ? ` of ${eid}` : ''}`;
    const words = (attr('aria-label') || attr('title') || (NAMEABLE.test(node.tagName) ? ownText(node) : '') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    return `${tag}${id}${cls}${words ? ` "${words}"` : ''}`;
  }

  function clientContext(win = root, now = () => Date.now()) {
    const doc = win.document ?? {};
    return {
      url: String(win.location?.href ?? ''),
      route: String(win.location?.hash ?? ''),
      viewport: { w: win.innerWidth ?? 0, h: win.innerHeight ?? 0 },
      theme: doc.documentElement?.dataset?.bsTheme ?? 'light',
      userAgent: String(win.navigator?.userAgent ?? ''),
      at: now(),
      filedAt: new Date(now()).toISOString(),
    };
  }

  function toggleCategory(picked, id) {
    const next = picked.filter((p) => p !== id);
    return next.length === picked.length ? [...picked, id] : next;
  }

  const canSubmit = (picked, note) => picked.length > 0 || String(note ?? '').trim().length > 0;

  const REPORT_MAIL = 'weave@grunion.ai';
  const MAILTO_MAX = 2000;
  const ERROR_MAX = 300;

  const SECRET_PARAMS = /\b(token|key|secret|password|passwd|share|sig|signature|auth)=([^&\s"'`]+)/gi;
  const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
  const PREFIXED_KEY = /\b(wv[a-z]?|sk|pk|ucmcp|ghp|gho)_[A-Za-z0-9_-]{8,}/gi;
  const redact = (text) => String(text ?? '')
    .replace(BEARER, '$1 ***')
    .replace(SECRET_PARAMS, '$1=***')
    .replace(PREFIXED_KEY, '***');
  const blankQuotes = (text) => String(text ?? '').replace(/"[^"]*"/g, '"…"').replace(/'[^']*'/g, "'…'");

  function routeShape(pathname = '/', hash = '') {
    const path = String(pathname ?? '/').replace(/^\/w\/[^/]+\//, '/w/<ws>/');
    const route = String(hash ?? '').replace(/\?.*$/, '') || '#/';
    const shaped = route.replace(/^#\/(entity|table|db|space|view|trash|activity)\/[^/?]+/, '#/$1/<id>');
    return `${path}${shaped}`;
  }

  function browserLabel(ua = '') {
    const s = String(ua ?? '');
    const fam = s.match(/\b(Edg|CriOS|Firefox)\/(\d+)/) ?? s.match(/\b(?:Headless)?(Chrome|Version)\/(\d+)/);
    if (!fam) return 'unknown browser';
    const name = { Edg: 'Edge', CriOS: 'Chrome', Version: 'Safari' }[fam[1]] ?? fam[1];
    const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
      : /Mac OS X/.test(s) ? 'macOS' : /Linux|X11/.test(s) ? 'Linux' : '';
    return `${name} ${fam[2]}${os ? ` on ${os}` : ''}`;
  }

  const upWords = (s) => {
    const n = Number(s);
    if (!Number.isFinite(n)) return '';
    return n < 3600 ? `, up ${Math.round(n / 60)}m` : `, up ${Math.round(n / 3600)}h`;
  };
  const cut = (text, n) => (text.length > n ? text.slice(0, n) + '…' : text);

  function mailtoReport({ categories = [], note = '', pathname = '/', hash = '', health = {}, userAgent = '', viewport = null, theme = '', lastError = '' } = {}) {
    const labels = categories.map((id) => CATEGORIES.find((c) => c.id === id)?.label).filter(Boolean);
    const page = routeShape(pathname, hash);
    const text = String(note ?? '').trim();
    const first = text.split('\n')[0].trim();
    const subject = `[weave] ${labels.length ? `${labels.join(' + ')}: ` : ''}${first || `on ${page}`}`.slice(0, 100).trim();
    const version = health?.version ? `v${health.version}${health.stale ? ' (STALE: the server predates its own files)' : ''}` : 'v?';
    const build = `weave ${version}${health?.startedAt ? `, started ${health.startedAt}` : ''}${upWords(health?.uptime)}`;
    const look = [browserLabel(userAgent), viewport ? `${viewport.w} × ${viewport.h}` : '', theme].filter(Boolean).join(' · ');
    const error = cut(blankQuotes(redact(lastError)).replace(/\s+/g, ' ').trim(), ERROR_MAX);
    const body = (noteText, errorText) => [
      `Symptoms: ${labels.join(' + ') || '(none picked)'}`,
      `Note: ${noteText}`,
      '',
      'Steps:',
      '1. ',
      'Expected: ',
      'Actual: ',
      '',
      '--',
      build,
      `Page: ${page}`,
      `Browser: ${look}`,
      errorText ? `Console: ${errorText}` : null,
      '',
    ].filter((l) => l != null).join('\n');
    const href = (n, e) => `mailto:${REPORT_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body(n, e))}`;
    let n = text, e = error, out = href(n, e);
    const bare = (str) => str.replace(/…$/, '');
    for (let guard = 0; out.length > MAILTO_MAX && guard < 80; guard++) {
      if (bare(e).length > 80) e = bare(e).slice(0, Math.max(80, Math.floor(bare(e).length * 0.8))) + '…';
      else if (bare(n).length > 0) n = bare(n).slice(0, Math.floor(bare(n).length * 0.8)) + '…';
      else if (e) e = '';
      else break;
      out = href(n, e);
    }
    return out;
  }

  root.bugCore = { CATEGORIES, MAX_EVENTS, REPORT_MAIL, MAILTO_MAX, createRecorder, describeTarget, clientContext, toggleCategory, canSubmit, redact, routeShape, browserLabel, mailtoReport };
})(typeof window !== 'undefined' ? window : globalThis);
