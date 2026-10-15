(function () {
  const { COPY: SLUG, fill } = globalThis.WeaveSlugs;
  const { begin, reduce, railState } = globalThis.WeaveSetup;
  const { TEMPLATES } = globalThis.WeaveStarters;
  const { TOOLS, guide } = globalThis.WeaveAgentConnect;
  const main = document.getElementById('start');
  const stage = document.getElementById('stage');
  const rail = document.getElementById('rail');
  const NS = 'http://www.w3.org/2000/svg';

  const COPY = {
    account: {
      title: 'Your weave account',
      lead: 'One account opens every workspace you make or join. New and returning people use the same button.',
      go: 'Sign up or sign in',
      bypass: 'Skip the guided setup and start an empty workspace',
    },
    list: { title: 'Your workspaces', empty: 'This sign-in has no workspaces yet.', create: 'Create a workspace', limit: 'This sign-in has reached the server\'s workspace limit. Open one of the workspaces above.' },
    closed: { title: 'This server is invite only', lead: 'Ask the owner of a workspace for an invite link. Opening it adds you to their workspace.' },
    workspace: { title: 'Workspace name and address', lead: 'The name is what people see. The address is the link that opens the workspace.' },
    work: {
      title: 'What kind of work will you track?',
      lead: 'weave sets up a template for it, with tables and a few sample rows. You can change all of it later.',
      other: 'Something else',
      otherBlurb: 'Describe it, and your AI app builds the tables',
      otherLabel: 'What will you track?',
      otherPlaceholder: 'Dog adoptions, with families, dogs and visits',
    },
    build: { title: 'Setting up {title}', claim: 'Claim {address}', table: 'Create {table}', rows: 'Add sample rows', door: 'Allow your AI app in', empty: 'Start an empty workspace' },
    agent: {
      title: 'AI app connection',
      lead: 'An AI app can read and update your records in weave. Pick yours and follow its steps.',
      chat: 'Chat apps',
      tools: 'Editors and terminals',
      copyLabel: '{kind} for {tool}',
      messageLabel: 'Then paste this into a new chat:',
      install: 'Add to {tool}',
      waiting: 'Waiting for {tool} to connect. This page updates on its own.',
      connected: '{tool} is connected to {title}.',
      another: 'Pick another app',
      skip: 'Skip this step',
    },
    done: { title: '{title} is ready', withAgent: 'Your AI app is connected. Open the workspace, then ask your AI app for a tour.', withoutAgent: 'To connect an AI app later, add this connection address to it: {mcp}', open: 'Open workspace' },
    stage: { big: 'Own your work.', lines: ['Tables, documents and links between them, in one workspace.', 'Your AI app reads and updates the same records you do.', 'Export everything, any time. Open source, MIT licensed.'] },
    errors: {
      signin_failed: 'Sign-in did not finish. Try again, or use a different account.',
      signin_unverified: 'weave could not verify that sign-in. Try again.',
      provider_down: '{provider} is not answering. Try again in a minute.',
      template_failed: 'The {template} template did not build, so your workspace starts empty. Your AI app can build the tables in the next step.',
      build_failed: 'Setup did not finish. Try again, or skip setup to start an empty workspace.',
      network: 'Setup did not finish because weave did not answer. Try again.',
    },
    copy: 'Copy', copied: 'Copied', back: 'Back', next: 'Continue', skip: 'Skip setup', signOut: 'Sign out', addLogin: 'Add another sign-in', accept: SLUG.start.accept,
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
  const icon = (name) => make('img', { src: `/vendor/icons/${String(name).replace(/^lucide:/, '')}.svg`, alt: '' });
  const getJson = async (path, init) => {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? String(res.status)), { code: data.code ?? (res.status >= 500 ? 'build_failed' : null) });
    return data;
  };
  const post = (path, body) => getJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ropeD(x0, y, n, P, A, from = 0, to = n) {
    const yA = (i) => (i % 2 ? y + A : y - A);
    let d = `M${x0 + from * P},${yA(from)}`;
    for (let i = from; i < to; i++) d += ` C${x0 + i * P + P / 2},${yA(i)} ${x0 + i * P + P / 2},${yA(i + 1)} ${x0 + (i + 1) * P},${yA(i + 1)}`;
    return d;
  }
  const mirror = (d, y) => d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (all, x, yy) => `${x},${2 * y - Number(yy)}`);

  function rope(target, { x0, y, n, P = 8, A = 4, at = 0, dur = 0, halo = null }) {
    const timed = (start, len) => (dur ? `--at:${Math.round(start)}ms;--dur:${Math.round(len)}ms` : null);
    const a = ropeD(x0, y, n, P, A);
    target.append(svg('path', { class: 'strand a', d: a, pathLength: 1, style: timed(at, dur) }), svg('path', { class: 'strand b', d: mirror(a, y), pathLength: 1, style: timed(at, dur) }));
    for (let k = 0; k < n; k++) {
      const seg = ropeD(x0, y, n, P, A, k, k + 1);
      const over = k % 2 ? 'a' : 'b';
      const d = over === 'a' ? seg : mirror(seg, y);
      const t = dur ? `--at:${Math.round(at + (dur * (k + 0.5)) / n)}ms` : null;
      target.append(svg('path', { class: 'strand cross halo', d, pathLength: 1, style: [t, halo ? `stroke:${halo}` : null].filter(Boolean).join(';') || null }), svg('path', { class: `strand cross ${over}`, d, pathLength: 1, style: t }));
    }
  }

  function loom(rows, { weaving = false, waiting = false, step = 650, title = null } = {}) {
    const height = Math.max(1, rows.length) * 56 + 16;
    const box = svg('svg', { class: `loom${weaving ? ' weaving' : ''}${waiting ? ' waiting' : ''}`, viewBox: `0 0 620 ${height}`, role: 'img', 'aria-label': title ?? rows.map((r) => r.label).join(', ') });
    rows.forEach((r, i) => {
      const y = 36 + i * 56;
      const at = i * step;
      if (r.label) box.append(svg('text', { x: 0, y: y + 4, class: r.on ? 'on' : null }, r.label));
      const g = svg('g', { transform: `translate(${r.label ? 168 : 0},0)` });
      const n = r.n ?? 10;
      rope(g, { x0: 0, y, n, P: (r.label ? 440 : 620) / n, A: 9, at, dur: weaving ? step : 0 });
      box.append(g);
      if (r.tick) box.append(svg('circle', { class: 'tick', cx: 612, cy: y, r: 5, fill: 'var(--ok)', style: weaving ? `--at:${at + step}ms` : null }));
    });
    return box;
  }

  const say = () => make('div', { class: 'say' },
    make('p', { class: 'big' }, COPY.stage.big),
    make('ul', {}, COPY.stage.lines.map((l) => make('li', {}, l))));

  let s = null;
  let me = null;
  let poll = null;
  let building = false;

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

  const signInHref = (next) => `/api/auth/oidc/start?start=1&next=${encodeURIComponent(next)}`;

  function account() {
    return [
      make('h1', {}, COPY.account.title),
      make('p', { class: 'lead' }, COPY.account.lead),
      errorBox(s.error),
      make('a', { class: 'btn btn-primary btn-wide', href: signInHref('/start'), 'data-go': 'signin' }, COPY.account.go),
      make('p', { class: 'muted', style: 'margin-top:18px' }, make('a', { class: 'btn-link', href: signInHref('/start?setup=skip'), 'data-go': 'bypass' }, COPY.account.bypass)),
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
      rows.length ? make('ul', { class: 'rows' }, rows) : make('p', { class: 'muted' }, COPY.list.empty),
      me.canCreate ? make('div', { class: 'actions' }, make('button', { type: 'button', class: 'btn btn-primary', 'data-go': 'new', onclick: () => dispatch({ type: 'new' }) }, COPY.list.create))
        : me.openSignup ? make('p', { class: 'muted' }, COPY.list.limit) : null,
      foot(),
    ];
  }

  function closed() {
    return [make('h1', {}, COPY.closed.title), make('p', { class: 'lead' }, COPY.closed.lead), errorBox(s.error), foot()];
  }

  function workspace() {
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
    return [make('h1', {}, COPY.workspace.title), make('p', { class: 'lead' }, COPY.workspace.lead), s.error && !/^slug_/.test(s.error.code) ? errorBox(s.error) : null, form];
  }

  let choice = null;
  function work() {
    choice = s.data.other ? 'other' : s.data.template ?? choice;
    const other = make('textarea', { class: 'form-control', rows: 2, id: 'work-other', placeholder: COPY.work.otherPlaceholder, hidden: choice !== 'other' });
    other.value = s.data.other ?? '';
    const otherLabel = make('label', { class: 'form-label', for: 'work-other', hidden: choice !== 'other' }, COPY.work.otherLabel);
    const go = make('button', { type: 'button', class: 'btn btn-primary', 'data-go': 'next', disabled: !choice, onclick: () => {
      if (choice === 'other' && !other.value.trim()) { other.focus(); other.setAttribute('aria-invalid', 'true'); return; }
      dispatch({ type: 'next', template: choice === 'other' ? null : choice, other: choice === 'other' ? other.value.trim() : '' });
    } }, COPY.next);
    const picks = make('div', { class: 'picks', role: 'group', 'aria-label': COPY.work.title });
    const pick = (id, iconName, title, blurb) => make('button', { type: 'button', class: 'pick', 'data-template': id, 'aria-pressed': String(choice === id), onclick: () => {
      choice = id;
      for (const b of picks.children) b.setAttribute('aria-pressed', String(b.dataset.template === id));
      other.hidden = otherLabel.hidden = id !== 'other';
      if (id === 'other') other.focus();
      go.disabled = false;
      paintStage();
    } }, icon(iconName), make('span', {}, make('b', {}, title), make('small', {}, blurb)));
    for (const t of TEMPLATES) picks.append(pick(t.id, t.icon, t.work ?? t.title, t.blurb));
    picks.append(pick('other', 'lucide:pencil', COPY.work.other, COPY.work.otherBlurb));
    return [
      make('h1', {}, COPY.work.title), make('p', { class: 'lead' }, COPY.work.lead), errorBox(s.error), picks, otherLabel, other,
      make('div', { class: 'actions' },
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
  function buildList() {
    const t = chosen();
    const tables = t ? globalThis.WeaveStarters.spec(t).spaces[0].tables.map((x) => x.name) : [];
    return [fill(COPY.build.claim, { address: address() }), ...(t ? tables.map((table) => fill(COPY.build.table, { table })) : [COPY.build.empty]), ...(t ? [COPY.build.rows] : []), COPY.build.door];
  }

  function build() {
    const items = buildList();
    const list = make('ul', { class: 'checklist', 'aria-live': 'polite' }, items.map((label) => make('li', {}, label)));
    if (!building) run(items, list);
    return [make('h1', {}, fill(COPY.build.title, { title: s.data.name || me.accountName || 'your workspace' })), list];
  }

  async function run(items, list) {
    building = true;
    const t = chosen();
    const body = s.skipped && !s.data.slug ? { quick: true } : { name: s.data.name, slug: s.data.slug, ...(t ? { template: t.id } : {}) };
    const step = reduced() ? 0 : 650;
    const lasting = wait(items.length * step + 300);
    items.forEach((_, i) => setTimeout(() => list.children[i]?.setAttribute('data-done', ''), (i + 1) * step));
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

  function agent() {
    const title = s.made?.title ?? s.data.name;
    const g = s.data.tool ? guide(s.data.tool, { url: s.made.mcp, workspace: title, template: chosen()?.work ?? chosen()?.title ?? null, other: s.data.other }) : null;
    const lead = [make('h1', {}, COPY.agent.title), make('p', { class: 'lead' }, COPY.agent.lead), errorBox(s.error)];
    const skip = make('button', { type: 'button', class: 'btn-link', 'data-go': 'skip', onclick: () => dispatch({ type: 'skip' }) }, COPY.agent.skip);
    if (!g) {
      const group = (kinds) => make('div', { class: 'picks' }, TOOLS.filter((t) => kinds.includes(t.kind)).map((t) => make('button', { type: 'button', class: 'pick', 'data-tool': t.id, onclick: () => dispatch({ type: 'tool', tool: t.id }) },
        icon(t.icon), make('span', {}, make('b', {}, t.name), make('small', {}, t.where)))));
      return [...lead, make('h2', {}, COPY.agent.chat), group(['chat']), make('h2', {}, COPY.agent.tools), group(['editor', 'terminal', 'other']),
        make('div', { class: 'actions' }, make('span', { class: 'grow' }), skip)];
    }
    const copyBox = (value, label, tag = 'code') => make('div', { class: 'copybox' }, make(tag, { 'aria-label': label, class: label === 'first message' ? 'message' : null }, value),
      make('button', { type: 'button', class: 'btn', 'data-copy': label, onclick: async (ev) => {
        const b = ev.currentTarget;
        try { await navigator.clipboard.writeText(value); } catch { const r = document.createRange(); r.selectNodeContents(b.previousSibling); getSelection().removeAllRanges(); getSelection().addRange(r); }
        b.textContent = COPY.copied;
        setTimeout(() => { b.textContent = COPY.copy; }, 1600);
      } }, COPY.copy));
    const status = make('div', { class: 'status', role: 'status', 'data-state': s.connected ? 'connected' : 'waiting' }, make('span', { class: 'dot' }),
      s.connected ? fill(COPY.agent.connected, { tool: g.name, title }) : fill(COPY.agent.waiting, { tool: g.name }));
    return [
      ...lead,
      make('div', { class: 'tool-head' }, make('span', { class: 'tool-icon' }, icon(g.icon)), make('b', {}, g.name), make('span', { class: 'muted' }, g.where)),
      make('ol', { class: 'steps' }, g.steps.map((x) => make('li', {}, x))),
      make('div', { class: 'form-hint' }, fill(COPY.agent.copyLabel, { tool: g.name, kind: g.copy === 'command' ? 'Command' : g.copy === 'url' ? 'Connection address' : 'Setting' })),
      copyBox(g.value, 'address', g.copy === 'url' || g.copy === 'command' ? 'code' : 'pre'),
      g.install ? make('p', {}, make('a', { class: 'btn', href: g.install, 'data-go': 'install' }, fill(COPY.agent.install, { tool: g.name }))) : null,
      g.note ? make('p', { class: 'muted' }, g.note) : null,
      make('div', { class: 'form-hint' }, COPY.agent.messageLabel),
      copyBox(g.message, 'first message'),
      status,
      make('div', { class: 'actions' },
        make('button', { type: 'button', class: 'btn', onclick: () => dispatch({ type: 'back' }) }, COPY.agent.another),
        skip, make('span', { class: 'grow' }),
        make('button', { type: 'button', class: 'btn btn-primary', 'data-go': 'next', disabled: !s.connected, onclick: () => dispatch({ type: 'next' }) }, COPY.next)),
    ];
  }

  function done() {
    const open = s.made.open + (s.made.table ? `?table=${encodeURIComponent(s.made.table)}` : '');
    if (s.skipped) queueMicrotask(() => { location.href = open; });
    return [
      make('h1', {}, fill(COPY.done.title, { title: s.made.title ?? s.made.name })),
      make('p', { class: 'lead' }, s.connected ? COPY.done.withAgent : fill(COPY.done.withoutAgent, { mcp: s.made.mcp })),
      make('a', { class: 'btn btn-primary btn-wide', href: open, 'data-go': 'open' }, COPY.done.open),
    ];
  }

  const VIEWS = { account, list, closed, workspace, work, build, agent, done };

  function paintStage() {
    const rows = (labels, extra = {}) => labels.map((label, i) => ({ label, n: 10, tick: !!extra.tick, on: extra.on?.(i) }));
    let art;
    if (s.step === 'build') art = loom(rows(buildList(), { tick: true }), { weaving: !reduced(), step: 650 });
    else if (s.step === 'agent' || s.step === 'done') {
      const tool = TOOLS.find((t) => t.id === s.data.tool)?.name;
      art = loom([{ label: tool ? `weave and ${tool}` : 'weave and your AI app', n: 12, tick: !!s.connected }], { waiting: !!tool && !s.connected });
    } else if (s.step === 'work' && choice && choice !== 'other') {
      const t = TEMPLATES.find((x) => x.id === choice);
      art = loom(rows(globalThis.WeaveStarters.spec(t).spaces[0].tables.map((x) => x.name)), { weaving: !reduced(), step: 220, title: t.work ?? t.title });
    } else art = loom([{ n: 12 }, { n: 12 }, { n: 12 }], { title: 'weave' });
    stage.replaceChildren(...[art, ['build', 'agent', 'done'].includes(s.step) ? null : say()].filter(Boolean));
    stage.dataset.step = s.step;
  }

  function render() {
    clearInterval(poll);
    poll = null;
    const managed = ['account', 'workspace', 'work', 'build', 'agent', 'done'].includes(s.step);
    rail.hidden = !managed;
    rail.replaceChildren(...railState(s).map((r) => make('li', { 'data-state': r.state, 'aria-current': r.state === 'on' ? 'step' : null }, r.label)));
    main.dataset.step = s.step;
    main.replaceChildren(...VIEWS[s.step]().filter(Boolean));
    paintStage();
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

  rope(document.getElementById('brand-mark'), { x0: 12, y: 24, n: 3, P: 8, A: 4, halo: 'var(--panel)' });
  boot();
})();
