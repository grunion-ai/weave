(function (root) {
  function scope(context) {
    const ids = [...(context.selected ?? [])];
    if (ids.length) return { kind: 'entities', ids };
    return context.kind === 'workspace' ? { kind: 'workspace' } : { kind: context.kind, id: context.id };
  }
  function expiration(value, custom) {
    if (['1h', '1d', '7d', '30d', '90d', 'never'].includes(value)) return { expiry: value };
    const stamp = new Date(custom).getTime();
    if (value !== 'custom' || !Number.isFinite(stamp) || stamp <= Date.now()) throw new Error('Choose an expiration in the future.');
    return { expiresAt: new Date(stamp).toISOString() };
  }
  function mount(pane, context, { el, icon, api, copy, notify, close, confirm }) {
    let links = [], editing = null, busy = false, alive = true;
    const snapshot = scope(context);
    const scopeName = snapshot.kind === 'entities' ? `${snapshot.ids.length} selected entries` : `Entire ${context.kind}: ${context.name}`;
    const message = el('p', { class: 'share-note', role: 'status', 'aria-live': 'polite' });
    const list = el('div', { class: 'share-links' });
    const editor = el('div', { class: 'share-editor' });
    const add = el('button', { type: 'button', class: 'btn btn-sm share-add', onclick: () => edit(null) }, icon('plus'), 'Add link');
    const action = (name, glyph, run) => el('button', { type: 'button', class: 'btn btn-sm btn-icon btn-ghost-secondary', title: name, 'aria-label': name, onclick: () => perform(run) }, icon(glyph));
    const url = link => new URL(link.url, location.origin).href;
    async function perform(run) {
      if (busy || !alive) return;
      busy = true;
      const enabled = [...pane.querySelectorAll('button')].filter(b => !b.disabled);
      enabled.forEach(b => b.disabled = true);
      try { await run(); } catch (err) { if (alive) { message.textContent = err.message; notify(err.message, true); } }
      finally { busy = false; if (alive) enabled.filter(b => b.isConnected).forEach(b => b.disabled = false); }
    }
    async function refresh() {
      const all = await api('GET', '/shares?includeInactive=1');
      if (!alive) return;
      links = all.filter(link => {
        const access = link.scope;
        if (context.kind === 'workspace' || access.kind === 'workspace') return true;
        if (access.kind === context.kind && access.id === context.id) return true;
        if (access.kind === 'space' && access.id === context.spaceId) return true;
        if (context.kind === 'space' && access.kind === 'table' && context.tableIds?.includes(access.id)) return true;
        const ids = access.kind === 'entities' ? access.ids : access.kind === 'entity' ? [access.id] : [];
        return ids.some(id => (context.entityIds ?? [...(context.selected ?? [])]).includes(id));
      });
      render();
    }
    function render() {
      list.replaceChildren(...links.map(link => {
        const inactive = link.revokedAt || link.status === 'expired';
        const name = link.label || link.title || (link.mode === 'submit' ? 'Submission link' : 'View link');
        const status = link.revokedAt ? 'Deleted' : link.status === 'expired' ? 'Expired' : link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleString()}` : 'Never expires';
        return el('article', { class: 'share-link', dataset: { shareId: link.id } },
          el('a', { class: 'share-link-name', href: url(link), target: '_blank', rel: 'noopener noreferrer' }, name),
          el('small', { class: 'share-note' }, `${link.mode === 'submit' ? 'Submit' : link.mode === 'read' ? 'View' : link.mode} · ${link.visibility === 'private' ? 'Signed-in' : 'Anyone'} · ${link.scope.kind} · ${status}`),
          el('div', { class: 'share-link-actions' },
            action('Preview link', 'eye', () => window.open(`${url(link)}?preview=1`, '_blank', 'noopener,noreferrer')),
            action('Copy link', 'copy', () => copy(url(link), 'Link copied')),
            action('Edit link', 'pencil', () => edit(link)),
            !link.revokedAt ? action('Delete link', 'trash-2', async () => {
              if (!await confirm('Delete link?', 'Anyone using this link will lose access. Entries stay in weave.')) return;
              await api('DELETE', `/shares/${link.id}`); editing = null; editor.replaceChildren(); add.hidden = false; await refresh();
            }) : null),
          inactive ? el('small', { class: 'share-note' }, 'This link no longer opens shared content.') : null);
      }));
      if (!links.length) list.append(el('p', { class: 'share-note' }, 'No links yet.'));
    }
    function edit(link) {
      editing = link;
      add.hidden = true;
      const mode = el('select', { class: 'form-select', 'aria-label': 'Link purpose', disabled: link ? '' : null },
        el('option', { value: 'read' }, 'View entries'),
        context.kind === 'table' ? el('option', { value: 'submit' }, 'Submit a new entry') : null);
      mode.value = link?.mode ?? 'read';
      const expiry = el('select', { class: 'form-select', 'aria-label': 'Expiration' },
        link ? el('option', { value: 'keep' }, 'Keep current expiration') : null,
        ...[['1h','1 hour'],['1d','1 day'],['7d','7 days'],['30d','30 days'],['90d','90 days'],['custom','Custom date'],['never','Never']].map(([value, label]) => el('option', { value }, label)));
      expiry.value = link ? 'keep' : '7d';
      const date = el('input', { type: 'datetime-local', class: 'form-control', 'aria-label': 'Expiration date', hidden: '' });
      expiry.addEventListener('change', () => { date.hidden = expiry.value !== 'custom'; });
      const label = el('input', { class: 'form-control', 'aria-label': 'Link name', value: link?.label ?? '', placeholder: 'Optional link name', maxlength: '120' });
      const note = el('p', { class: 'share-note share-scope' });
      const setNote = () => { note.textContent = link ? `Scope fixed: ${link.scope.kind}` : mode.value === 'submit' ? `Creates entries in ${context.name}. Does not reveal existing entries.` : snapshot.kind === 'entities' ? `${scopeName}. Related and computed fields are omitted in this beta.` : `${scopeName}. Includes every field; view filters do not restrict access.`; };
      setNote(); mode.addEventListener('change', setNote);
      const exp = () => expiry.value === 'keep' ? {} : expiration(expiry.value, date.value);
      const save = el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, link ? 'Save changes' : 'Create link');
      const form = el('form', { onsubmit: e => { e.preventDefault(); perform(async () => {
        const expiryBody = exp();
        if (link) await api('PATCH', `/shares/${link.id}`, { label: label.value.trim(), ...expiryBody });
        else {
          const body = { scope: snapshot, mode: mode.value, label: label.value.trim(), ...expiryBody };
          if (body.mode === 'submit') {
            const form = await api('POST', '/forms', { name: `${context.name} submissions`, table: context.id, fields: context.fields, shareOnly: true, floor: 'Observer' });
            body.formId = form.id; body.scope = { kind: 'table', id: context.id };
          }
          await api('POST', '/shares', body);
        }
        if (!alive) return;
        editor.replaceChildren(); add.hidden = false; await refresh(); message.textContent = link ? 'Changes saved. The URL stays the same.' : 'Link created.';
      }); } },
        el('h3', {}, link ? 'Edit link' : 'New link'),
        link ? el('p', {}, link.mode === 'submit' ? 'Submission link' : link.visibility === 'private' ? 'Private access' : `${link.mode} access`) : el('label', {}, 'Purpose', mode), note,
        el('p', { class: 'share-note' }, link?.visibility === 'private' ? 'Requires workspace sign-in. Existing access restrictions are preserved.' : link && !['read', 'submit'].includes(link.mode) ? 'Existing access permissions are preserved.' : 'Anyone with the live link can access it. Email and domain restrictions are not available in this beta.'),
        el('label', {}, 'Name', label), el('label', {}, 'Expires', expiry), date,
        el('div', { class: 'share-form-actions' }, save, el('button', { type: 'button', class: 'btn btn-sm', onclick: () => { editor.replaceChildren(); add.hidden = false; } }, 'Cancel')));
      if (link && !link.revokedAt) form.append(el('button', { type: 'button', class: 'btn btn-sm share-regenerate', onclick: () => perform(async () => {
        const expiryBody = exp();
        if (!await confirm('Regenerate link?', 'The old URL stops working immediately. Share the replacement URL with recipients.')) return;
        await api('POST', `/shares/${link.id}/regenerate`, expiryBody);
        await refresh(); edit(links.find(item => item.id === link.id)); message.textContent = 'Link regenerated. The old URL no longer works.';
      }) }, icon('refresh-cw'), 'Regenerate link'), el('p', { class: 'share-note' }, 'Save changes keeps the URL. Regenerate replaces it.'));
      if (link?.revokedAt) save.disabled = true;
      editor.replaceChildren(form); (link ? label : mode).focus();
    }
    pane.hidden = false;
    pane.replaceChildren(el('div', { class: 'share-head' }, el('strong', {}, 'Share'), el('span', { class: 'share-beta' }, 'Beta'), action('Close share panel', 'x', close)),
      el('div', { class: 'share-scroll' }, el('p', { class: 'share-note' }, scopeName), el('h3', {}, 'Existing access'), list, add, editor, message));
    refresh().catch(err => { if (alive) message.textContent = err.message; });
    return () => { alive = false; pane.hidden = true; pane.replaceChildren(); };
  }
  root.WeaveSharePanel = { scope, expiration, mount };
})(globalThis);
