(function () {
  const { COPY: SLUG, fill } = globalThis.WeaveSlugs;
  const { begin, reduce, progress } = globalThis.WeaveSetup;
  const { TEMPLATES, spec } = globalThis.WeaveStarters;
  const CATEGORIES = globalThis.WeaveStarters.CATEGORIES ?? [];
  const { TOOLS, guide } = globalThis.WeaveAgentConnect;
  const main = document.getElementById('start');
  const stage = document.getElementById('stage');
  const meter = document.getElementById('progress');
  const NS = 'http://www.w3.org/2000/svg';

  const COPY = {
    account: {
      title: 'Your weave account',
      signInTitle: 'weave sign-in',
      lead: 'One account opens every workspace you make or join.',
      go: 'Sign up or sign in',
      haveAccount: 'Already have an account?',
      signIn: 'Sign in',
      newHere: 'New to weave?',
      signUp: 'Create an account',
      bypass: 'Skip the guided steps and start an empty workspace',
      bypassOn: 'You\'ll start in an empty workspace. Turn the guided steps back on',
      loading: 'Loading sign-up',
    },
    steps: { of: 'Step {n} of {total}', building: 'Building {title}' },
    list: { title: 'Your workspaces', empty: 'This sign-in has no workspaces yet.', create: 'Create a workspace', limit: 'This sign-in has reached the server\'s workspace limit. Open one of the workspaces above.' },
    closed: { title: 'This server is invite only', lead: 'Ask the owner of a workspace for an invite link. Opening it adds you to their workspace.' },
    workspace: { title: 'Workspace name and address', lead: 'The name is what people see. The address is the link that opens the workspace.' },
    waiting: { text: '{name} needs a plan before you can start another workspace.', link: 'Open billing' },
    work: {
      title: 'What you\'re building',
      lead: 'weave builds the tables and a few sample rows for the setup you pick. You can change any of it later.',
      all: 'All',
      more: 'More',
      tables: 'Tables',
      choose: 'Start with {title}',
      search: 'Search setups',
      searchPlaceholder: 'Search: sales, recipes, hiring',
      noMatch: 'No setup matches “{query}”.',
      fallbacks: 'Setups for any work',
      empty: 'Empty',
      emptyBlurb: 'A workspace with no tables yet',
      emptyDetails: 'weave starts an empty workspace. Describe what you\'ll track, and the AI app you connect next proposes the tables.',
      emptyLabel: 'Work to track (optional)',
      emptyPlaceholder: 'Dog adoptions, with families, dogs and visits',
    },
    build: { claim: 'Claim {address}', table: 'Create {table}', rows: 'Add sample rows', door: 'Allow your AI app in', empty: 'Start an empty workspace' },
    agent: {
      title: 'Your agent',
      lead: 'Connect the agent you already use. You sign in; weave never asks for an API key.',
      chat: 'Chat apps',
      harnesses: 'Harnesses',
      change: 'Change app',
      copyAddress: 'Copy address',
      copyCommand: 'Copy command',
      copyPrompt: 'Copy setup prompt',
      waiting: 'Waiting for {tool} to connect.',
      connected: '{tool} is connected to {title}.',
      payoffTitle: 'First message',
      payoffHint: 'Paste it into a new {tool} chat.',
      copyMessage: 'Copy message',
      skip: 'Skip for now',
    },
    done: { title: '{title} is ready', withAgent: 'Your AI app is connected. Open the workspace, then ask your AI app for a tour.', withoutAgent: 'To connect an AI app later, add this connection address to it: {mcp}', open: 'Open workspace' },
    trial: { left: '{n} days left in your trial', leftOne: '1 day left in your trial' },
    errors: {
      signin_failed: 'Sign-in did not finish. Try again, or use a different account.',
      signin_unverified: 'weave could not verify that sign-in. Try again.',
      provider_down: '{provider} is not answering. Try again in a minute.',
      template_failed: 'The {template} template did not build, so your workspace starts empty. Your AI app can build the tables in the next step.',
      build_failed: 'Setup did not finish. Try again, or skip setup to start an empty workspace.',
      network: 'Setup did not finish because weave did not answer. Try again.',
    },
    copied: 'Copied', back: 'Back', next: 'Continue', skip: 'Skip setup', signOut: 'Sign out', addLogin: 'Add another sign-in', accept: SLUG.start.accept,
  };

  const make = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };
  const glyph = (name, cls = 'glyph') => make('span', { class: cls, 'aria-hidden': 'true', style: `--icon:url("/vendor/icons/${String(name).replace(/^lucide:/, '')}.svg")` });
  const getJson = async (path, init) => {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? String(res.status)), { code: data.code ?? (res.status >= 500 ? 'build_failed' : null) });
    return data;
  };
  const post = (path, body) => getJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const mark = () => document.getElementById('weave-mark').content.firstElementChild.cloneNode(true);

  const radiate = () => make('picture', { class: 'radiate' },
    make('source', { srcset: '/brand/weave-radiate-dark.svg', media: '(prefers-color-scheme: dark)' }),
    make('img', { src: '/brand/weave-radiate-light.svg', alt: 'The weave mark with rings radiating to every edge' }));

  const SEG = 25;
  const GAP = 2.2;
  const donut = (() => {
    const box = svg('svg', { class: 'donut', viewBox: '0 0 52 52', 'aria-hidden': 'true' });
    const arc = (cls, k) => svg('circle', { class: cls, cx: 26, cy: 26, r: 21, pathLength: 100, 'stroke-dashoffset': -(k * SEG + GAP / 2), 'stroke-dasharray': `${SEG - GAP} 100` });
    const fills = [0, 1, 2, 3].map((k) => arc(`fill ${k % 2 ? 'b' : 'a'}`, k));
    box.append(...[0, 1, 2, 3].map((k) => arc('track', k)), ...fills);
    const pct = svg('text', { x: 26, y: 26, class: 'pct', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    box.append(pct);
    const of = make('span', { class: 'progress-of' });
    const name = make('b', { class: 'progress-name' });
    meter.replaceChildren(box, make('span', { class: 'progress-text' }, of, name));
    let shown = 0;
    let frame = 0;
    const paint = (at) => {
      shown = at;
      fills.forEach((f, k) => {
        const len = Math.max(0, Math.min(1, at * 4 - k)) * (SEG - GAP);
        f.setAttribute('stroke-dasharray', `${len} 100`);
        f.style.visibility = len > 0.05 ? '' : 'hidden';
      });
      pct.textContent = `${Math.round(at * 100)}%`;
    };
    paint(0);
    return (p, label) => {
      meter.hidden = !p;
      if (!p) return;
      meter.setAttribute('aria-valuenow', String(Math.round(p.at * 100)));
      meter.setAttribute('aria-valuetext', `${fill(COPY.steps.of, { n: p.n, total: p.of })}: ${label ?? p.label}`);
      of.textContent = fill(COPY.steps.of, { n: p.n, total: p.of });
      name.textContent = label ?? p.label;
      cancelAnimationFrame(frame);
      if (reduced() || Math.abs(p.at - shown) < 0.001) { paint(p.at); return; }
      const from = shown;
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 650);
        paint(from + (p.at - from) * (1 - (1 - t) ** 3));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
  })();

  let s = null;
  let me = null;
  let poll = null;
  let building = false;
  let onResize = null;

  function dispatch(e) {
    s = reduce(s, e);
    render();
  }

  function errorBox(error) {
    if (!error) return null;
    const text = fill(COPY.errors[error.code] ?? error.message ?? COPY.errors.network, {
      provider: me?.provider ?? 'The sign-in provider',
      template: TEMPLATES.find((t) => t.id === error.template)?.work ?? TEMPLATES.find((t) => t.id === error.template)?.title ?? 'chosen',
      message: error.message ?? '',
    });
    return make('div', { class: `alert${error.code === 'template_failed' ? ' note' : ''}`, role: 'alert', 'data-code': error.code },
      make('span', { class: 'grow' }, text),
      make('button', { type: 'button', class: 'btn-link', 'aria-label': 'Dismiss', onclick: () => dispatch({ type: 'dismiss' }) }, 'Dismiss'));
  }

  function waitingNote() {
    if (!me?.waiting) return null;
    const row = (me.rows ?? []).find((r) => r.name === me.waiting);
    const href = row?.billing ?? (row?.open ? `${row.open}?to=billing` : null);
    return make('div', { class: 'alert note', role: 'status', 'data-code': 'waiting' },
      make('span', { class: 'grow' }, fill(COPY.waiting.text, { name: row?.title ?? me.waiting })),
      href ? make('a', { class: 'btn-link', href, 'data-go': 'billing' }, COPY.waiting.link) : null);
  }

  const signInHref = (next) => `/api/auth/oidc/start?start=1&next=${encodeURIComponent(next)}`;

  let clerk = null;
  const inject = (src, attrs = {}) => new Promise((resolve, reject) => {
    const script = make('script', { src, async: true, crossorigin: 'anonymous', ...attrs });
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${src} did not load`));
    document.head.append(script);
  });
  const loadClerk = (pane) => clerk ?? (clerk = (async () => {
    const ui = pane.ui ?? `${new URL(pane.script).origin}/npm/@clerk/ui@1/dist/ui.browser.js`;
    await Promise.all([inject(ui), inject(pane.script, { 'data-clerk-publishable-key': pane.publishableKey })]);
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    return window.Clerk;
  })());

  function clerkAppearance() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      variables: { colorPrimary: v('--accent'), colorTextOnPrimaryBackground: v('--accent-ink'), colorText: v('--ink'), colorTextSecondary: v('--muted'), colorBackground: v('--panel'), colorInputBackground: v('--panel'), colorInputText: v('--ink'), colorNeutral: v('--ink'), borderRadius: '8px', fontFamily: v('--app'), fontSize: '15px' },
      elements: { rootBox: { width: '100%' }, cardBox: { width: '100%', boxShadow: 'none', border: 'none' }, card: { boxShadow: 'none', border: 'none', padding: '0', background: 'transparent' }, header: { display: 'none' }, footer: { background: 'transparent' }, footerAction: { display: 'none' } },
    };
  }

  function account() {
    let skipping = false;
    let mode = 'signup';
    const pane = me.clerk;
    const title = make('h1', {}, COPY.account.title);
    const button = make('a', { class: 'btn btn-primary btn-wide', href: signInHref('/start'), 'data-go': 'signin', hidden: !!pane }, COPY.account.go);
    const mount = pane ? make('div', { id: 'clerk-pane', 'aria-busy': 'true' }, make('p', { class: 'muted' }, COPY.account.loading)) : null;
    const switchLead = make('span', {});
    const switchGo = make('button', { type: 'button', class: 'btn-link strong', 'data-go': 'switch', onclick: () => { mode = mode === 'signup' ? 'signin' : 'signup'; show(); } });
    const toggle = make('p', { class: 'switch', hidden: true }, switchLead, ' ', switchGo);
    const show = async () => {
      const next = signInHref(skipping ? '/start?setup=skip' : '/start');
      title.textContent = mode === 'signup' ? COPY.account.title : COPY.account.signInTitle;
      switchLead.textContent = mode === 'signup' ? COPY.account.haveAccount : COPY.account.newHere;
      switchGo.textContent = mode === 'signup' ? COPY.account.signIn : COPY.account.signUp;
      switchGo.dataset.to = mode === 'signup' ? 'signin' : 'signup';
      try {
        const c = await loadClerk(pane);
        if (c.user) { location.href = next; return; }
        c.unmountSignIn?.(mount);
        c.unmountSignUp?.(mount);
        mount.replaceChildren();
        mount.removeAttribute('aria-busy');
        mount.dataset.mode = mode;
        const appearance = clerkAppearance();
        if (mode === 'signup' && c.mountSignUp) c.mountSignUp(mount, { forceRedirectUrl: next, signInForceRedirectUrl: next, appearance });
        else c.mountSignIn(mount, { forceRedirectUrl: next, signUpForceRedirectUrl: next, appearance });
        toggle.hidden = !c.mountSignUp;
      } catch {
        mount.replaceChildren();
        mount.hidden = true;
        toggle.hidden = true;
        button.hidden = false;
        title.textContent = COPY.account.title;
      }
    };
    const bypass = make('a', { class: 'btn-link', href: signInHref('/start?setup=skip'), 'data-go': 'bypass', onclick: (ev) => {
      if (!pane || mount.hidden) return;
      ev.preventDefault();
      skipping = !skipping;
      ev.currentTarget.textContent = skipping ? COPY.account.bypassOn : COPY.account.bypass;
      ev.currentTarget.setAttribute('aria-pressed', String(skipping));
      button.href = signInHref(skipping ? '/start?setup=skip' : '/start');
      show();
    } }, COPY.account.bypass);
    if (pane) queueMicrotask(show);
    return [
      title,
      make('p', { class: 'lead' }, COPY.account.lead),
      errorBox(s.error),
      mount,
      button,
      toggle,
      make('p', { class: 'muted bypass' }, bypass),
    ];
  }

  function foot() {
    return make('p', { class: 'muted', style: 'margin-top:22px' },
      make('a', { class: 'btn-link', href: '/api/auth/oidc/start?start=1&fresh=1' }, COPY.addLogin), ' · ',
      make('button', { type: 'button', class: 'btn-link', 'data-go': 'signout', onclick: async () => {
        await post('/api/start/signout').catch(() => {});
        await boot();
      } }, COPY.signOut));
  }

  function list() {
    const several = (me.logins ?? []).length > 1;
    const rows = (me.rows ?? []).map((r) => (r.kind === 'invite'
      ? make('li', { class: 'invite' },
        make('span', {}, r.title, make('small', {}, fill(SLUG.start.inviteLead, { role: r.role }) + (several ? ` · ${r.login}` : ''))),
        make('button', { type: 'button', class: 'btn', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { location.href = (await post(r.accept)).open; } catch (err) { ev.currentTarget.disabled = false; dispatch({ type: 'fail', code: err.code, message: err.message }); }
        } }, COPY.accept))
      : make('li', {}, make('a', { href: r.open }, r.title, r.title !== r.name ? make('small', {}, r.name) : null, several ? make('small', {}, r.login) : null))));
    return [
      make('h1', {}, COPY.list.title),
      errorBox(s.error),
      waitingNote(),
      rows.length ? make('ul', { class: 'rows' }, rows) : make('p', { class: 'muted' }, COPY.list.empty),
      me.canCreate && !me.waiting ? make('div', { class: 'actions' }, make('button', { type: 'button', class: 'btn btn-primary', 'data-go': 'new', onclick: () => dispatch({ type: 'new' }) }, COPY.list.create))
        : me.openSignup && !me.waiting ? make('p', { class: 'muted' }, COPY.list.limit) : null,
      foot(),
    ];
  }

  function closed() {
    return [make('h1', {}, COPY.closed.title), make('p', { class: 'lead' }, COPY.closed.lead), errorBox(s.error), foot()];
  }

  function workspace() {
    const head = [make('h1', {}, COPY.workspace.title), make('p', { class: 'lead' }, COPY.workspace.lead)];
    if (me.waiting) {
      return [...head, waitingNote(), (me.rows ?? []).length ? make('div', { class: 'actions' }, make('button', { type: 'button', class: 'btn', onclick: () => dispatch({ type: 'back' }) }, COPY.back)) : null];
    }
    const slugs = globalThis.WeaveSlugForm.mount({
      accountName: me.accountName,
      base: me.base,
      check: (slug) => getJson(`/api/start/slug?slug=${encodeURIComponent(slug)}`),
    });
    const go = make('button', { type: 'submit', class: 'btn btn-primary', 'data-go': 'next' });
    slugs.bindSubmit(go);
    go.textContent = COPY.next;
    const form = make('form', { novalidate: true }, slugs.node, make('div', { class: 'actions' },
      (me.rows ?? []).length ? make('button', { type: 'button', class: 'btn', onclick: () => dispatch({ type: 'back' }) }, COPY.back) : null,
      make('button', { type: 'button', class: 'btn-link', 'data-go': 'skip', onclick: () => dispatch({ type: 'skip' }) }, COPY.skip),
      make('span', { class: 'grow' }), go));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (go.disabled) return;
      dispatch({ type: 'next', ...slugs.value() });
    });
    queueMicrotask(() => {
      slugs.nameInput.value = s.data.name || me.accountName || '';
      if (s.data.slug) slugs.slugInput.value = s.data.slug;
      slugs.nameInput.dispatchEvent(new Event('input'));
      if (s.data.slug) slugs.slugInput.dispatchEvent(new Event('input'));
      if (s.error && /^slug_/.test(s.error.code)) slugs.refused(s.error.code);
      slugs.nameInput.focus();
    });
    return [...head, s.error && !/^slug_/.test(s.error.code) ? errorBox(s.error) : null, form];
  }

  const titleOf = (t) => t.work ?? t.title;
  const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const BASIC = 'basic';
  const EMPTY = 'empty';

  function shelves() {
    const listed = TEMPLATES.filter((t) => t.id !== BASIC);
    const cats = CATEGORIES.map((c) => ({ ...c, items: listed.filter((t) => t.category === c.id) })).filter((c) => c.items.length);
    const loose = listed.filter((t) => !cats.some((c) => c.id === t.category));
    if (!cats.length) return [{ id: 'all', label: null, items: listed }];
    return loose.length ? [...cats, { id: 'more', label: COPY.work.more, items: loose }] : cats;
  }

  function haystack(t) {
    if (globalThis.WeaveStarters.searchText) return fold(globalThis.WeaveStarters.searchText(t));
    const cat = CATEGORIES.find((c) => c.id === t.category)?.label;
    const tables = spec(t).spaces[0].tables.map((x) => x.name);
    return fold([t.title, t.work, t.blurb, t.details, t.like, cat, ...tables].filter(Boolean).join(' '));
  }
  const matches = (hay, query) => fold(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));

  function links(tables) {
    const names = tables.map((x) => x.name);
    const edges = [];
    for (const x of tables) {
      for (const f of x.fields ?? []) {
        if (f.type !== 'relation' || f.to === x.name || !names.includes(f.to)) continue;
        if (!edges.some((e) => e.includes(x.name) && e.includes(f.to))) edges.push([x.name, f.to]);
      }
    }
    const linked = (a, b) => edges.some((e) => e.includes(a) && e.includes(b));
    const degree = (n) => edges.filter((e) => e.includes(n)).length;
    const seen = new Set();
    const levels = [];
    for (const start of [...names].sort((a, b) => degree(b) - degree(a))) {
      if (seen.has(start)) continue;
      seen.add(start);
      for (let level = [start]; level.length;) {
        levels.push(level);
        level = names.filter((m) => !seen.has(m) && level.some((n) => linked(n, m)));
        for (const m of level) seen.add(m);
      }
    }
    return { levels, edges };
  }

  function tableMap(t) {
    const tables = spec(t).spaces[0].tables;
    const { levels, edges } = links(tables);
    const icon = new Map(tables.map((x) => [x.name, x.icon ?? t.icon]));
    const node = (name) => make('li', { class: 'map-node', 'data-table': name }, glyph(icon.get(name)), name);
    const rows = levels.map((level, i) => [i ? make('li', { class: 'map-break', role: 'presentation', 'aria-hidden': 'true' }) : null, ...level.map(node)]);
    const lines = svg('svg', { class: 'map-lines', 'aria-hidden': 'true' });
    const list = make('ul', { class: 'map-nodes', 'aria-label': COPY.work.tables }, rows.flat());
    const nodes = [...list.querySelectorAll('.map-node')];
    const map = make('div', { class: 'map', 'data-edges': edges.length }, lines, list);
    const draw = () => {
      const box = map.getBoundingClientRect();
      if (!box.width) return;
      const at = new Map(nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return [n.dataset.table, { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, top: r.top - box.top, bottom: r.bottom - box.top }];
      }));
      const between = (p, q) => [...at.values()].some((o) => o !== p && o !== q && Math.abs(o.top - p.top) < 2 && o.x > Math.min(p.x, q.x) && o.x < Math.max(p.x, q.x));
      lines.replaceChildren(...edges.map(([a, b]) => {
        const [p, q] = [at.get(a), at.get(b)].sort((u, v) => u.top - v.top || u.x - v.x);
        const d = Math.abs(p.top - q.top) >= 2
          ? `M${p.x} ${p.bottom} C${p.x} ${p.bottom + 10} ${q.x} ${q.top - 10} ${q.x} ${q.top}`
          : between(p, q)
            ? `M${p.x} ${p.bottom} C${p.x} ${p.bottom + 14} ${q.x} ${q.bottom + 14} ${q.x} ${q.bottom}`
            : `M${p.x} ${p.y} L${q.x} ${q.y}`;
        return svg('path', { d, 'data-edge': `${a}|${b}` });
      }));
    };
    const watch = new ResizeObserver(draw);
    watch.observe(map);
    for (const n of nodes) watch.observe(n);
    return map;
  }

  let choice = null;
  let shelf = 'all';
  let query = '';
  function work() {
    choice = s.data.other ? EMPTY : s.data.template ?? choice;
    const groups = shelves();
    const basic = TEMPLATES.find((t) => t.id === BASIC) ?? null;
    if (!groups.some((g) => g.id === shelf)) shelf = 'all';
    const other = make('textarea', { class: 'form-control', rows: 2, id: 'work-other', placeholder: COPY.work.emptyPlaceholder });
    other.value = s.data.other ?? '';
    const details = make('div', { class: 'details', id: 'work-details', 'aria-live': 'polite' });
    const goLabel = (id) => (id && id !== EMPTY ? fill(COPY.work.choose, { title: titleOf(TEMPLATES.find((t) => t.id === id)) }) : COPY.next);
    const go = make('button', { type: 'button', class: 'btn btn-primary', 'data-go': 'next', disabled: !choice, onclick: () => {
      if (!choice) return;
      dispatch({ type: 'next', template: choice === EMPTY ? null : choice, other: choice === EMPTY ? other.value.trim() : '' });
    } }, goLabel(choice));
    const card = (id, iconName, title, blurb, hay) => {
      const b = make('button', { type: 'button', class: 'card', 'data-template': id, 'aria-pressed': String(choice === id), 'aria-controls': 'work-details', onclick: () => select(id) },
        glyph(iconName, 'glyph tile'), make('span', { class: 'card-text' }, make('b', {}, title), make('small', {}, blurb)));
      b.hay = hay;
      return b;
    };
    const sections = groups.map((g) => make('section', { class: 'shelf', 'data-category': g.id },
      g.label ? make('h2', {}, g.label) : null,
      make('div', { class: 'cards' }, g.items.map((t) => card(t.id, t.icon, titleOf(t), t.blurb, haystack(t))))));
    const noMatch = make('p', { class: 'muted no-match', hidden: true });
    const fallback = make('section', { class: 'shelf fallback', 'data-category': 'fallback' },
      make('h2', {}, COPY.work.fallbacks), noMatch,
      make('div', { class: 'cards' },
        card(EMPTY, 'lucide:plus', COPY.work.empty, COPY.work.emptyBlurb, null),
        basic ? card(BASIC, basic.icon, titleOf(basic), basic.blurb, null) : null));
    const chips = groups.length > 1 ? make('div', { class: 'chips', role: 'group', 'aria-label': COPY.work.title },
      [{ id: 'all', label: COPY.work.all }, ...groups].map((g) => make('button', { type: 'button', class: 'chip', 'data-category': g.id, 'aria-pressed': String(shelf === g.id), onclick: () => { shelf = g.id; filter(); } },
        g.icon ? glyph(g.icon) : null, g.label))) : null;
    const gallery = make('div', { class: 'gallery' }, sections, fallback);
    const search = make('input', { type: 'search', class: 'form-control', id: 'work-search', 'aria-label': COPY.work.search, placeholder: COPY.work.searchPlaceholder, autocomplete: 'off', enterkeyhint: 'search', 'aria-controls': 'work-gallery' });
    gallery.id = 'work-gallery';
    search.value = query;
    const visible = () => [...gallery.querySelectorAll('.card')].filter((c) => !c.hidden && !c.closest('.shelf').hidden);

    function describe() {
      if (choice === EMPTY) {
        details.replaceChildren(
          make('p', { class: 'details-lead' }, COPY.work.emptyDetails),
          make('label', { class: 'form-label', for: 'work-other' }, COPY.work.emptyLabel), other);
        return;
      }
      const t = TEMPLATES.find((x) => x.id === choice);
      if (!t) { details.replaceChildren(); return; }
      details.replaceChildren(...[
        make('p', { class: 'details-lead' }, t.details ?? t.blurb),
        t.like ? make('p', { class: 'details-like' }, t.like) : null,
        tableMap(t),
      ].filter(Boolean));
    }

    const columns = (grid) => Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    function place() {
      details.remove();
      const picked = gallery.querySelector('.card[aria-pressed="true"]');
      if (!picked || picked.hidden || picked.closest('.shelf').hidden) return;
      const grid = picked.parentElement;
      const cards = [...grid.children].filter((c) => !c.hidden);
      const cols = columns(grid);
      const i = cards.indexOf(picked);
      cards[Math.min(cards.length - 1, Math.floor(i / cols) * cols + cols - 1)].after(details);
      details.style.setProperty('--notch', `${((i % cols) + 0.5) / cols * 100}%`);
    }

    function select(id) {
      choice = id;
      for (const b of gallery.querySelectorAll('.card')) b.setAttribute('aria-pressed', String(b.dataset.template === id));
      go.textContent = goLabel(id);
      go.disabled = false;
      if (id === EMPTY && !other.value && query && !visible().some((c) => c.hay)) other.value = query;
      describe();
      place();
      details.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      if (id === EMPTY) other.focus();
    }

    function filter() {
      for (const c of chips?.children ?? []) c.setAttribute('aria-pressed', String(c.dataset.category === shelf));
      let hits = 0;
      for (const sec of sections) {
        let shown = 0;
        for (const c of sec.querySelectorAll('.card')) {
          c.hidden = !matches(c.hay, query);
          if (!c.hidden) shown++;
        }
        hits += shown;
        sec.hidden = !shown || (shelf !== 'all' && sec.dataset.category !== shelf);
      }
      noMatch.hidden = hits > 0;
      noMatch.textContent = hits ? '' : fill(COPY.work.noMatch, { query: query.trim() });
      gallery.classList.toggle('one', shelf !== 'all');
      gallery.dataset.hits = String(hits);
      place();
    }

    search.addEventListener('input', () => { query = search.value; filter(); });
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && search.value) { ev.preventDefault(); search.value = ''; query = ''; filter(); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); visible()[0]?.focus(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); const first = visible()[0]; if (first) { select(first.dataset.template); first.focus(); } }
    });
    const lift = () => {
      if (!matchMedia('(max-width: 860px)').matches) return;
      const box = search.closest('.search');
      scrollTo({ top: Math.max(0, box.getBoundingClientRect().top + scrollY - 12), behavior: 'instant' });
    };
    search.addEventListener('focus', () => { lift(); setTimeout(() => { if (document.activeElement === search) lift(); }, 300); });
    gallery.addEventListener('keydown', (ev) => {
      const at = ev.target.closest?.('.card');
      if (!at) return;
      const cards = visible();
      const i = cards.indexOf(at);
      const cols = columns(at.parentElement);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols }[ev.key];
      if (ev.key === 'Escape') { ev.preventDefault(); search.focus(); return; }
      if (to == null) return;
      ev.preventDefault();
      if (to < 0) { search.focus(); return; }
      cards[Math.min(cards.length - 1, to)]?.focus();
    });

    describe();
    queueMicrotask(filter);
    onResize = place;
    addEventListener('resize', place);
    return [
      make('h1', {}, COPY.work.title), make('p', { class: 'lead' }, COPY.work.lead), errorBox(s.error),
      make('div', { class: 'search' }, glyph('lucide:search'), search), chips, gallery,
      make('div', { class: 'actions sticky' },
        make('button', { type: 'button', class: 'btn', onclick: () => dispatch({ type: 'back' }) }, COPY.back),
        make('button', { type: 'button', class: 'btn-link', 'data-go': 'skip', onclick: () => dispatch({ type: 'skip' }) }, COPY.skip),
        make('span', { class: 'grow' }), go),
    ];
  }

  const chosen = () => (s.skipped ? null : TEMPLATES.find((t) => t.id === s.data.template) ?? null);
  const address = () => {
    const slug = s.made?.name ?? s.data.slug ?? '';
    return me.base ? `${slug || 'your-name'}.${me.base}` : slug || 'your workspace';
  };
  const workspaceTitle = () => s.data.name || me.accountName || 'your workspace';
  function buildList() {
    const t = chosen();
    const tables = t ? spec(t).spaces[0].tables.map((x) => x.name) : [];
    return [fill(COPY.build.claim, { address: address() }), ...(t ? tables.map((table) => fill(COPY.build.table, { table })) : [COPY.build.empty]), ...(t ? [COPY.build.rows] : []), COPY.build.door];
  }

  function build() {
    const items = buildList();
    const list = make('ul', { class: 'checklist', 'aria-live': 'polite' }, items.map((label) => make('li', {}, label)));
    if (!building) run(items, list);
    return [make('h1', {}, fill(COPY.steps.building, { title: workspaceTitle() })), list];
  }

  async function run(items, list) {
    building = true;
    const t = chosen();
    const body = s.skipped && !s.data.slug ? { quick: true } : { name: s.data.name, slug: s.data.slug, ...(t ? { template: t.id } : {}) };
    const step = reduced() ? 0 : 650;
    const lasting = wait(items.length * step + 300);
    items.forEach((_, i) => setTimeout(() => {
      list.children[i]?.setAttribute('data-done', '');
      if (s.step === 'build') donut(progress(s, { done: i + 1, of: items.length }), fill(COPY.steps.building, { title: workspaceTitle() }));
    }, (i + 1) * step));
    try {
      const made = await post('/api/start/workspaces', body);
      await lasting;
      building = false;
      dispatch({ type: 'built', made });
    } catch (err) {
      building = false;
      dispatch({ type: 'fail', code: err.code ?? 'network', message: err.code ? err.message : null });
    }
  }

  const copyButton = (value, label, text, cls = 'btn') => make('button', { type: 'button', class: cls, 'data-copy': label, onclick: async (ev) => {
    const b = ev.currentTarget;
    try { await navigator.clipboard.writeText(value); } catch {
      const r = document.createRange();
      r.selectNodeContents(b.closest('.copybox').querySelector('code, pre'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
    b.dataset.copied = '';
    b.textContent = COPY.copied;
    setTimeout(() => { delete b.dataset.copied; b.textContent = text; }, 1600);
  } }, text);

  const appTile = (t, size = '') => t.logo
    ? make('span', { class: `app-tile${size} has-logo`, 'aria-hidden': 'true' }, make('img', { class: 'logo', src: `/vendor/brands/${t.logo}.svg`, alt: '', width: '20', height: '20', decoding: 'async' }))
    : make('span', { class: `app-tile${size}`, style: `--hue:${t.hue}`, 'aria-hidden': 'true' }, glyph(t.icon));

  function agent() {
    const title = s.made?.title ?? s.data.name;
    const g = s.data.tool ? guide(s.data.tool, { url: s.made.mcp, workspace: title, template: chosen()?.work ?? chosen()?.title ?? null, other: s.data.other }) : null;
    const skip = make('button', { type: 'button', class: 'btn-link', 'data-go': 'skip', onclick: () => dispatch({ type: 'skip' }) }, COPY.agent.skip);
    if (!g) {
      const group = (heading, kinds) => {
        const tools = TOOLS.filter((t) => kinds.includes(t.kind));
        return tools.length ? [make('h2', {}, heading), make('div', { class: 'apps' }, tools.map((t) => make('button', { type: 'button', class: 'app', 'data-tool': t.id, onclick: () => dispatch({ type: 'tool', tool: t.id }) },
          appTile(t), make('span', { class: 'app-text' }, make('b', {}, t.name), make('small', {}, t.pitch ?? t.where)))))] : [];
      };
      return [make('h1', {}, COPY.agent.title), make('p', { class: 'lead' }, COPY.agent.lead), errorBox(s.error),
        ...group(COPY.agent.chat, ['chat']), ...group(COPY.agent.harnesses, ['harness', 'other']),
        make('div', { class: 'actions' }, skip)];
    }
    const kind = { prompt: COPY.agent.copyPrompt, command: COPY.agent.copyCommand, codex: COPY.agent.copyCommand, url: COPY.agent.copyAddress }[g.copy];
    const block = g.copy === 'prompt' ? 'pre' : 'code';
    const action = make('div', { class: 'step-action' },
      make('div', { class: `copybox${block === 'pre' ? ' stacked' : ''}` }, make(block, { 'aria-label': g.copy === 'prompt' ? 'setup prompt' : 'address', class: g.copy === 'prompt' ? 'prompt' : null }, g.value), copyButton(g.value, 'address', kind, 'btn btn-primary')));
    const at = Math.max(0, g.steps.findIndex((x) => /below/i.test(x)));
    const steps = make('ol', { class: 'steps' }, g.steps.map((x, i) => make('li', { 'data-at': i === at ? '' : null }, make('span', { class: 'step-text' }, x), i === at ? action : null)));
    const connected = !!s.connected;
    const link = make('div', { class: 'link', role: 'status', 'data-state': connected ? 'connected' : 'waiting' },
      make('div', { class: 'link-ends' },
        make('span', { class: 'app-tile weave-tile' }, mark()),
        make('span', { class: 'wire', 'aria-hidden': 'true' }, make('span', { class: 'pulse' }), make('span', { class: 'check' })),
        appTile(g)),
      make('p', { class: 'link-text status', 'data-state': connected ? 'connected' : 'waiting' }, connected ? fill(COPY.agent.connected, { tool: g.name, title }) : fill(COPY.agent.waiting, { tool: g.name })));
    const payoff = make('section', { class: 'payoff', 'data-ready': connected ? '' : null },
      make('h2', {}, COPY.agent.payoffTitle),
      make('p', { class: 'muted' }, fill(COPY.agent.payoffHint, { tool: g.name })),
      make('div', { class: 'copybox stacked' }, make('code', { 'aria-label': 'first message', class: 'message' }, g.message), copyButton(g.message, 'first message', COPY.agent.copyMessage, connected ? 'btn btn-primary' : 'btn')));
    if (connected) queueMicrotask(() => payoff.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
    return [
      make('div', { class: 'chosen' }, appTile(g, ' big'), make('span', { class: 'chosen-text' }, make('b', {}, g.name), make('small', {}, g.where)),
        make('button', { type: 'button', class: 'btn-link', 'data-go': 'change', onclick: () => dispatch({ type: 'back' }) }, COPY.agent.change)),
      errorBox(s.error),
      steps,
      g.note ? make('p', { class: 'muted note' }, g.note) : null,
      link,
      payoff,
      make('div', { class: 'actions' }, skip, make('span', { class: 'grow' }),
        make('button', { type: 'button', class: 'btn btn-primary', 'data-go': 'next', disabled: !connected, onclick: () => dispatch({ type: 'next' }) }, COPY.next)),
    ];
  }

  function done() {
    const open = s.made.open + (s.made.table ? `?table=${encodeURIComponent(s.made.table)}` : '');
    if (s.skipped) queueMicrotask(() => { location.href = open; });
    const trial = make('p', { class: 'muted trial', hidden: true });
    const show = (t) => {
      if (!t || t.daysLeft == null) return;
      trial.textContent = t.daysLeft === 1 ? COPY.trial.leftOne : fill(COPY.trial.left, { n: t.daysLeft });
      trial.hidden = false;
    };
    if (s.made.trial !== undefined) show(s.made.trial);
    else if (!s.skipped) getJson('/api/start').then((fresh) => show((fresh.rows ?? []).find((r) => r.name === s.made.name)?.trial)).catch(() => {});
    return [
      make('h1', {}, fill(COPY.done.title, { title: s.made.title ?? s.made.name })),
      make('p', { class: 'lead' }, s.connected ? COPY.done.withAgent : fill(COPY.done.withoutAgent, { mcp: s.made.mcp })),
      make('a', { class: 'btn btn-primary btn-wide', href: open, 'data-go': 'open' }, COPY.done.open),
      trial,
    ];
  }

  const VIEWS = { account, list, closed, workspace, work, build, agent, done };

  function render() {
    clearInterval(poll);
    poll = null;
    if (onResize) removeEventListener('resize', onResize);
    onResize = null;
    main.dataset.step = s.step;
    main.replaceChildren(...VIEWS[s.step]().filter(Boolean));
    if (s.step !== 'build') donut(progress(s));
    else if (!main.querySelector('.checklist [data-done]')) donut(progress(s), fill(COPY.steps.building, { title: workspaceTitle() }));
    if (s.step === 'agent' && s.data.tool && !s.connected) {
      const slug = encodeURIComponent(s.made.name);
      poll = setInterval(async () => {
        try {
          const seen = await getJson(`/api/start/workspaces/${slug}/agent`);
          if (seen.connected) dispatch({ type: 'connected', at: seen.at });
        } catch {}
      }, 2000);
    }
  }

  async function boot() {
    const q = Object.fromEntries(new URLSearchParams(location.search));
    try { me = await getJson('/api/start'); } catch (err) { main.textContent = err.message; return; }
    s = begin(me, q);
    if (location.search) history.replaceState(null, '', '/start');
    render();
  }

  stage.replaceChildren(radiate());
  boot();
})();
