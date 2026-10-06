export const BUG_CATEGORIES = [
  {
    id: 'slow',
    label: 'Slow',
    hint: "A page, save, or search took too long — or never finished",
    severity: 'Medium',
  },
  {
    id: 'broken-ui',
    label: 'Looks broken',
    hint: "Layout, chips, or text overlap, clip, or render wrong",
    severity: 'Medium',
  },
  {
    id: 'wrong-data',
    label: 'Wrong data',
    hint: "A change didn't save, or the values shown are wrong",
    severity: 'High',
  },
  {
    id: 'error',
    label: 'Error',
    hint: "Something threw, or the page came up empty",
    severity: 'High',
  },
];

export const categoryById = (id) => BUG_CATEGORIES.find((c) => c.id === id) ?? null;

export const SYMPTOM_FIELD = 'Symptom';
export const SYMPTOM_OPTIONS = BUG_CATEGORIES.map((c) => c.label);

const RANK = { Low: 0, Medium: 1, High: 2 };

export function severityFor(cats) {
  return cats.reduce((worst, c) => (RANK[c.severity] > RANK[worst] ? c.severity : worst), 'Medium');
}

export function resolveCategories(ids = []) {
  if (!Array.isArray(ids)) throw new Error('categories must be an array');
  return ids.map((id) => {
    const c = categoryById(id);
    if (!c) throw new Error(`Unknown bug category '${id}'`);
    return c;
  });
}

export const MAX_EVENTS = 200;

const SECRET_PARAMS = /\b(token|key|secret|password|passwd|share|sig|signature|auth)=([^&\s"'`]+)/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const PREFIXED_KEY = /\b(wv[a-z]?|sk|pk|ucmcp|ghp|gho)_[A-Za-z0-9_-]{8,}/gi;

export function redact(text) {
  return String(text ?? '')
    .replace(BEARER, '$1 ***')
    .replace(SECRET_PARAMS, '$1=***')
    .replace(PREFIXED_KEY, '***');
}

function scrubEvent(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev ?? {})) {
    out[k] = typeof v === 'string' ? redact(v) : v;
  }
  return out;
}

function quote(note) {
  return String(note)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => '> ' + line.replace(/^\s*(#{1,6}|```|~~~)/, '\\$1'))
    .join('\n');
}

const secondsBefore = (t, at) => {
  const d = (Number(at) - Number(t)) / 1000;
  return Number.isFinite(d) ? `-${d.toFixed(1)}s` : '';
};

function replayStep(ev) {
  switch (ev.kind) {
    case 'nav':
      return `navigated to \`${ev.to}\``;
    case 'click':
      return `clicked ${ev.target}`;
    case 'key':
      return `pressed \`${ev.key}\`${ev.target ? ` on ${ev.target}` : ''}`;
    case 'api': {
      const verdict = ev.status >= 400 || ev.status === 0 ? `**${ev.status || 'failed'}**` : String(ev.status);
      return `**${ev.method}** \`${ev.path}\` → ${verdict} in ${ev.ms}ms`;
    }
    case 'error':
      return `error: \`${ev.message}\`${ev.source ? ` (${ev.source}:${ev.line ?? '?'})` : ''}`;
    case 'console':
      return `console.${ev.level ?? 'error'}: \`${ev.message}\``;
    default:
      return `${ev.kind}${ev.target ? ` ${ev.target}` : ''}`;
  }
}

const uptimeWords = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  if (n < 3600) return `, up ${Math.round(n / 60)}m`;
  return `, up ${Math.round(n / 3600)}h`;
};

export function renderBugReport({ categories = [], note = '', events = [], client = {}, server = {} } = {}) {
  const cats = resolveCategories(categories);
  const text = String(note ?? '').trim();
  if (!cats.length && !text) throw new Error('A report needs a symptom or a note');

  const trace = (Array.isArray(events) ? events : []).map(scrubEvent);
  const at = Number(client.at ?? trace.at(-1)?.t ?? 0);
  const where = client.route || client.url || '';
  const symptoms = cats.map((c) => c.label);

  const subject = text ? text.split('\n')[0] : `on ${where || 'the web UI'}`;
  const title = (symptoms.length ? `${symptoms.join(' + ')}: ${subject}` : subject).slice(0, 100).trim();

  const facts = [
    ['Page', client.url],
    ['Route', client.route],
    ['Workspace', server.workspace],
    ['Build', server.version ? `v${server.version}, started ${server.startedAt ?? '?'}${uptimeWords(server.uptime)}` : null],
    ['Viewport', client.viewport ? `${client.viewport.w} × ${client.viewport.h}` : null],
    ['Theme', client.theme],
    ['Browser', client.userAgent],
  ].filter(([, v]) => v != null && v !== '');

  const counts = trace.reduce((a, e) => {
    if (e.kind === 'error' || e.kind === 'console') a.errors++;
    else if (e.kind === 'api') { a.requests++; if (e.status >= 400 || e.status === 0) a.failed++; }
    else a.actions++;
    return a;
  }, { actions: 0, errors: 0, requests: 0, failed: 0 });

  const replay = trace.length
    ? trace.map((ev, i) => `${i + 1}. \`${secondsBefore(ev.t, at)}\` ${replayStep(ev)}`).join('\n')
    : '_The reporter filed this with no recorded actions — the session was fresh, or the recorder was cleared._';

  const md = [
    '## Report',
    '',
    symptoms.length
      ? `${cats.map((c) => `**${c.label}** (${c.hint.toLowerCase()})`).join(', ')}. Filed from the web UI${client.filedAt ? ` at ${client.filedAt}` : ''}.`
      : `No symptom picked — filed on the note alone${client.filedAt ? `, at ${client.filedAt}` : ''}.`,
    '',
    text ? quote(text) : '_The reporter added no note._',
    '',
    '## Where',
    '',
    '| | |',
    '| --- | --- |',
    ...facts.map(([k, v]) => `| ${k} | \`${redact(String(v))}\` |`),
    '',
    '## Replay',
    '',
    'Re-run these against this instance, in order. Times are seconds before the',
    'reporter clicked Report, so the last steps are the ones that hurt.',
    '',
    replay,
    '',
    '## Trace',
    '',
    `${counts.actions} actions, ${counts.errors} errors, ${counts.requests} requests (${counts.failed} failed).`,
    'Field values are never captured — the recorder keeps control names only,',
    'and secrets are stripped before the report leaves the page.',
    '',
    '```json',
    JSON.stringify(trace, null, 1),
    '```',
  ].join('\n');

  return { title, severity: severityFor(cats), symptoms, markdown: md };
}
