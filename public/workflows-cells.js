'use strict';
const WORKFLOW_KEPT = ['When', 'Then', 'Last Run'];

function workflowCell(f, item) {
  if (!WORKFLOW_KEPT.includes(f.name)) return null;
  const text = String(fieldValueCell(item.fields?.[f.name]) ?? '');
  return el('span', { class: 'wf-kept' + (text ? '' : ' is-empty'), title: text || `${f.name}: kept by weave` }, text || '—');
}
