'use strict';
const WORKFLOW_KEPT = ['When', 'Then', 'Last Run'];
const WORKFLOW_SETUP_FALLBACK = 'Setup incomplete: write the Script as a rule before switching it On';

function workflowReason(anchor, text) {
  showPopover(anchor, [el('div', { class: 'wf-reason', role: 'note' }, text)]);
}

function workflowToggle(f, fields, patch) {
  const wrap = toggleSwitch(f, fields.On, patch);
  if (fields.On === true || fields.State !== 'Setup incomplete') return wrap;
  const why = fields['Health Reason'] || WORKFLOW_SETUP_FALLBACK;
  const input = wrap.querySelector('input');
  input.disabled = true;
  input.setAttribute('aria-description', why);
  wrap.classList.add('is-locked');
  wrap.title = why;
  wrap.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    workflowReason(wrap, why);
  });
  return wrap;
}

function workflowHealth(f, fields) {
  const chip = optionChipEl(f, fields.Health ?? null);
  const why = fields['Health Reason'] || '';
  chip.classList.add('wf-health');
  chip.title = why || `Health: ${fields.Health ?? 'not run yet'}`;
  if (why) chip.setAttribute('aria-description', why);
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (why) workflowReason(chip, why);
  });
  return chip;
}

function workflowCell(f, item, patch) {
  const fields = item.fields ?? {};
  if (f.name === 'On' && f.type === 'toggle') return workflowToggle(f, fields, patch);
  if (f.name === 'Health' && f.type === 'select') return workflowHealth(f, fields);
  if (!WORKFLOW_KEPT.includes(f.name)) return null;
  const text = String(fieldValueCell(fields[f.name]) ?? '');
  return el('span', { class: 'wf-kept' + (text ? '' : ' is-empty'), title: text || `${f.name}: kept by weave` }, text || '—');
}

function workflowPhoneTap(anchor, f, entity) {
  const fields = entity.fields ?? {};
  if (f.name === 'On' && fields.On !== true && fields.State === 'Setup incomplete') {
    workflowReason(anchor, fields['Health Reason'] || WORKFLOW_SETUP_FALLBACK);
    return true;
  }
  if (f.name !== 'Health') return false;
  workflowReason(anchor, fields['Health Reason'] || `Health: ${fields.Health ?? 'not run yet'}`);
  return true;
}
