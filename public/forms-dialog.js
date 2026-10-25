'use strict';

async function formsDialog(db) {
  try {
    const data = await api('GET', `/forms/manage?table=${encodeURIComponent(db.id)}`);
    const list = el('div', { class: 'form-manager-list' });
    const link = form => `${location.origin}${WS_PREFIX}/f/${form.id}`;
    for (const form of data.forms) {
      const builtIn = form.kind !== 'Row';
      const toggle = el('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
        toggle.disabled = true;
        try { await api('PATCH', `/forms/${form.id}`, { enabled: !form.enabled }); await formsDialog(db); }
        catch (err) { toggle.disabled = false; toast(err.message, true); }
      } }, form.enabled ? 'Pause' : 'Enable');
      list.append(el('div', { class: 'form-manager-row', dataset: { formId: form.id } },
        el('div', {}, el('strong', {}, form.name), el('div', { class: 'text-muted' }, `${builtIn ? 'Built in · ' : ''}${form.enabled ? 'Enabled' : 'Paused'} · ${!data.requireAuth ? 'Open workspace' : form.floor === 'Anonymous' && data.anonymousAllowed ? 'Anyone with link' : 'Sign-in required'}`)),
        el('div', { class: 'form-manager-actions' },
          el('button', { type: 'button', class: 'btn btn-sm', onclick: () => copyText(link(form), 'Form link copied') }, 'Copy link'),
          el('a', { class: 'btn btn-sm', href: link(form), target: '_blank', rel: 'noopener' }, 'Open'),
          builtIn ? null : el('button', { type: 'button', class: 'btn btn-sm', onclick: () => formEditor(db, data, form) }, 'Edit'),
          builtIn ? null : toggle)));
    }
    modal('Forms', [el('p', { class: 'text-muted' }, `Collect submissions into ${db.name}. Each form keeps its link when you edit it.`),
      data.forms.length ? list : el('p', { class: 'form-manager-empty' }, 'No forms yet. Choose fields to collect your first submission.'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => formEditor(db, data) }, 'Create form')], null, 'Done');
    $('#modal').classList.add('wv-forms');
  } catch (err) { toast(err.message, true); }
}

function formEditor(db, data, current = null) {
  const label = (text, input) => el('label', { class: 'form-builder-label' }, el('span', {}, text), input);
  const name = el('input', { class: 'form-control', required: '', value: current?.name ?? `${db.name} form` });
  const description = el('textarea', { class: 'form-control', rows: '2' }, current?.description ?? '');
  const floor = pickerSelect({ title: 'Audience', value: current?.floor ?? 'Observer', options: [{ id: 'Observer', label: 'Signed-in members' }, ...(data.anonymousAllowed || current?.floor === 'Anonymous' ? [{ id: 'Anonymous', label: 'Anyone with link' }] : [])] });
  const enabled = el('input', { type: 'checkbox', class: 'form-check-input' });
  enabled.checked = current?.enabled ?? true;
  const supported = new Set(['text', 'document', 'email', 'url', 'number', 'rating', 'date', 'select', 'multiselect', 'workflow', 'checkbox', 'toggle']);
  const hidden = new Set(Object.keys(current?.hiddenValues ?? {}));
  const fields = el('div', { class: 'form-builder-fields' });
  const selected = current?.fields ?? db.fields.filter(f => f.role === 'name').map(f => ({ id: f.id, key: f.id, label: f.name, required: true }));
  const order = [...selected.map(f => db.fields.find(d => d.id === f.id)).filter(Boolean), ...db.fields.filter(f => !selected.some(s => s.id === f.id))];
  const rows = new Map();
  for (const field of order) {
    const previous = selected.find(f => f.id === field.id);
    if ((!supported.has(field.type) || field.computed || field.readOnly || hidden.has(field.id) || ['created-at', 'updated-at', 'created-by', 'updated-by'].includes(field.role)) && !previous) continue;
    const editable = supported.has(field.type) && !field.computed && !field.readOnly;
    const included = el('input', { type: 'checkbox', class: 'form-check-input', 'aria-label': `Include ${field.name}`, disabled: editable ? null : '' });
    included.checked = !!previous;
    const text = el('input', { class: 'form-control', value: previous?.label ?? field.name });
    const key = el('input', { class: 'form-control', value: previous?.key ?? field.id });
    const required = el('input', { type: 'checkbox', class: 'form-check-input' });
    required.checked = previous?.required === true;
    const hasDefault = el('input', { type: 'checkbox', class: 'form-check-input' });
    hasDefault.checked = Object.hasOwn(previous ?? {}, 'default');
    const choices = previous?.options ?? (field.options ?? field.states ?? []).map(o => typeof o === 'string' ? o : o.name);
    const type = { number: 'number', rating: 'number', date: 'date', email: 'email', url: 'url' }[field.type] ?? 'text';
    const picks = ['select', 'workflow', 'multiselect'].includes(field.type) ? choices.map(option => ({ id: option, label: option }))
      : ['checkbox', 'toggle'].includes(field.type) ? [{ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' }] : null;
    const multi = field.type === 'multiselect';
    const value = picks ? pickerSelect({ title: field.name, options: picks, multi, value: multi ? previous?.default ?? [] : previous?.default != null ? String(previous.default) : null })
      : ['text', 'document'].includes(field.type) ? el('textarea', { class: 'form-control', rows: '3' })
        : el('input', { class: 'form-control', type: field.type === 'date' && previous?.default && !/^\d{4}-\d{2}-\d{2}$/.test(previous.default) ? 'text' : type, step: type === 'number' ? 'any' : null });
    const control = value.input ?? value;
    if (!picks) value.value = previous?.default ?? '';
    let defaultEdited = false;
    for (const kind of ['input', 'change']) control.addEventListener(kind, () => defaultEdited = true);
    hasDefault.addEventListener('change', () => defaultEdited = true);
    const row = el('details', { class: 'form-builder-field', dataset: { formField: field.id } });
    const move = direction => {
      const other = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
      if (other) fields.insertBefore(direction < 0 ? row : other, direction < 0 ? other : row);
    };
    row.append(el('summary', { tabindex: '0' }, el('span', {}, field.name), el('span', { class: 'text-muted' }, previous ? 'Included' : 'Available')),
      el('div', { class: 'form-builder-settings' },
        label(`Include ${field.name}`, included),
        editable ? el('div', { class: 'form-builder-pair' }, label('Label', text), label('Key', key)) : el('p', { class: 'text-muted' }, 'Existing field settings are preserved. This field type is configured through the API.'),
        editable ? label('Required', required) : null,
        editable ? label('Use a default', hasDefault) : null,
        editable ? label(field.type === 'multiselect' ? 'Default choices' : 'Default value', value) : null,
        el('div', { class: 'form-manager-actions' }, el('button', { class: 'btn btn-sm', type: 'button', onclick: () => move(-1), 'aria-label': `Move ${field.name} up` }, 'Move up'), el('button', { class: 'btn btn-sm', type: 'button', onclick: () => move(1), 'aria-label': `Move ${field.name} down` }, 'Move down'))));
    const sync = () => {
      row.querySelector('summary .text-muted').textContent = included.checked ? 'Included' : 'Available';
      for (const input of [text, key, required, hasDefault]) input.disabled = !included.checked || !editable;
      (value.face ?? value).disabled = !included.checked || !hasDefault.checked || !editable;
      text.required = key.required = included.checked && editable;
    };
    included.addEventListener('change', sync);
    hasDefault.addEventListener('change', sync);
    sync();
    fields.append(row);
    rows.set(field.id, () => {
      if (!included.checked) return null;
      if (!editable) return previous;
      const out = { ...previous, id: field.id, key: key.value.trim(), label: text.value.trim(), required: required.checked };
      delete out.default;
      if (hasDefault.checked) {
        if (!defaultEdited && Object.hasOwn(previous ?? {}, 'default')) out.default = previous.default;
        else if (['number', 'rating'].includes(field.type)) {
          if (!control.value.trim() || !Number.isFinite(Number(control.value))) throw new Error(`${field.name} needs a numeric default`);
          out.default = Number(control.value);
        } else if (['checkbox', 'toggle'].includes(field.type)) out.default = control.value === 'true';
        else if (multi) out.default = [...control.values];
        else out.default = control.value;
      }
      return out;
    });
  }
  const message = el('div', { class: 'text-danger', role: 'alert' });
  modal(current ? 'Edit form' : 'Create form', [label('Form name', name), label('Description', description), data.requireAuth ? label('Audience', floor) : el('div', { class: 'form-builder-label' }, el('span', {}, 'Audience'), el('strong', {}, 'Anyone in this open workspace'), el('p', { class: 'text-muted' }, 'Sign-in is off for this workspace. Anyone who can reach it can submit this form.')),
    data.requireAuth && !data.anonymousAllowed ? el('p', { class: 'text-muted' }, 'Anyone with link requires public forms to be enabled by your server operator.') : null,
    label('Enabled', enabled), el('h3', {}, 'Fields'), fields,
    current?.hidden?.length ? el('p', { class: 'text-muted' }, `Server fields preserved: ${current.hidden.join(', ')}`) : null, message], async () => {
    const submit = $('#modal button[type="submit"]');
    submit.disabled = true;
    message.textContent = '';
    try {
      const entries = [...fields.children].map(row => rows.get(row.dataset.formField)()).filter(Boolean);
      if (!entries.length) throw new Error('Include at least one field');
      await api(current ? 'PATCH' : 'POST', current ? `/forms/${current.id}` : '/forms', { name: name.value.trim(), description: description.value, ...(current ? {} : { table: db.id }), fields: entries, enabled: enabled.checked, floor: floor.input.value });
      await formsDialog(db);
    } catch (err) { submit.disabled = false; message.textContent = err.message; err.shown = true; throw err; }
  }, 'Save form');
  $('#modal').classList.add('wv-forms');
}
