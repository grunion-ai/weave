'use strict';

function droppedText(n) {
  return `${n} older ${n === 1 ? 'entry' : 'entries'} not kept`;
}

function activitySummary(a) {
  const d = a.detail ?? {};
  switch (a.kind) {
    case 'state-changed': return `${d.field}: ${d.from ?? '—'} → ${d.to ?? '—'}`;
    case 'field-updated': return `${d.field}: ${fmtValue(d.from)} → ${fmtValue(d.to)}`;
    case 'relation-updated': return `${d.field} changed`;
    case 'moved': return `moved from ${d.from} #${d.publicId}` + (d.skipped?.length ? ` — left behind: ${d.skipped.join(', ')}` : '');
    case 'comment-added': return `comment by ${commentAuthorText(d.author)}`;
    case 'file-attached': return `attached ${d.name}`;
    case 'automation-ran': return `automation “${d.name}” ran`;
    case 'field-config-updated': return `${d.field}: ${(d.changed ?? []).join(', ')} changed`;
    case 'undo': if (a.scope === 'field') return `${d.field}: ${(d.changed ?? []).join(', ')} put back`; return a.kind;
    case 'doc-updated':
    case 'doc-appended': {
      if (d.restoredFrom != null) {
        return `${d.field ?? 'Description'} restored to the version from ${d.restoredAt ? weaveDateCore.relativeOrShort(d.restoredAt).title : 'an earlier revision'}${d.restoredBy ? ` by ${d.restoredBy}` : ''}`;
      }
      const size = d.delta == null ? '' : ` ${d.delta >= 0 ? '+' : '−'}${Math.abs(d.delta)} chars`;
      const where = d.line ? ` at line ${d.line}` : '';
      const verb = a.kind === 'doc-appended' ? 'appended to' : 'edited';
      const quote = d.preview ? ` — “${d.preview}”` : '';
      return `${d.field ?? 'Description'} ${verb}${size}${where}${quote}`;
    }
    default: return a.kind;
  }
}

const fmtValue = (v) => {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    if ('start' in v || 'end' in v) return weaveDateCore.formatDateRange(v, {});
    return v.name ?? JSON.stringify(v);
  }
  return String(v);
};

async function showActivity(param) {
  if (param && param.includes(':')) return showActivityDetail(param);
  state.route = { page: 'activity' };
  renderNav();
  const main = $('#main');
  const entityId = param || null;
  const qs = `?limit=${ACTIVITY_PAGE}${entityId ? `&entity=${encodeURIComponent(entityId)}` : ''}`;
  let feed = { total: 0, items: [] };
  try { feed = await api('GET', `/activity${qs}`); } catch (err) { toast(err.message, true); }
  const subject = entityId ? feed.items[0] : null;

  const rows = feed.items.map((a) => el('tr', {
    class: 'activity-row',
    dataset: { href: `#/activity/${a.id}` },
    onclick: () => { location.hash = `#/activity/${a.id}`; },
  },
    el('td', { class: 'activity-when', title: a.ts }, weaveDateCore.relativeOrShort(a.ts).text),
    el('td', {}, el('span', { class: `k k-sys activity-kind kind-${a.kind}` }, a.kind)),
    el('td', {}, actorChipEl(a.actor)),
    el('td', {}, activitySummary(a)),
    el('td', {}, recordChip(a)),
    el('td', {}, a.entityName ?? '—')));

  main.replaceChildren(
    viewHeader({
      crumbs: entityId && subject
        ? [{ label: 'Activity', href: '#/activity' }, { label: subject.db, href: `#/table/${subject.dbId}` }]
        : [],
      permalink: `${location.origin}${WS_PREFIX}/#/activity${entityId ? `/${entityId}` : ''}`,
      title: entityId && subject ? `Activity — ${subject.scope === 'field' ? subject.db : subject.entityName}` : 'Activity',
    }),
    el('div', { class: 'wv-note' },
      'A system table: weave writes these records, so they cannot be added, edited or deleted. ',
      el('b', {}, `${feed.total}`), ' events.',
      feed.items.length < feed.total ? ` Showing the newest ${feed.items.length}.` : '',
      feed.dropped ? ` ${droppedText(feed.dropped)}.` : ''),
    feed.items.length
      ? el('div', { class: 'card' },
        el('table', { class: 'table table-sm table-vcenter card-table table-hover wv-grid' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'When'), el('th', {}, 'Event'), el('th', {}, 'Actor'), el('th', {}, 'Detail'),
            el('th', {}, 'Record'), el('th', {}, 'Name'))),
          el('tbody', {}, ...rows)))
      : el('div', { class: 'wv-empty' }, 'No activity yet.'));
}

function recordChip(a) {
  if (a.scope === 'field') {
    return el('span', { class: 'k k-rel' + (a.deleted ? ' deleted' : '') },
      el('a', { href: `#/table/${a.dbId}`, onclick: (e) => e.stopPropagation() },
        `${a.db ?? '—'}${a.deleted ? ' (deleted)' : ''}`));
  }
  return el('span', { class: 'k k-rel' + (a.deleted ? ' deleted' : '') },
    el('a', { href: `#/entity/${a.entityId}`, onclick: (e) => e.stopPropagation() },
      `${a.db ?? '—'} #${a.publicId}${a.deleted ? ' (deleted)' : ''}`));
}

function rollbackControl(a) {
  const fieldPath = () => `/tables/${a.dbId}/fields/${encodeURIComponent(a.detail.fieldId)}/rollback`;
  if (!a.rollback?.ok) return el('span', { class: 'activity-rollback-reason' }, a.rollback?.reason ?? 'Not available');
  return el('button', {
    class: 'btn btn-sm activity-rollback', type: 'button',
    onclick: async () => {
      try {
        const out = await api('POST', fieldPath(), { activity: a.id });
        await loadSchema();
        toast(rolledBackText(out, 'rolled back'), false, out.activity ? {
          label: 'Undo',
          run: async () => {
            try { await api('POST', fieldPath(), { activity: out.activity, via: 'undo' }); await loadSchema(); }
            catch (err) { toast(err.message, true); }
            showActivityDetail(a.id);
          },
        } : null);
      } catch (err) { toast(err.message, true); }
      showActivityDetail(a.id);
    },
  }, `Roll back ${a.detail.field}`);
}

function fieldChangeChip(type, o) {
  if (!o) return el('span', { class: 'field-change-none' }, '—');
  if (type === 'workflow') {
    const cat = chipCore.categoryOrDefault(o.category ?? 'not-started');
    return el('span', { class: `k k-state cat-${cat} hue-${chipCore.stateHue(o, cat)}` }, o.icon ? iconEl(o.icon, 'ico wv-icon') : null, chipLabel(o.name));
  }
  return el('span', { class: `k k-select hue-${o.hue || chipCore.hueFromHex(o.color)}` }, o.icon ? iconEl(o.icon, 'ico wv-icon') : null, chipLabel(o.name));
}

function fieldChangeRows(d, row) {
  const D = window.WeaveFieldDiff;
  const arrow = () => el('span', { class: 'field-change-arrow', 'aria-label': 'to' }, iconEl('lucide:arrow-right', 'wv-icon'));
  return D.changes(d).map((c) => {
    if (c.kind === 'list') {
      const type = d.after?.type ?? d.before?.type;
      return row(c.label, el('div', { class: 'field-change field-change-list' },
        ...c.items.map((it) => el('div', { class: 'field-change-item' },
          it.before ? fieldChangeChip(type, it.before) : null,
          it.before && it.after ? arrow() : null,
          it.after ? fieldChangeChip(type, it.after) : null,
          el('span', { class: 'field-change-marks' }, it.marks.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')))),
        c.unchanged ? el('div', { class: 'field-change-unchanged' }, `${c.unchanged} unchanged`) : null));
    }
    if (c.kind === 'text') {
      return row(c.label, el('div', { class: 'field-change field-change-text' },
        el('code', {}, ...c.diff.map((p) => (p.op === '=' ? p.text : el(p.op === '+' ? 'ins' : 'del', {}, p.text))))));
    }
    return row(c.label, el('div', { class: 'field-change field-change-value' },
      el('span', { class: 'field-change-before' }, D.formatValue(c.before)), arrow(),
      el('span', { class: 'field-change-after' }, D.formatValue(c.after))));
  });
}

async function showActivityDetail(id) {
  state.route = { page: 'activity' };
  renderNav();
  const main = $('#main');
  let a;
  try { a = await api('GET', `/activity/${encodeURIComponent(id)}`); }
  catch (err) { toast(err.message, true); return showActivity(null); }

  const row = (label, value) => el('div', { class: 'fieldrow' }, el('label', {}, label), el('span', {}, value));
  const field = a.scope === 'field';
  const d = a.detail ?? {};
  const fieldsBody = el('div', { class: 'card-body' },
    row('Record', recordChip(a)),
    row('Table', a.db ? el('a', { href: `#/table/${a.dbId}` }, a.db) : '—'),
    row('Event', el('span', { class: `k k-sys activity-kind kind-${a.kind}` }, a.kind)),
    row('When', whenEl(a.ts)),
    row('Actor', actorChipEl(a.actor) || '—'),
    ...(field
      ? [row('Field', d.field),
        ...fieldChangeRows(d, row),
        row('Definitions', el('details', { class: 'activity-defs' },
          el('summary', {}, 'Show definitions'),
          el('div', { class: 'activity-defs-body' },
            el('div', { class: 'activity-defs-col' }, el('div', { class: 'activity-defs-head' }, 'Before'), el('pre', { class: 'activity-def' }, JSON.stringify(d.before, null, 2))),
            el('div', { class: 'activity-defs-col' }, el('div', { class: 'activity-defs-head' }, 'After'), el('pre', { class: 'activity-def' }, JSON.stringify(d.after, null, 2)))))),
        ...(d.lossy ? [row('Values', d.snapshot
          ? `${d.snapshot.rows} ${d.snapshot.rows === 1 ? 'value' : 'values'} from before this change kept for a roll back`
          : d.snapshotDropped ? 'No longer kept: a newer type change of this field replaced them' : 'Not kept')] : []),
        ...(d.restored != null ? [row('Values put back', `${d.restored} restored, ${d.left} edited since and kept, ${d.converted} newer converted`)] : [])]
      : Object.entries(d).map(([k, v]) => row(k, k === 'workflow' ? actorChipEl(`workflow:${v}`) : fmtValue(v)))),
    ...(field ? [row('Roll back', rollbackControl(a))] : []),
    row('History', el('a', { href: `#/activity/${a.entityId}` }, field ? `All field changes on ${a.db} →` : `All activity for ${a.entityName ?? 'this record'} →`)));

  main.replaceChildren(
    stickViewHeader(el('div', { class: 'view-header' },
      el('div', { class: 'crumb' },
        navMenuButton(),
        el('a', { href: '#/activity' }, 'Activity'), ' › ',
        el('span', {
          class: 'permalink-copy', title: 'Copy permalink',
          onclick: () => copyText(`${location.origin}${WS_PREFIX}/#/activity/${a.id}`, 'Permalink copied'),
        }, `#${a.id} ⧉`)),
      el('div', { class: 'wv-toolbar entity-head' },
        el('span', { class: 'name-edit activity-title' }, activitySummary(a))))),
    el('div', { class: 'card panel' },
      el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Fields')),
      fieldsBody));
}
