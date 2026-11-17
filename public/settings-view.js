'use strict';
function trashKind(item) {
  const system = allTables().find((d) => d.id === item.dbId)?.system;
  if (system === 'spaces') return 'Space';
  if (system === 'tables') return item.fields?.Space?.name ? `Table in ${item.fields.Space.name}` : 'Table';
  return `Record in ${item.db}`;
}

async function showTrash(dbId) {
  const db = dbId ? allTables().find((d) => d.id === dbId) : null;
  if (dbId && !db) return showHome();
  state.route = { page: 'trash', dbId };
  renderNav();
  let { items, views = [], purge = false } = await api('GET', db ? `/tables/${db.id}/trash` : '/trash');
  if (!db) items = items.filter((i) => allTables().find((d) => d.id === i.dbId)?.system !== 'views');
  const main = $('#main');
  main.replaceChildren();
  main.append(viewHeader({
    crumbs: [
      { label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() },
      ...(db ? [{ label: db.space, href: `#/space/${db.spaceId}` }, { label: db.name, href: `#/table/${db.id}` }] : []),
    ],
    permalink: `${location.origin}${WS_PREFIX}/#/trash${db ? `/${db.id}` : ''}`,
    title: db ? `${db.name} — trash` : 'Trash',
  }));

  if (!items.length && !views.length) {
    main.append(el('div', { class: 'card panel empty-note' }, 'Nothing in the trash.'));
    return;
  }
  const rows = el('tbody');
  const span = db ? 4 : 5;
  const purgeButton = (tr, name, path) => (purge ? el('button', {
    class: 'btn btn-sm btn-outline-danger purge-open', type: 'button',
    onclick: confirmToggle(tr, () => {
      const { box, input } = typedHold(name, 'This cannot be undone.', {
        label: 'Delete forever', hold: true, holdingLabel: 'Hold to purge…',
        run: async () => {
          try {
            await api('DELETE', `${path}?hard=1`);
            toast(`${name} deleted forever`);
            await loadSchema();
            showTrash(dbId);
          } catch (err) { toast(err.message, true); }
        },
      });
      return { node: el('tr', {}, el('td', { colspan: span }, box)), input };
    }),
  }, 'Delete forever…') : null);
  for (const item of items) {
    const name = item.name || `#${item.publicId}`;
    const tr = el('tr', { class: 'purge-row' },
      el('td', { class: 'pid-cell' }, `#${item.publicId}`),
      el('td', {}, item.name || el('span', { class: 'view-desc-empty' }, 'Untitled')),
      ...(db ? [] : [el('td', { class: 'trash-table' }, trashKind(item))]),
      el('td', { class: 'trash-when' }, whenEl(item.deletedAt)),
      el('td', { class: 'trash-acts' }));
    tr.lastChild.append(el('button', {
      class: 'btn btn-sm', type: 'button',
      onclick: async () => {
        try {
          await api('POST', `/entities/${item.id}/restore`);
          toast('Restored');
          await loadSchema();
          showTrash(dbId);
        } catch (err) { toast(err.message, true); }
      },
    }, 'Restore'), purgeButton(tr, name, `/entities/${item.id}`) ?? '');
    rows.append(tr);
  }
  for (const v of views) {
    const act = (run, done) => async () => {
      try {
        await run();
        toast(done);
        showTrash(dbId);
      } catch (err) { toast(err.message, true); }
    };
    const tr = el('tr', { class: 'purge-row' },
      el('td', { class: 'pid-cell' }),
      el('td', {}, v.name),
      el('td', { class: 'trash-table' }, 'Share page'),
      el('td', { class: 'trash-when' }, whenEl(v.deletedAt)),
      el('td', { class: 'trash-acts' }));
    tr.lastChild.append(el('button', { class: 'btn btn-sm', type: 'button', onclick: act(() => api('POST', `/views/${v.id}/restore`), 'Restored') }, 'Restore'), purgeButton(tr, v.name, `/views/${v.id}`) ?? '');
    rows.append(tr);
  }
  if (items.length || views.length) main.append(el('div', { class: 'card table-wrap trash-list' },
    el('table', { class: 'table table-sm table-vcenter card-table wv-grid' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'pid-head' }, '#'), el('th', {}, 'Name'),
        ...(db ? [] : [el('th', {}, 'Type')]),
        el('th', {}, 'Deleted'), el('th', {}, ''))),
      rows)));
}

function typedHold(name, prompt, row) {
  const hold = menuRow(row, () => {});
  hold.setAttribute('role', 'button');
  hold.removeAttribute('tabindex');
  hold.disabled = true;
  const input = el('input', {
    class: 'form-control form-control-sm purge-name', autocomplete: 'off', spellcheck: 'false',
    placeholder: name, 'aria-label': `Type ${name} to confirm`,
  });
  input.addEventListener('input', () => { hold.disabled = input.value !== name; });
  const box = el('div', { class: 'purge-confirm-box' },
    el('span', { class: 'text-secondary' }, `${prompt} Type `, el('code', {}, name), ' to confirm.'), input, hold);
  return { box, input };
}

function confirmToggle(after, build) {
  return () => {
    const was = !!after.nextElementSibling?.classList.contains('purge-confirm');
    for (const shut of document.querySelectorAll('#main .purge-confirm')) shut.remove();
    if (was) return;
    const { node, input } = build();
    node.classList.add('purge-confirm');
    after.after(node);
    input.focus();
  };
}

function hrefAfterDelete(order, gone) {
  const at = order.findIndex((x) => x.name === gone.name);
  const open = (x) => x.name !== gone.name && x.name !== 'weave' && !x.held && !x.deletedAt;
  const next = order.slice(at + 1).find(open) ?? order.slice(0, Math.max(at, 0)).reverse().find(open) ?? order.find((x) => x.name === 'weave');
  return next ? wsHref(next) : '/';
}

function deleteWorkspaceDialog(w, after = null) {
  const input = el('input', {
    class: 'form-control', name: 'confirm', autocomplete: 'off', spellcheck: 'false',
    placeholder: w.name, 'aria-label': `Type ${w.name} to confirm`,
  });
  let held = false;
  modal('Delete workspace', [
    el('p', {}, 'This permanently deletes ', el('strong', {}, w.name),
      ` with its ${w.tables ?? 0} tables and ${w.entities ?? 0} entities. It cannot be undone.`),
    el('label', { class: 'form-label' }, 'Type ', el('code', {}, w.name), ' to confirm, then hold Delete workspace'),
    input,
  ], async () => {
    const armed = held;
    held = false;
    if (!armed || input.value !== w.name) throw Object.assign(new Error('Hold Delete workspace to confirm'), { shown: true });
    const order = state.wsList ?? [];
    await api('DELETE', `/workspaces/${w.id}`);
    if (w.name === state.wsCurrent) { location.href = hrefAfterDelete(order, w); return; }
    toast(`Workspace ${w.name} deleted`);
    buildWsRail();
    if (state.route?.page === 'settings') showSettings();
    else after?.();
  }, 'Delete workspace', 'btn-danger');
  const submit = $('#modal button[type="submit"]');
  const form = submit.form;
  const go = holdToConfirm('Delete workspace', () => { held = true; form.requestSubmit(); },
    { rowClass: 'btn btn-danger ws-delete-go', holdingLabel: 'Hold to delete…' });
  go.classList.remove('text-danger');
  go.disabled = true;
  submit.replaceWith(go);
  input.addEventListener('input', () => { go.disabled = input.value !== w.name; });
}

async function showSettings() {
  state.route = { page: 'settings' };
  renderNav();
  const [list, ws, me] = await Promise.all([api('GET', '/workspaces').catch(() => []), api('GET', '/workspace').catch(() => null), accountNow().catch(() => null)]);
  if (state.route?.page !== 'settings') return;
  const main = $('#main');
  const header = viewHeader({
    crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }],
    permalink: `${location.origin}${WS_PREFIX}/#/settings`,
    title: 'Settings',
  });
  const pages = [
    { id: 'preferences', label: 'Preferences', icon: 'sliders-horizontal', body: () => preferencesPage() },
    { id: 'workspace', label: 'Workspace', icon: 'layout-grid', body: () => workspacePage(ws, list) },
  ];
  if (me?.clerk && await settingsInClerk(main, header, me.clerk, pages)) return;
  clerkSettings = null;
  main.replaceChildren(header, settingsShell(pages));
}

function settingsShell(pages) {
  let current = pages.find((p) => p.id === settingsShell.last) ?? pages[0];
  const body = el('section', { class: 'settings-page', role: 'tabpanel' });
  const tabs = pages.map((p) => el('button', {
    type: 'button', class: 'settings-tab', role: 'tab', 'data-page': p.id,
    onclick: () => { current = p; settingsShell.last = p.id; draw(); },
  }, lucideEl(p.icon, 'wv-icon'), el('span', {}, p.label)));
  const draw = () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.page === current.id)));
    body.replaceChildren(el('h2', { class: 'settings-page-title' }, current.label), ...current.body());
  };
  draw();
  return el('div', { class: 'settings-shell' },
    el('nav', { class: 'settings-nav', role: 'tablist', 'aria-label': 'Settings' }, ...tabs),
    body);
}

function settingsSection(label, hint, ...controls) {
  return el('div', { class: 'settings-sec' },
    el('div', { class: 'settings-sec-label' }, el('span', {}, label), hint ? el('small', {}, hint) : null),
    el('div', { class: 'settings-sec-body' }, ...controls));
}

function prefSelect(name, title, options, value, after = () => {}) {
  const pick = pickerSelect({ name, options: options.map((o) => ({ id: String(o.id), label: o.label })), value: String(value), title });
  pick.classList.add('settings-select');
  pick.input.addEventListener('change', () => {
    if (!WeavePrefs.setPersonal(name, pick.input.value)) return toast('This browser does not keep preferences', true);
    after(pick.input.value);
  });
  return pick;
}

function prefSegments(name, options, value, after = () => {}) {
  const seg = el('div', { class: 'settings-seg', role: 'radiogroup' });
  const mark = (id) => [...seg.children].forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === String(id))));
  seg.append(...options.map((o) => el('button', {
    type: 'button', role: 'radio', 'data-id': String(o.id),
    onclick: () => {
      if (!WeavePrefs.setPersonal(name, o.id)) return toast('This browser does not keep preferences', true);
      mark(o.id);
      after(o.id);
    },
  }, o.label)));
  mark(value);
  return seg;
}

const DATE_STYLES = [['long', 'Long'], ['us', 'US'], ['eu', 'European'], ['iso', 'ISO']];
function preferencesPage() {
  const p = WeavePrefs.personal();
  const sample = (format) => weaveDateGrain.formatDate('2026-03-09', { format });
  return [
    settingsSection('Appearance', 'Auto follows your system setting.',
      prefSegments('theme', [{ id: 'auto', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], p.theme, () => applyTheme())),
    settingsSection('Week starts on', 'Calendars and date pickers open on this day.',
      prefSelect('weekStart', 'Week starts on', [{ id: 0, label: 'Sunday' }, { id: 1, label: 'Monday' }], p.weekStart)),
    settingsSection('Date format', 'For date fields that do not set their own.',
      prefSelect('dateFormat', 'Date format', DATE_STYLES.map(([id, label]) => ({ id, label: `${label} · ${sample(id)}` })), p.dateFormat, applyPersonalPrefs)),
    settingsSection('Time format', 'For times in fields that do not set their own.',
      prefSegments('clock', [{ id: '12h', label: '12-hour' }, { id: '24h', label: '24-hour' }], p.clock, applyPersonalPrefs)),
    settingsSection('Start page', 'Where a workspace opens from a bookmark or a typed address.',
      prefSelect('startPage', 'Start page', [{ id: 'last', label: 'Last page visited' }, { id: 'home', label: 'Workspace home' }], p.startPage)),
  ];
}

function workspacePage(ws, list) {
  const out = [];
  if (typeof ws?.linkPreview === 'boolean') {
    out.push(settingsSection('Link preview', 'A record link pasted into Slack, Messages or email shows its title, path and first fields before anyone signs in. Documents, other fields and the API stay behind sign-in.',
      paneSwitch({
        label: 'Show before sign-in', on: ws.linkPreview,
        onChange: async (on) => {
          const now = await setLinkPreview(on);
          if (now !== on) showSettings();
        },
      })));
  }
  const deletable = list.filter((w) => w.deletable);
  if (deletable.length) {
    out.push(settingsSection('Delete a workspace', 'Permanent: it leaves the rail for everyone, its links stop working, and it cannot be undone.',
      ...deletable.map((w) => el('div', { class: 'settings-ws-row' },
        el('span', { class: 'list-row-name' }, w.name),
        el('span', { class: 'text-secondary' }, `${w.tables ?? 0} tables, ${w.entities ?? 0} entities`),
        el('button', { class: 'btn btn-sm btn-outline-danger ws-delete-open', type: 'button', onclick: () => deleteWorkspaceDialog(w) }, 'Delete…')))));
  }
  if (!out.length) out.push(el('p', { class: 'settings-empty' }, 'Nothing here to change for this workspace.'));
  return out;
}

let clerkSettings = null;
const clerkAppearance = () => {
  const v = (name, fallback) => `var(${name}${fallback ? `, ${fallback}` : ''})`;
  return {
    variables: {
      colorPrimary: v('--tblr-primary'), colorPrimaryForeground: v('--tblr-primary-fg', '#ffffff'), colorDanger: v('--tblr-danger'),
      colorBackground: v('--tblr-bg-surface'), colorForeground: v('--tblr-body-color'), colorMutedForeground: v('--tblr-secondary'),
      colorNeutral: v('--tblr-body-color'), colorBorder: v('--tblr-border-color'), colorInput: v('--tblr-bg-surface'), colorInputForeground: v('--tblr-body-color'),
      fontFamily: v('--tblr-font-sans-serif'), borderRadius: '8px',
    },
    elements: { rootBox: { width: '100%' }, cardBox: { width: '100%', maxWidth: '100%', boxShadow: 'none', border: '1px solid var(--tblr-border-color)' } },
  };
};
const loadClerk = (pane) => (loadClerk.p ??= (async () => {
  const origin = new URL(pane.script).origin;
  const inject = (src, data = {}) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    Object.assign(s, { src, async: true, crossOrigin: 'anonymous', onload: resolve, onerror: () => reject(new Error(`${src} did not load`)) });
    Object.assign(s.dataset, data);
    document.head.append(s);
  });
  await Promise.all([inject(pane.script, { clerkPublishableKey: pane.publishableKey }), inject(`${origin}/npm/@clerk/ui@1/dist/ui.browser.js`)]);
  await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  return window.Clerk;
})().catch((err) => { loadClerk.p = null; throw err; }));

async function settingsInClerk(main, header, pane, pages) {
  const fill = () => pages.forEach((p) => clerkSettings.holders[p.id].replaceChildren(...p.body()));
  if (clerkSettings) {
    main.replaceChildren(header, clerkSettings.root);
    fill();
    return true;
  }
  let clerk;
  try { clerk = await loadClerk(pane); } catch { return false; }
  if (state.route?.page !== 'settings') return true;
  if (!clerk?.user) return false;
  clerkSettings = { root: el('div', { class: 'settings-clerk' }), holders: Object.fromEntries(pages.map((p) => [p.id, el('div', { class: 'settings-page settings-clerk-page' })])) };
  fill();
  main.replaceChildren(header, clerkSettings.root);
  clerk.mountUserProfile(clerkSettings.root, {
    routing: 'virtual',
    appearance: clerkAppearance(),
    customPages: pages.map((p) => ({
      url: p.id, label: p.label,
      mountIcon: (n) => n.replaceChildren(lucideEl(p.icon, 'wv-icon')), unmountIcon: (n) => n.replaceChildren(),
      mount: (n) => n.replaceChildren(clerkSettings.holders[p.id]), unmount: (n) => n.replaceChildren(),
    })),
  });
  return true;
}
