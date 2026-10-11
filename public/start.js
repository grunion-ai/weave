(function () {
  const { COPY, fill } = globalThis.WeaveSlugs;
  const main = document.getElementById('start');
  const make = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  const getJson = async (path, init) => {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? String(res.status)), { code: data.code });
    return data;
  };

  const ROW = {
    workspace: (r, several) => make('li', {}, make('a', { href: r.open }, r.title, r.title !== r.name ? make('small', {}, r.name) : null, several ? make('small', {}, r.login) : null)),
    invite: (r, several) => make('li', { class: 'invite' },
      make('span', {}, r.title, make('small', {}, fill(COPY.start.inviteLead, { role: r.role }) + (several ? ` · ${r.login}` : ''))),
      make('button', { type: 'button', class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const done = await getJson(r.accept, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          location.href = done.open;
        } catch (err) { e.target.disabled = false; alert(err.message); }
      } }, COPY.start.accept)),
  };

  function createForm(me) {
    const form = make('form', { class: 'card' });
    const slugs = WeaveSlugForm.mount({
      accountName: me.accountName,
      base: me.base,
      check: (slug) => getJson(`/api/start/slug?slug=${encodeURIComponent(slug)}`),
    });
    const submit = make('button', { type: 'submit', class: 'btn btn-primary' });
    const back = make('button', { type: 'button', class: 'btn', onclick: () => render(me) }, COPY.start.listTitle);
    form.append(slugs.node, make('div', { class: 'actions' }, back, submit));
    slugs.bindSubmit(submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const made = await getJson('/api/start/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slugs.value()) });
        location.href = made.open;
      } catch (err) {
        if (!slugs.refused(err.code)) alert(err.message);
      }
    });
    main.replaceChildren(make('h1', {}, COPY.start.create), form);
    slugs.nameInput.focus();
  }

  function render(me) {
    if (!me.signedIn) {
      main.replaceChildren(make('h1', {}, COPY.start.title),
        make('a', { class: 'btn btn-primary', href: '/api/auth/oidc/start?start=1' }, fill(COPY.start.signIn, { provider: me.provider })));
      return;
    }
    const several = (me.logins ?? []).length > 1;
    const rows = me.rows.map((r) => ROW[r.kind]?.(r, several)).filter(Boolean);
    const signOut = make('button', { type: 'button', class: 'btn-link', onclick: async () => {
      await getJson('/api/start/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      render(await getJson('/api/start'));
    } }, COPY.start.signOut);
    main.replaceChildren(...[
      make('h1', {}, COPY.start.listTitle),
      make('div', { class: 'card' }, rows.length ? make('ul', { class: 'rows' }, ...rows) : make('p', { class: 'muted' }, COPY.start.empty)),
      me.canCreate ? make('div', { class: 'actions' }, make('button', { type: 'button', class: 'btn btn-primary', onclick: () => createForm(me) }, COPY.start.create)) : null,
      make('div', { class: 'foot' }, make('a', { href: '/api/auth/oidc/start?start=1&fresh=1' }, COPY.start.addLogin), ' · ', signOut),
    ].filter(Boolean));
  }

  getJson('/api/start').then(render).catch((err) => { main.textContent = err.message; });
})();
