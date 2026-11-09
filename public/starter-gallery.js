'use strict';
function starterCard(t, space) {
  const body = [el('span', { class: 'wv-start-title' }, t.title), el('span', { class: 'wv-start-blurb' }, t.blurb)];
  if (space) {
    return el('a', { class: 'wv-start-template wv-gallery-have', href: `#/space/${space.spaceId}`, dataset: { template: t.id } },
      ...body, el('span', { class: 'wv-gallery-note' }, 'In this workspace'));
  }
  if (!state.canManageForms) return el('div', { class: 'wv-start-template wv-gallery-locked', dataset: { template: t.id } }, ...body);
  return el('button', {
    class: 'wv-start-template', type: 'button', dataset: { template: t.id },
    onclick: (e) => {
      for (const b of e.currentTarget.closest('.wv-gallery').querySelectorAll('button')) b.disabled = true;
      runStarter(t);
    },
  }, ...body);
}

function showStarterGallery() {
  state.route = { page: 'templates' };
  renderNav();
  const { TEMPLATES, CATEGORIES } = WeaveStarters;
  const spaces = new Map(state.schema.filter((sp) => !sp.system).map((sp) => [String(sp.space).toLowerCase(), sp]));
  const groups = CATEGORIES.map((c) => ({ c, items: TEMPLATES.filter((t) => t.category === c.id) })).filter((g) => g.items.length);
  $('#main').replaceChildren(
    viewHeader({ crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }], permalink: `${location.origin}${location.pathname}#/templates`, title: 'Templates' }),
    el('div', { class: 'card wv-start wv-gallery' }, el('div', { class: 'card-body' },
      el('p', { class: 'wv-start-lead' }, state.canManageForms
        ? 'Each template adds one space of tables and sample records to this workspace.'
        : 'Each template adds one space of tables and sample records. Ask a workspace architect to add one.'),
      ...groups.map(({ c, items }) => el('section', { class: 'wv-gallery-group' },
        el('div', { class: 'wv-start-label' }, c.label),
        el('div', { class: 'wv-start-templates' }, ...items.map((t) => starterCard(t, spaces.get(t.space.toLowerCase())))))))));
}
