import { WeaveError } from './store.js';

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'timed-out'];
export const RUN_TERMINAL = new Set(['succeeded', 'failed', 'timed-out']);
export const RUN_MAIL_WINDOW_MS = 23 * 60 * 60 * 1000;
export const RUN_MAIL_ATTEMPTS = 8;
export const RUN_COLUMNS = [
  ['Status', 'select', { options: RUN_STATUSES.map((name) => ({ name, hue: name === 'succeeded' ? 'green' : name === 'failed' || name === 'timed-out' ? 'red' : 'slate' })) }],
  ['Recipient', 'email'], ['Started', 'date', { time: true }], ['Finished', 'date', { time: true }], ['Deadline', 'date', { time: true }],
  ['Summary', 'text'], ['Error', 'text'], ['Session URL', 'url'], ['Workflow', 'text'], ['Record', 'text'], ['Key', 'text'],
  ['Mail Status', 'select', { options: ['disabled', 'pending', 'sending', 'sent', 'failed'].map((name) => ({ name, hue: name === 'sent' ? 'green' : name === 'failed' ? 'red' : 'slate' })) }],
  ['Mail Attempts', 'number', { decimals: 0 }], ['Mail Error', 'text'], ['Mail Provider ID', 'text'], ['Mail Next Attempt', 'date', { time: true }],
];

export const RUN_FIELD_KEYS = {
  Name: 'name', Status: 'status', Recipient: 'recipient', Started: 'startedAt', Finished: 'finishedAt', Deadline: 'deadline',
  Summary: 'summary', Error: 'error', 'Session URL': 'sessionUrl', Workflow: 'workflow', Record: 'record', Key: 'key',
  'Mail Status': 'mailStatus', 'Mail Attempts': 'mailAttempts', 'Mail Error': 'mailError', 'Mail Provider ID': 'mailProviderId', 'Mail Next Attempt': 'mailNextAttempt',
};

export function runText(value, label, max = 16000, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\0')) throw new WeaveError(`${label} must be ${required ? 'nonempty ' : ''}text of at most ${max} characters`, 'invalid');
  return value;
}

export function runInput(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new WeaveError('A run needs an object', 'invalid');
  for (const k of Object.keys(a)) if (!['name', 'recipient', 'timeoutMinutes', 'workflow', 'record', 'key'].includes(k)) throw new WeaveError(`Unknown run field '${k}'`, 'invalid');
  const name = runText(a.name, 'name', 200, true).trim();
  const recipient = runText(a.recipient, 'recipient', 254)?.trim().toLowerCase() || null;
  if (recipient && !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient)) throw new WeaveError('recipient must be one email address', 'invalid');
  const timeoutMinutes = a.timeoutMinutes ?? 60;
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 10080) throw new WeaveError('timeoutMinutes must be an integer from 1 to 10080', 'invalid');
  return { name, recipient, timeoutMinutes, workflow: runText(a.workflow, 'workflow', 200), record: runText(a.record, 'record', 200), key: runText(a.key, 'key', 200) || null };
}

export function runPatch(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new WeaveError('A run update needs an object', 'invalid');
  const patch = {};
  for (const [k, v] of Object.entries(a)) {
    if (!['status', 'summary', 'error', 'sessionUrl'].includes(k)) throw new WeaveError(`Unknown run update field '${k}'`, 'invalid');
    if (k === 'status') {
      if (!RUN_STATUSES.includes(v)) throw new WeaveError(`Unknown run status '${v}'`, 'invalid');
      patch.status = v;
    } else patch[k] = runText(v, k, k === 'sessionUrl' ? 2048 : 16000);
  }
  if (patch.sessionUrl) {
    let u;
    try { u = new URL(patch.sessionUrl); } catch {}
    if (!u || !['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new WeaveError('sessionUrl must be an http(s) URL without credentials', 'invalid');
  }
  return patch;
}

export const runOut = (row) => ({ id: row.id, ...Object.fromEntries(Object.values(RUN_FIELD_KEYS).map((k) => [k, row.run[k] ?? null])) });
