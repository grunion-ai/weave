'use strict';

const SPACE_OVERVIEW_OPEN_KEY = 'weave-space-overview-open';
const SPACE_HOME_VIEWS = 3;
const SPACE_HOME_ROWS = 6;
const SPACE_HOME_RUNS = 6;
const VIEW_LAYOUT_ICONS = { table: 'table', board: 'kanban' };

function spaceHomeTime(at) {
  if (at == null) return null;
  const { text, title } = weaveDateCore.relativeOrShort(new Date(at).toISOString());
  return el('time', { class: 'space-home-time', datetime: new Date(at).toISOString(), title }, text);
}

function spaceHomeHead(title, note, tail = null) {
  return el('div', { class: 'space-home-head' },
    el('div', { class: 'space-home-heading' }, el('h2', {}, title), note ? el('span', { class: 'space-home-note' }, note) : null),
    tail);
}

function spaceHomeEntityLink(entity, ...children) {
  return el('a', {
    class: 'space-home-row',
    href: `#/entity/${entity.id}`,
    onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openEntity(entity.id);
    },
  }, ...children);
}

function spaceHomeLinks(label, items) {
  return el('nav', { class: 'space-home-tables', 'aria-label': label }, ...items.map((t) => el('a', { class: 'space-home-table', href: t.href, title: t.name },
    iconEl(t.icon, 'wv-icon'),
    el('span', { class: 'space-home-table-name' }, t.name),
    el('span', { class: 'space-home-count' }, (t.rowCount ?? 0).toLocaleString()),
    iconEl('lucide:arrow-up-right', 'wv-icon space-home-arrow'))));
}

function spaceHomeViews(views) {
  return el('section', { class: 'space-home-section space-home-views', dataset: { section: 'views' } },
    spaceHomeHead('Recent views', 'Your recently opened views'),
    el('div', { class: 'space-home-view-grid' }, ...views.slice(0, SPACE_HOME_VIEWS).map((v) => el('a', { class: 'space-home-view', href: v.url, title: v.name },
      el('span', { class: 'space-home-view-top' },
        iconEl(`lucide:${VIEW_LAYOUT_ICONS[v.layout] ?? 'table'}`, 'wv-icon space-home-view-icon'),
        iconEl('lucide:arrow-up-right', 'wv-icon space-home-arrow')),
      el('strong', { class: 'space-home-title' }, v.name),
      el('small', { class: 'space-home-sub' }, `${v.table} · ${v.layout[0].toUpperCase()}${v.layout.slice(1)}`),
      spaceHomeTime(v.at)))));
}

function spaceHomeRows(rows) {
  return el('section', { class: 'space-home-section space-home-rows', dataset: { section: 'rows' } },
    spaceHomeHead('Recent', 'Opened by you'),
    ...WeaveSpaceHome.rowsByTable(rows.slice(0, SPACE_HOME_ROWS)).map((group) => el('div', { class: 'space-home-group' },
      el('h3', { class: 'space-home-group-name' }, group.table),
      el('div', { class: 'space-home-list' }, ...group.rows.map((r) => {
        const status = r.chip?.state?.name;
        return spaceHomeEntityLink(r,
          el('span', { class: 'space-home-text' },
            el('strong', { class: 'space-home-title', title: r.name }, r.name),
            el('small', { class: 'space-home-sub' }, status ? `#${r.publicId} · ${status}` : `#${r.publicId}`)),
          spaceHomeTime(r.at));
      })))));
}

function spaceHomeRun(run, spaceName) {
  const attention = run.outcome === 'attention';
  const result = WeaveSpaceHome.runResult(run);
  const more = run.changedCount - run.changedRows.length;
  return el('details', { class: 'space-home-run', dataset: { outcome: run.outcome } },
    el('summary', {},
      el('span', { class: `space-home-status ${attention ? 'is-attention' : 'is-success'}` },
        iconEl(attention ? 'lucide:circle-alert' : 'lucide:check', 'wv-icon')),
      el('span', { class: 'space-home-text' },
        el('strong', { class: 'space-home-title', title: run.name ?? '' }, run.name ?? 'Automation'),
        el('small', { class: 'space-home-sub' }, WeaveSpaceHome.runSubject(run, spaceName)),
        el('small', { class: `space-home-result${attention ? ' is-attention' : ''}`, title: result }, result)),
      spaceHomeTime(run.at),
      summaryChevron()),
    el('div', { class: 'space-home-run-body' },
      attention ? el('p', { class: 'space-home-failure', role: 'note' }, result) : null,
      ...run.changedRows.map((r) => spaceHomeEntityLink(r,
        el('span', { class: 'space-home-text' },
          el('strong', { class: 'space-home-title', title: r.name }, r.name),
          el('small', { class: 'space-home-sub' }, `${r.table} #${r.publicId}`)))),
      more > 0 ? el('p', { class: 'space-home-more' }, `${more.toLocaleString()} more changed`) : null,
      el('a', {
        class: 'space-home-open-workflow',
        href: `#/entity/${run.workflowId}`,
        onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          openEntity(run.workflowId);
        },
      }, 'Open automation')));
}

function spaceHomeRuns(runs, spaceName, note) {
  const list = el('div', { class: 'space-home-list' });
  const both = runs.some((r) => r.outcome === 'attention') && runs.some((r) => r.outcome === 'success');
  let outcome = 'all';
  let showAll = false;
  const draw = () => {
    const shown = WeaveSpaceHome.filterRuns(runs, outcome);
    const cut = showAll ? shown : shown.slice(0, SPACE_HOME_RUNS);
    list.replaceChildren(...cut.map((run) => spaceHomeRun(run, spaceName)),
      ...(cut.length < shown.length ? [el('button', { class: 'btn btn-sm space-home-show-all', type: 'button', onclick: () => { showAll = true; draw(); } }, `Show all ${shown.length} runs`)] : []));
  };
  draw();
  let filter = null;
  if (both) {
    filter = pickerSelect({
      name: 'run-outcome',
      title: 'Filter automation runs',
      value: 'all',
      options: [{ id: 'all', label: 'All outcomes' }, { id: 'attention', label: 'Needs attention' }, { id: 'success', label: 'Succeeded' }],
    });
    filter.input.addEventListener('change', () => { outcome = filter.input.value; draw(); });
    filter.classList.add('space-home-filter');
  }
  return el('section', { class: 'space-home-section space-home-runs', dataset: { section: 'runs' } },
    spaceHomeHead('Automation runs', note, filter),
    list);
}

function spaceHomeOverview({ title, note, description, details }) {
  const body = el('div', { class: 'space-home-overview-body' });
  let open = false;
  try { open = localStorage.getItem(SPACE_OVERVIEW_OPEN_KEY) === '1'; } catch {}
  const box = el('details', { class: 'space-home-overview', dataset: { section: 'overview' } },
    el('summary', {}, summaryChevron(), el('span', { class: 'space-home-overview-title' }, title), el('span', { class: 'space-home-note' }, note)),
    body);
  let drawn = null;
  const fill = () => (drawn ??= (async () => {
    if (description) {
      const prose = el('div', { class: 'wv-prose space-home-description' });
      body.append(prose);
      try { prose.innerHTML = (await api('POST', '/markdown', { md: description })).html; } catch { prose.textContent = description; }
    }
    await details(body);
  })().catch((err) => toast(err.message, true)));
  box.addEventListener('toggle', () => {
    try { localStorage.setItem(SPACE_OVERVIEW_OPEN_KEY, box.open ? '1' : '0'); } catch {}
    if (box.open) fill();
  });
  if (open) box.open = true;
  return box;
}

function spaceHomePage(sections, { lead, space, runsNote, overview }) {
  const page = el('div', { class: 'space-home' });
  page.append(lead);
  if (sections.views) page.append(spaceHomeViews(sections.views));
  if (sections.rows || sections.runs) {
    page.append(el('div', { class: `space-home-pair${sections.rows && sections.runs ? '' : ' is-single'}` },
      sections.rows ? spaceHomeRows(sections.rows) : null,
      sections.runs ? spaceHomeRuns(sections.runs, space, runsNote) : null));
  }
  page.append(spaceHomeOverview({ ...overview, description: sections.overview?.description ?? '' }));
  return page;
}

async function mountSpaceHome(main, space, gen = navDraw, home = api('GET', `/spaces/${space.spaceId}/home`)) {
  const stillHere = () => navOwns(gen) && state.route?.page === 'space' && state.route.spaceId === space.spaceId;
  let payload;
  try {
    payload = await home;
  } catch {
    payload = {
      space: { id: space.spaceId, name: space.space, icon: space.icon ?? null, description: space.description ?? '' },
      tables: space.tables.map((t) => ({ id: t.id, name: t.name, icon: t.icon ?? null, rowCount: t.entityCount ?? 0, views: t.views ?? [] })),
      runs: [],
    };
  }
  if (!stillHere()) return;
  const sections = WeaveSpaceHome.homeSections(payload, readRecents());
  main.append(spaceHomePage(sections, {
    lead: sections.tables
      ? spaceHomeLinks('Tables', sections.tables.map((t) => ({ href: `#/table/${t.id}`, name: t.name, icon: t.icon || 'lucide:table', rowCount: t.rowCount })))
      : spaceTablesCard(space),
    space: space.space,
    runsNote: `Changes in ${space.space} · includes runs from other spaces`,
    overview: {
      title: 'Space overview',
      note: 'Description, summaries and relationships',
      details: (body) => appendSpaceDetails(body, space, { withTables: !!sections.tables }),
    },
  }));
}

async function mountWorkspaceHome(main, ws, gen = navDraw) {
  let payload;
  try {
    payload = await api('GET', '/workspace/home');
  } catch {
    payload = {
      workspace: { name: ws.name, description: ws.description ?? '' },
      spaces: state.schema.filter((sp) => !sp.system).map((sp) => ({
        id: sp.spaceId,
        name: sp.space,
        icon: sp.icon ?? null,
        tables: sp.tables.map((t) => ({ id: t.id, name: t.name, icon: t.icon ?? null, rowCount: t.entityCount ?? 0, views: t.views ?? [] })),
      })),
      runs: [],
    };
  }
  if (!navOwns(gen) || state.route?.page !== 'home') return;
  const sections = WeaveSpaceHome.workspaceSections(payload, readRecents());
  main.querySelector(':scope > .space-home')?.remove();
  main.append(spaceHomePage(sections, {
    lead: spaceHomeLinks('Spaces', (sections.spaces ?? []).map((sp) => ({ href: `#/space/${sp.id}`, name: sp.name, icon: sp.icon || 'lucide:folder', rowCount: sp.rowCount }))),
    space: null,
    runsNote: `Changes in ${ws.name}`,
    overview: {
      title: 'Workspace overview',
      note: 'Description, system tables, pages and relationships',
      details: (body) => appendWorkspaceDetails(body),
    },
  }));
}
