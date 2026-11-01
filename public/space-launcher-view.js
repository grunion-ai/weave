'use strict';

const LAUNCHER_SHOWN = 2;

function launcherRow({ lead = null, name, sub = null, outcome = null, at = null, href = null, onclick = null }) {
  const when = weaveDateCore.relativeOrShort(at);
  const body = [
    lead,
    el('span', { class: 'launcher-label' },
      el('strong', {}, name),
      sub ? el('small', {}, sub) : null,
      outcome ? el('span', { class: 'launcher-outcome' }, outcome) : null),
    when.text ? el('time', { datetime: new Date(at).toISOString(), title: when.title }, when.text) : null,
    iconEl('lucide:chevron-right', 'wv-icon launcher-chevron'),
  ];
  return href
    ? el('a', { class: 'launcher-row', href }, ...body)
    : el('button', { class: 'launcher-row', type: 'button', onclick }, ...body);
}

function launcherSection({ part, title, note, more, rows }) {
  if (!rows.length) return null;
  const rest = el('div', { class: 'launcher-rest' }, ...rows.slice(LAUNCHER_SHOWN));
  rest.hidden = true;
  const toggle = el('button', {
    class: 'launcher-more', type: 'button', 'aria-expanded': 'false',
    onclick: () => {
      rest.hidden = !rest.hidden;
      toggle.setAttribute('aria-expanded', String(!rest.hidden));
    },
  }, more, iconEl('lucide:chevron-down', 'wv-icon'));
  return el('section', { class: 'launcher-section', dataset: { part } },
    el('div', { class: 'launcher-heading' }, el('h2', {}, title), el('span', {}, note)),
    ...rows.slice(0, LAUNCHER_SHOWN),
    rows.length > LAUNCHER_SHOWN ? [rest, toggle] : null);
}

function launcherTiles(space, tables) {
  if (!tables.length) return null;
  return el('nav', { class: 'launcher-tiles', 'aria-label': `Tables in ${space.space}`, dataset: { part: 'tables' } },
    ...tables.map((t) => el('a', { class: 'launcher-tile', href: `#/table/${t.id}`, title: t.name },
      el('span', { class: 'launcher-tile-icon' }, iconEl(t.icon || 'lucide:table', 'wv-icon')),
      el('strong', {}, t.name),
      el('small', {}, (t.rowCount ?? 0).toLocaleString()))));
}

function launcherSearch(space, tables) {
  if (!tables.length) return null;
  const label = `Find in ${space.space}`;
  const args = { scope: tables.map((t) => t.id), browse: true, placeholder: label };
  lazyScript('/command-palette.js').catch(() => {});
  return el('button', {
    class: 'launcher-search', type: 'button', 'aria-label': label, dataset: { part: 'search' },
    onclick: () => (typeof openCommandK === 'function' ? openCommandK(args) : openPalette(args)),
  }, iconEl('lucide:search', 'wv-icon'), el('span', {}, label));
}

function launcherDetail(main, home, space, { title, meta = null, fill }) {
  const header = main.querySelector(':scope > .view-header');
  const opener = document.activeElement;
  const was = main.scrollTop;
  const back = el('button', { class: 'launcher-return', type: 'button', onclick: () => history.back() },
    iconEl('lucide:arrow-left', 'wv-icon'), `${space.space} home`);
  const body = el('div', { class: 'launcher-detail-body' });
  const detail = el('section', { class: 'launcher-detail', 'aria-live': 'polite' },
    back, el('h2', {}, title), meta ? el('p', { class: 'launcher-detail-meta' }, meta) : null, body);
  const close = () => {
    removeEventListener('popstate', close);
    detail.remove();
    if (!home.isConnected) return;
    home.hidden = false;
    if (header) header.hidden = false;
    main.scrollTop = was;
    opener?.focus?.({ preventScroll: true });
  };
  history.pushState({ ...(history.state ?? {}), wvLauncher: true }, '', location.href);
  addEventListener('popstate', close);
  home.hidden = true;
  if (header) header.hidden = true;
  home.after(detail);
  main.scrollTop = 0;
  back.focus({ preventScroll: true });
  fill(body);
}

function launcherRunDetail(main, home, space, run) {
  const attention = run.outcome === 'attention';
  const when = weaveDateCore.relativeOrShort(run.at).text;
  const changed = run.changedRows ?? [];
  const total = run.changedCount ?? changed.length;
  const { step = null, error = null } = run.failedStep ?? {};
  const failed = [step == null ? null : `Step ${step}`, error].filter(Boolean).join(': ');
  const field = (label, value) => el('div', { class: 'launcher-field' }, el('span', {}, label), el('strong', {}, value));
  launcherDetail(main, home, space, {
    title: run.name,
    meta: [attention ? (total ? 'Partial completion' : 'Failed') : 'Succeeded', when].filter(Boolean).join(' · '),
    fill: (body) => body.append(
      field('Started in', run.originSpace),
      field('Affected space', space.space),
      field('Changed', (run.changedTables ?? []).map((t) => `${t.table} ${t.count.toLocaleString()}`).join(', ') || 'Nothing changed'),
      failed ? field('Failed', failed) : '',
      ...changed.map((row) => launcherRow({ name: row.name, sub: `${row.table} #${row.publicId}`, onclick: () => openEntity(row.id) })),
      total > changed.length ? el('p', { class: 'launcher-detail-meta' }, `${(total - changed.length).toLocaleString()} more changed`) : ''),
  });
}

function launcherAbout(main, home, space, overview) {
  const fill = async (body) => {
    const md = overview.description ?? '';
    const rendered = main.querySelector(':scope > .view-header .view-desc-body');
    if (md.trim()) body.append(el('div', { class: 'wv-prose' }, ...(rendered ? rendered.cloneNode(true).childNodes : [md])));
    const [tiles, map] = await Promise.all([
      spaceStatTiles(space).catch(() => null),
      relationMapCard('Relations', { spaceId: space.spaceId }).catch(() => null),
    ]);
    if (tiles) body.append(tiles);
    if (map) body.append(map);
  };
  launcherDetail(main, home, space, { title: 'About this space', fill });
}

function launcherRunRow(main, home, space, run) {
  const attention = run.outcome === 'attention';
  return launcherRow({
    lead: iconEl(attention ? 'lucide:circle-alert' : 'lucide:check', `wv-icon launcher-status ${attention ? 'is-attention' : 'is-success'}`),
    name: run.name,
    sub: WeaveSpaceHome.runSubject(run, space.space),
    outcome: attention ? WeaveSpaceHome.runResult(run) : null,
    at: run.at,
    onclick: () => launcherRunDetail(main, home, space, run),
  });
}

function launcherHome(main, space, sections) {
  const tables = sections.tables ?? [];
  const home = el('div', { class: 'launcher-home' });
  const leadIcon = (icon) => el('span', { class: 'launcher-row-icon' }, iconEl(icon, 'wv-icon'));
  home.append(...[
    launcherSearch(space, tables),
    launcherTiles(space, tables),
    launcherSection({
      part: 'views', title: 'Recent views', note: 'Opened by you', more: 'More recent views',
      rows: (sections.views ?? []).map((v) => launcherRow({
        lead: leadIcon('lucide:eye'), name: v.name, sub: [v.table, WeaveTerm.cap(v.layout)].filter(Boolean).join(' · '), at: v.at, href: v.url,
      })),
    }),
    launcherSection({
      part: 'rows', title: 'Recent', note: 'Opened by you', more: 'More recent',
      rows: (sections.rows ?? []).map((r) => launcherRow({
        name: r.name, sub: [`${r.table} #${r.publicId}`, r.chip?.state?.name].filter(Boolean).join(' · '), at: r.at, onclick: () => openEntity(r.id),
      })),
    }),
    launcherSection({
      part: 'runs', title: 'Automation activity', note: `Impact on ${space.space}`, more: 'More runs',
      rows: (sections.runs ?? []).map((run) => launcherRunRow(main, home, space, run)),
    }),
    sections.overview ? el('button', {
      class: 'launcher-about', type: 'button', dataset: { part: 'about' },
      onclick: () => launcherAbout(main, home, space, sections.overview),
    }, iconEl('lucide:info', 'wv-icon'), 'About this space', iconEl('lucide:chevron-right', 'wv-icon launcher-chevron')) : null,
  ].filter(Boolean));
  return home;
}

async function showSpaceLauncher(main, space) {
  if (state.route?.page !== 'space' || state.route.spaceId !== space.spaceId) return;
  main.querySelector(':scope > .launcher')?.remove();
  const root = el('div', { class: 'launcher' });
  main.append(root);
  let payload;
  try {
    payload = await api('GET', `/spaces/${space.spaceId}/home`);
  } catch (err) {
    if (!root.isConnected) return;
    root.replaceChildren(el('div', { class: 'launcher-failed', role: 'alert' },
      el('p', {}, `This space did not load: ${err.message}`),
      el('button', { class: 'btn', type: 'button', onclick: () => { root.remove(); showSpaceLauncher(main, space); } }, 'Try again')));
    return;
  }
  if (!root.isConnected) return;
  root.replaceChildren(launcherHome(main, space, WeaveSpaceHome.homeSections(payload, readRecents())));
  root.dataset.ready = 'true';
}
