'use strict';
function mapAutomations(automations) {
  if (!automations?.length) return [];
  return lazyScript('/automation-map.js').then(() => automations, () => {
    toast('Automations did not load. Check the connection and try again.', true);
    return [];
  });
}

function relationMapView(tables, automations, { spaceId = null } = {}) {
  const autosByTable = new Map();
  for (const a of automations ?? []) {
    if (!autosByTable.has(a.tableId)) autosByTable.set(a.tableId, []);
    autosByTable.get(a.tableId).push(a);
  }
  const autoCounts = Object.fromEntries([...autosByTable].map(([id, list]) => [id, list.length]));
  const map = globalThis.WeaveRelmap.relmapLayout(tables, { spaceId, autoCounts });
  if (!map.nodes.length) {
    return el('div', { class: 'wv-empty' }, spaceId ? 'No related tables in this space yet.' : 'No tables yet.');
  }
  const svg = svgEl('svg', { viewBox: `0 0 ${map.width} ${map.height}`, class: 'relmap', width: map.width, height: map.height });

  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'relmap-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4',
    markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: 'rel-arrow' }));
  defs.append(marker);
  svg.append(defs);

  for (const g of map.groups) {
    svg.append(svgEl('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14, class: 'space-box' }));
    svg.append(svgEl('text', { x: g.x + 14, y: g.y + 18, class: 'space-label' }, g.name));
  }

  for (const e of map.edges) {
    if (e.self) {
      svg.append(svgEl('path', {
        d: `M${e.x1},${e.y1} C${e.x1 + 34},${e.y1 - 16} ${e.x2 + 34},${e.y2 + 16} ${e.x2},${e.y2}`,
        class: 'rel-line', 'marker-end': 'url(#relmap-arrow)', fill: 'none',
      }));
    } else {
      svg.append(svgEl('line', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, class: 'rel-line', 'marker-end': 'url(#relmap-arrow)' }));
    }
    const tw = e.label.length * 6.2 + 14;
    svg.append(svgEl('rect', { x: e.lx - tw / 2, y: e.ly - 9, width: tw, height: 18, rx: 9, class: 'rel-label-bg' }));
    svg.append(svgEl('text', { x: e.lx, y: e.ly + 4, 'text-anchor': 'middle', class: 'rel-label' }, e.label));
  }

  for (const n of map.nodes) {
    const x = n.x - n.w / 2, y = n.y - n.h / 2;
    const g = svgEl('g', { class: 'table-node' + (n.foreign ? ' foreign' : ''), cursor: 'pointer', 'data-href': `#/table/${n.id}` });
    g.addEventListener('click', () => { location.hash = `#/table/${n.id}`; });
    g.append(svgEl('rect', { x, y, width: n.w, height: n.h, rx: 10, class: 'node-box' }));
    g.append(svgEl('text', { x: n.x, y: y + 24, 'text-anchor': 'middle', class: 'node-title' }, n.name));
    g.append(svgEl('text', { x: n.x, y: y + 43, 'text-anchor': 'middle', class: 'node-sub' },
      n.foreign ? `${n.space} • ${WeaveTerm.count(n.entityCount, n.term)}` : WeaveTerm.count(n.entityCount, n.term)));
    svg.append(g);

    if (autosByTable.has(n.id)) drawAutomationPills(svg, n, autosByTable.get(n.id));
  }

  return el('div', { class: 'map-view' },
    el('div', { class: 'map-wrap' }, svg),
    el('div', { class: 'map-legend' },
      el('span', {}, '▢ table (click to open)'),
      el('span', {}, '→ relation (1/∗ = cardinality)'),
      el('span', {}, '⚡ automation: trigger ⇒ actions')));
}

function mapCard(title, automations, { spaceId = null } = {}) {
  const card = el('div', { class: 'card panel home-map' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, title)),
    el('div', { class: 'card-body' }));
  const tables = state.schema.flatMap((s) => s.tables.map((t) => ({ ...t, space: s.space, spaceId: s.spaceId })));
  const view = relationMapView(tables, automations, { spaceId });
  card.querySelector('.card-body').replaceChildren(view);
  return view.classList.contains('wv-empty') ? null : card;
}

async function showMap() {
  state.route = { page: 'map' };
  renderNav();
  const main = $('#main');
  main.replaceChildren(viewHeader({
    crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }],
    permalink: `${location.origin}${WS_PREFIX}/#/map`,
    title: 'Relation map',
  }));
  const automations = await mapAutomations(await api('GET', '/automations'));
  main.append(relationMapView(allTables(), automations));
}
