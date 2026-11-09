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
  let { items, views = [] } = await api('GET', db ? `/tables/${db.id}/trash` : '/trash');
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
  for (const item of items) {
    rows.append(el('tr', {},
      el('td', { class: 'pid-cell' }, `#${item.publicId}`),
      el('td', {}, item.name || el('span', { class: 'view-desc-empty' }, 'Untitled')),
      ...(db ? [] : [el('td', { class: 'trash-table' }, trashKind(item))]),
      el('td', { class: 'trash-when' }, whenEl(item.deletedAt)),
      el('td', { class: 'trash-acts' },
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: async () => {
            try {
              await api('POST', `/entities/${item.id}/restore`);
              toast('Restored');
              await loadSchema();
              showTrash(dbId);
            } catch (err) { toast(err.message, true); }
          },
        }, 'Restore'))));
  }
  for (const v of views) {
    const act = (run, done) => async () => {
      try {
        await run();
        toast(done);
        showTrash(dbId);
      } catch (err) { toast(err.message, true); }
    };
    rows.append(el('tr', {},
      el('td', { class: 'pid-cell' }),
      el('td', {}, v.name),
      el('td', { class: 'trash-table' }, 'Share page'),
      el('td', { class: 'trash-when' }, whenEl(v.deletedAt)),
      el('td', { class: 'trash-acts' },
        el('button', { class: 'btn btn-sm', type: 'button', onclick: act(() => api('POST', `/views/${v.id}/restore`), 'Restored') }, 'Restore'))));
  }
  if (items.length || views.length) main.append(el('div', { class: 'card table-wrap' },
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
  const [trash, list, ws] = await Promise.all([api('GET', '/trash'), api('GET', '/workspaces').catch(() => []), api('GET', '/workspace').catch(() => null)]);
  const main = $('#main');
  main.replaceChildren();
  main.append(viewHeader({
    crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }],
    permalink: `${location.origin}${WS_PREFIX}/#/settings`,
    title: 'Settings',
  }));
  if (typeof ws?.linkPreview === 'boolean') {
    main.append(el('div', { class: 'card settings-link-preview' },
      el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Link preview')),
      el('p', { class: 'settings-note' }, 'A record permalink pasted into Slack, Messages or email unfurls with its title, path and first fields before anyone signs in. Documents, other fields and the API stay behind sign-in.'),
      paneSwitch({
        label: 'Link preview before sign-in', on: ws.linkPreview,
        onChange: async (on) => {
          const now = await setLinkPreview(on);
          if (now !== on) showSettings();
        },
      })));
  }
  const gone = [
    ...trash.items.filter((i) => allTables().find((d) => d.id === i.dbId)?.system !== 'views')
      .map((i) => ({ name: i.name || `#${i.publicId}`, where: trashKind(i), deletedAt: i.deletedAt, path: `/entities/${i.id}` })),
    ...(trash.views ?? []).map((v) => ({ name: v.name, where: 'Share page', deletedAt: v.deletedAt, path: `/views/${v.id}` })),
  ];
  const purge = el('div', { class: 'card settings-purge' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Delete forever')),
    el('p', { class: 'settings-note' }, 'Records, tables, spaces and share pages in the trash. Deleting one forever cannot be undone, and Activity cannot restore it.'));
  if (!gone.length) purge.append(el('div', { class: 'empty-note' }, 'Nothing in the trash.'));
  else {
    const rows = el('tbody');
    for (const g of gone) {
      const tr = el('tr', { class: 'purge-row' },
        el('td', {}, g.name),
        el('td', { class: 'trash-table' }, g.where),
        el('td', { class: 'trash-when' }, whenEl(g.deletedAt)),
        el('td', { class: 'trash-acts' }));
      if (trash.purge) {
        tr.lastChild.append(el('button', {
          class: 'btn btn-sm btn-outline-danger purge-open', type: 'button',
          onclick: confirmToggle(tr, () => {
            const { box, input } = typedHold(g.name, 'This cannot be undone.', {
              label: 'Delete forever', hold: true, holdingLabel: 'Hold to purge…',
              run: async () => {
                try {
                  await api('DELETE', `${g.path}?hard=1`);
                  toast(`${g.name} deleted forever`);
                  await loadSchema();
                  showSettings();
                } catch (err) { toast(err.message, true); }
              },
            });
            return { node: el('tr', {}, el('td', { colspan: 4 }, box)), input };
          }),
        }, 'Delete forever…'));
      }
      rows.append(tr);
    }
    purge.append(el('div', { class: 'table-wrap' },
      el('table', { class: 'table table-sm table-vcenter card-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Type'), el('th', {}, 'Deleted'), el('th', {}, ''))),
        rows)));
  }
  main.append(purge);
  const deletable = list.filter((w) => w.deletable);
  if (!deletable.length) return;
  main.append(el('div', { class: 'card settings-workspaces' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Workspaces')),
    el('p', { class: 'settings-note' }, 'Deleting a workspace is permanent: it leaves the rail for everyone, its links stop working, and it cannot be undone.'),
    ...deletable.map((w) => {
      const row = el('div', { class: 'list-row' },
        el('span', { class: 'list-row-name' }, w.name),
        el('span', { class: 'text-secondary' }, `${w.tables ?? 0} tables, ${w.entities ?? 0} entities`),
        el('span', { class: 'spacer' }));
      row.append(el('button', {
        class: 'btn btn-sm btn-outline-danger ws-delete-open', type: 'button',
        onclick: () => deleteWorkspaceDialog(w),
      }, 'Delete…'));
      return row;
    })));
}
