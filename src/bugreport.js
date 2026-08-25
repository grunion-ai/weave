/* The bug report an agent can act on (Feature #141).

   A reporter picks one of four things and, if they feel like it, types one
   sentence. Everything else that makes the report worth reading — where they
   were, what they clicked, which request came back 500, which build was
   actually running — is collected by the page and rendered here.

   The renderer lives on the server, not in the browser, for two reasons. The
   page cannot be trusted to describe the server (a stale build reporting its
   own version is how this project's most common false bug starts), and the
   Replay section is a contract with an agent — one writer keeps it one shape.

   Zero dependencies, no DOM, no node builtins: a renderer beside
   markdown.js/deck.js/pdf.js, so routes.js may import it under workerd too. */

/* The four selectors. Not a taxonomy of causes — a taxonomy of how the app
   is *seen* to break, because the reporter is looking at a screen, not at a
   stack. Severity is the Issue table's own scale: what the user cannot trust
   (data, hard errors) outranks what merely looks or feels wrong. */
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

/* The multiselect field on Development/Issue these four write into. A report
   is a row, not a paragraph: picking "Slow" and "Looks broken" has to be
   filterable next week, which prose in a Description never is. */
export const SYMPTOM_FIELD = 'Symptom';
export const SYMPTOM_OPTIONS = BUG_CATEGORIES.map((c) => c.label);

/* A report can carry several symptoms, or none at all — a reporter who only
   types a sentence has filed a real bug, and refusing it to make the schema
   tidy would lose it. Severity is the worst of what was picked; an
   unclassified report rests at Medium rather than assuming the worst. */
const RANK = { Low: 0, Medium: 1, High: 2 };

export function severityFor(cats) {
  return cats.reduce((worst, c) => (RANK[c.severity] > RANK[worst] ? c.severity : worst), 'Medium');
}

/* Resolve the ids a reporter picked. Throws on an id that is not one of the
   four — a typo must not become an untyped report filed under a shrug. */
export function resolveCategories(ids = []) {
  if (!Array.isArray(ids)) throw new Error('categories must be an array');
  return ids.map((id) => {
    const c = categoryById(id);
    if (!c) throw new Error(`Unknown bug category '${id}'`);
    return c;
  });
}

/* The largest trace worth pasting into a document. A ring buffer bounded at
   bugCore.MAX_EVENTS cannot exceed this; anything that does is not a report. */
export const MAX_EVENTS = 200;

/* A report is quoted into a shared Issue, so it is scrubbed on the way IN.
   Redacting on the way out would mean the secret was already at rest.

   What survives on purpose: uuids. An entity id is the address of the bug —
   strip it and the "replayable" report stops being replayable. */
const SECRET_PARAMS = /\b(token|key|secret|password|passwd|share|sig|signature|auth)=([^&\s"'`]+)/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const PREFIXED_KEY = /\b(wv|sk|pk|ucmcp|ghp|gho)_[A-Za-z0-9_-]{8,}/gi;

export function redact(text) {
  return String(text ?? '')
    .replace(BEARER, '$1 ***')
    .replace(SECRET_PARAMS, '$1=***')
    .replace(PREFIXED_KEY, '***');
}

/* Deep-redact a recorded event. Values are strings and numbers only — the
   recorder never puts an object in a trace — so this is one level deep. */
function scrubEvent(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev ?? {})) {
    out[k] = typeof v === 'string' ? redact(v) : v;
  }
  return out;
}

/* Prose the reporter typed, made safe to paste under a heading: no line may
   open a heading or a fence, or it would forge the sections below it. */
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

/* One recorded event as one replay instruction. Written imperatively enough
   that an agent driving a browser can execute the line, and plainly enough
   that Kyle can read the same line and know what happened. */
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

/* renderBugReport({category, note, events, client, server})
     category  one of BUG_CATEGORIES' ids (anything else throws)
     note      the reporter's optional sentence
     events    the ring buffer from public/bug-core.js, oldest first
     client    what the page knows: url, route, viewport, theme, userAgent,
               at (the ms clock reading when Report was clicked), filedAt
     server    what only the server knows: version, startedAt, uptime,
               workspace — routes.js supplies these; a client copy is ignored
   → { title, severity, markdown } */
export function renderBugReport({ categories = [], note = '', events = [], client = {}, server = {} } = {}) {
  const cats = resolveCategories(categories);
  const text = String(note ?? '').trim();
  // A report with neither a symptom nor a sentence says nothing at all.
  if (!cats.length && !text) throw new Error('A report needs a symptom or a note');

  const trace = (Array.isArray(events) ? events : []).map(scrubEvent);
  const at = Number(client.at ?? trace.at(-1)?.t ?? 0);
  const where = client.route || client.url || '';
  const symptoms = cats.map((c) => c.label);

  /* The title is what the Issue list shows. The reporter's sentence when there
     is one, the place it happened when there is not; prefixed by what they
     picked, or by nothing at all when they only typed. */
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
