export const MARK = '🌙 overnight-fixer ·';
export const OUTCOMES = ['started', 'abandoned', 'fixed'];
export const ENRICH = '🔎 overnight-fixer · enriched ·';
export const CLAIM_HOURS = 12;

const LINE = /^🌙 overnight-fixer · attempt (\d+) · (\S+) · (started|abandoned|fixed)(?: · (.*))?$/;
const ENRICH_LINE = /^🔎 overnight-fixer · enriched · (\S+)/;
const NOTE_LABEL = /^\*\*(Not shipped\.|Merged, not verified live\.|Hypothesis:|Tried:|Evidence:|State:|Tests added:|Live verification:|Repro:|Code:|Fix shape:|Test to write first:)\*\*/;
const NOTE_LIST_HEAD = /^\*\*(Tried:|Tests added:|Code:|Test to write first:)\*\*$/;
const NOTE_EVIDENCE = /^\*\*Evidence:\*\*/;
const NOTE_CLOSER = /^Next attempt: read the lines above/;

const docOf = (row) => String(row.doc || row.fields?.Description || '');
const nameOf = (row) => row.name ?? row.fields?.Name ?? '';

export function parseAttempts(doc = '') {
  const out = [];
  for (const raw of String(doc).split('\n')) {
    const m = raw.trim().match(LINE);
    if (m) out.push({ attempt: Number(m[1]), at: m[2], outcome: m[3], detail: (m[4] ?? '').trim() });
  }
  return out;
}

export function isOpsIssue(row) {
  return /gerrit\/main @ [0-9a-f]+ did not reach|is not serving gerrit\/main/i.test(nameOf(row));
}

export function needsDecision(row) {
  const text = `${row.name ?? ''}\n${docOf(row)}`;
  return /needs deciding|decision pending|needs a decision|to be decided/i.test(text);
}

const SEV = { High: 0, Medium: 1, Low: 2 };

export function rankIssues(rows) {
  const rich = new Map(rows.map((r) => [r, isEnriched(r) ? 0 : 1]));
  return [...rows].sort((a, b) => {
    const s = (SEV[a.fields?.Severity] ?? 3) - (SEV[b.fields?.Severity] ?? 3);
    if (s) return s;
    const e = rich.get(a) - rich.get(b);
    if (e) return e;
    return String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''));
  });
}

export function selectIssues(rows, { max = 3 } = {}) {
  const { eligible: open, skipped } = triage(rows);
  return { picked: rankIssues(open).slice(0, max), skipped };
}

function triage(rows) {
  const skipped = [];
  const open = [];
  for (const r of rows) {
    const status = r.fields?.Status ?? 'Open';
    const last = parseAttempts(docOf(r)).at(-1);
    let reason = null;
    if (status !== 'Open') reason = 'in-progress';
    else if (isOpsIssue(r)) reason = 'ops';
    else if (needsDecision(r)) reason = 'decision';
    else if (last && last.outcome !== 'fixed') reason = 'attempted';
    if (reason) skipped.push({ publicId: r.publicId, reason });
    else open.push(r);
  }
  return { eligible: open, skipped };
}

const AREAS = [
  ['security', /security finding S-\d/i],
  ['gate', /\bgate\b|flak|Verified|review poller|\bwatcher\b|watchdog|heartbeat|launchd|npm test|\bCI\b|workflow token|\bsuite\b|test files/i],
  ['auth', /sign(ing)?[- ]in|\bauth|passkey|clerk|oidc|invite/i],
  ['mcp', /\bmcp\b|agent tool|weave_\w+/i],
  ['hosting', /railway|hosted instance|self-update|rollback|\bvolume\b|weave\.grunion\.ai/i],
  ['vendor', /vendored|dompurify|tabler|advisory|mermaid renderer|dependenc/i],
  ['editor', /document|editor|vditor|markdown|autosave|descriptions?\b/i],
  ['formula', /formula|rollup|lookup/i],
  ['loader', /\brope\b|loader|skeleton/i],
  ['picker', /picker|popover|dialog|backdrop|flyout|hover preview/i],
  ['layout', /\blayout\b|narrow|responsive|minimum width|programmatic scroll/i],
  ['fields', /system fields|number field|field (type|config|order)|field[- ]aware/i],
  ['workspace', /workspaces?\b(?! file)|onboarding|template|manifest/i],
  ['grid', /\bgrid\b|\bcell|\brows?\b|column|table view|spacer|\brecords?\b|view-tab|resizeobserver|opening a table/i],
  ['style', /colou?r|\btheme\b|\bicons?\b|\bchips?\b|\bcaret\b/i],
  ['dock', /\bdock/i],
  ['nav', /sidebar|\bnav\b|breadcrumb|search|⌘K/i],
  ['toast', /toast/i],
  ['import', /import|export|\bcsv\b/i],
  ['server', /server|routing|\brequest\b|\bPOST\b|\bPATCH\b|%2F|percent-escape|\bWAL\b|sqlite|busy_timeout|activity|automation|keystore|cache headers|\b404|statusFor|single-writer|\bAPI\b/i],
];

export const AREA_LABELS = {
  grid: 'Grid', editor: 'Editor', formula: 'Formula', loader: 'Loader', style: 'Style', dock: 'Dock', nav: 'Nav',
  toast: 'Toast', import: 'Import', flicker: 'Flicker', mcp: 'MCP', gate: 'Gate', auth: 'Auth', security: 'Security',
  hosting: 'Hosting', server: 'Server', workspace: 'Workspace', picker: 'Picker', layout: 'Layout', fields: 'Fields', vendor: 'Vendor',
  other: 'Other',
};

export const areaLabel = (key) => AREA_LABELS[key] ?? 'Other';

export function areaOf(row) {
  const set = String(row.fields?.Area ?? '').toLowerCase();
  if (Object.hasOwn(AREA_LABELS, set)) return set;
  return areaFromText(row);
}

export function areaFromText(row) {
  const doc = docOf(row);
  if (doc.includes('flicker-fp:')) return 'flicker';
  for (const text of [nameOf(row), doc.slice(0, 600)]) {
    const hit = AREAS.find(([, re]) => re.test(text));
    if (hit) return hit[0];
  }
  return 'other';
}

const symptomOf = (row) => [...(row.fields?.Symptom ?? [])].sort().join('+') || 'none';

export const SKIP_AREAS = ['auth', 'security'];

export function planBatches(rows, { maxIssues = 6, batchSize = 4, skipAreas = SKIP_AREAS, exclude = [] } = {}) {
  const { eligible: all, skipped } = triage(rows);
  const open = [];
  for (const r of all) {
    const area = areaOf(r);
    if (exclude.includes(r.publicId)) skipped.push({ publicId: r.publicId, reason: 'judgment' });
    else if (skipAreas.includes(area)) skipped.push({ publicId: r.publicId, reason: `area:${area}` });
    else open.push(r);
  }
  const ranked = rankIssues(open);
  const used = new Set();
  const batches = [];
  let left = maxIssues;
  for (const lead of ranked) {
    if (left <= 0) break;
    if (used.has(lead)) continue;
    const area = areaOf(lead), symptom = symptomOf(lead);
    const issues = ranked.filter((r) => !used.has(r) && areaOf(r) === area && symptomOf(r) === symptom).slice(0, Math.min(batchSize, left));
    issues.forEach((r) => used.add(r));
    left -= issues.length;
    batches.push({ key: `${area}|${symptom}`, area, symptom, issues });
  }
  return { batches, skipped };
}

const liveClaim = (last, now, hours) => last?.outcome === 'started' && Date.parse(last.at) >= now.getTime() - hours * 3600 * 1000;

export function staleClaims(rows, { now = new Date(), hours = CLAIM_HOURS } = {}) {
  return rows.filter((r) => {
    if ((r.fields?.Status ?? '') !== 'In Progress') return false;
    const last = parseAttempts(docOf(r)).at(-1);
    return !!last && last.outcome === 'started' && !liveClaim(last, now, hours);
  });
}

export function windowFor(fireAt) {
  const t = fireAt.getTime();
  return { start: new Date(t), noNewAfter: new Date(t + 120 * 60000), hardStop: new Date(t + 210 * 60000) };
}

export function budget(now, { start, noNewAfter, hardStop }) {
  const t = now.getTime();
  const minutesLeft = Math.max(0, Math.round((hardStop.getTime() - t) / 60000));
  return { canStart: t >= start.getTime() && t < noNewAfter.getTime(), mustStop: t > hardStop.getTime(), minutesLeft };
}

export function claimNote({ attempt, at, session }) {
  return `${MARK} attempt ${attempt} · ${at} · started · session ${session}`;
}

export function abortNote({ attempt, at, reason, tried = [], hypothesis = '', evidence = '', change = null, merged = null, patch = null, worktree = null }) {
  const lines = [`${MARK} attempt ${attempt} · ${at} · abandoned · ${reason}`, ''];
  lines.push(merged
    ? `**Merged, not verified live.** GitHub PR ${change} landed on main as ${merged}; live verification failed, so the Issue stays open.`
    : '**Not shipped.** Nothing landed on main from this attempt.');
  if (hypothesis) lines.push('', `**Hypothesis:** ${hypothesis}`);
  if (tried.length) lines.push('', '**Tried:**', ...tried.map((t) => `- ${t}`));
  if (evidence) lines.push('', '**Evidence:**', '```', evidence.trim(), '```');
  const state = [];
  if (change && merged) state.push(`GitHub PR ${change} merged as ${merged}`);
  else if (change) state.push(`GitHub PR ${change} closed`);
  else state.push('nothing was pushed');
  if (patch) state.push(`diff attached as ${patch}`);
  if (worktree) state.push(`worktree ${worktree}`);
  lines.push('', `**State:** ${state.join('; ')}.`);
  lines.push('', 'Next attempt: read the lines above before repeating any of it.');
  return lines.join('\n');
}

export function fixedNote({ attempt, at, change, sha, tests = [], verified = '' }) {
  const lines = [`${MARK} attempt ${attempt} · ${at} · fixed · GitHub PR ${change} → ${sha}`];
  if (tests.length) lines.push('', '**Tests added:**', ...tests.map((t) => `- ${t}`));
  if (verified) lines.push('', `**Live verification:** ${verified}`);
  return lines.join('\n');
}

export function parseVerdict(report = '') {
  const m = String(report).match(/```json\s*([\s\S]*?)```/);
  if (!m) return { outcome: 'unknown' };
  try {
    return outcomeOf(JSON.parse(m[1]));
  } catch {
    return { outcome: 'unknown' };
  }
}

function outcomeOf(v) {
  const outcome = v?.outcome ?? v?.verdict;
  return ['fixed', 'abandoned', 'skipped'].includes(outcome) ? { ...v, outcome } : { ...v, outcome: 'unknown' };
}

export function parseBatchVerdict(report = '', { expect = [] } = {}) {
  const blocks = [...String(report).matchAll(/```json\s*([\s\S]*?)```/g)];
  let v = {};
  try { v = blocks.length ? JSON.parse(blocks.at(-1)[1]) : {}; } catch { v = {}; }
  if (!v || typeof v !== 'object') v = {};
  const isObject = (i) => i && typeof i === 'object' && !Array.isArray(i);
  const issues = (Array.isArray(v.issues) ? v.issues.filter(isObject) : []).map(outcomeOf);
  for (const id of expect) if (!issues.some((i) => i.publicId === id)) issues.push({ publicId: id, outcome: 'unknown' });
  return { issues, enriched: Array.isArray(v.enriched) ? v.enriched : [] };
}

export function enrichNote({ at, session, from = [], repro = '', pointers = [], fixShape = '', tests = [] }) {
  const lines = [`${ENRICH} ${at} · session ${session} · from ${from.map((n) => `#${n}`).join(', ')}`];
  if (repro) lines.push('', `**Repro:** ${repro}`);
  if (pointers.length) lines.push('', '**Code:**', ...pointers.map((p) => `- ${p}`));
  if (fixShape) lines.push('', `**Fix shape:** ${fixShape}`);
  if (tests.length) lines.push('', '**Test to write first:**', ...tests.map((t) => `- ${t}`));
  return lines.join('\n');
}

export function isEnriched(row, { now = new Date(), days = 7 } = {}) {
  const at = docOf(row).split('\n').map((l) => l.trim().match(ENRICH_LINE)?.[1]).filter(Boolean).at(-1);
  return !!at && now.getTime() - Date.parse(at) < days * 86400000;
}

export function enrichCandidates(rows, { areas = [], worked = [], max = 5, now = new Date() } = {}) {
  const { eligible: open } = triage(rows);
  return rankIssues(open.filter((r) => areas.includes(areaOf(r)) && !worked.includes(r.publicId) && !isEnriched(r, { now })))
    .slice(0, max);
}

export function mergedOpenRows(logLines, rows) {
  const named = new Map();
  for (const line of logLines) {
    const subject = line.slice(line.indexOf(' ') + 1);
    if (!line.trim() || subject.startsWith('Revert')) continue;
    for (const [list] of subject.matchAll(/\bIssues? #\d+(?:(?:,| and|, and) #\d+)*/g)) {
      for (const [, n] of list.matchAll(/#(\d+)/g)) named.set(+n, [...(named.get(+n) ?? []), line]);
    }
  }
  return rows.filter((r) => named.has(r.publicId))
    .map((r) => ({ publicId: r.publicId, id: r.id, name: r.name, status: r.fields?.Status, commits: named.get(r.publicId) }));
}

function humanLinesAfterLastAttempt(doc) {
  const lines = doc.split('\n');
  const start = lines.findLastIndex((l) => LINE.test(l.trim()));
  const human = [];
  let inFence = false, expectFence = false, inList = false;
  for (const raw of lines.slice(start + 1)) {
    const t = raw.trim();
    if (inFence) { if (t.startsWith('```')) inFence = false; continue; }
    if (!t) { inList = false; continue; }
    if (ENRICH_LINE.test(t) || LINE.test(t) || NOTE_CLOSER.test(t)) { inList = false; continue; }
    if (expectFence && t.startsWith('```')) { inFence = true; expectFence = false; continue; }
    if (NOTE_LABEL.test(t)) {
      inList = NOTE_LIST_HEAD.test(t);
      expectFence = NOTE_EVIDENCE.test(t);
      continue;
    }
    if (inList && t.startsWith('- ')) continue;
    human.push(t);
  }
  return human;
}

export function changedSinceLastAttempt(row) {
  if (row.fields?.Agent === 'Ready') return true;
  const doc = docOf(row);
  const last = parseAttempts(doc).at(-1);
  if (!last || last.outcome === 'fixed') return true;
  return humanLinesAfterLastAttempt(doc).length > 0;
}

const filled = (v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');
const DONE_FEATURE = ['shipped', 'done'];

export function eligible(row, { now = new Date() } = {}) {
  const f = row.fields ?? {};
  if (row.db === 'Development/Feature') {
    return f.Agent === 'Ready' && !DONE_FEATURE.includes(String(f.Status ?? '').toLowerCase());
  }
  if (row.db !== 'Development/Issue') return false;
  if ((f.Status ?? 'Open') === 'Fixed') return false;
  if (SKIP_AREAS.includes(areaOf(row))) return false;
  if (f.Agent === 'No' || f.Agent === 'Needs Kyle') return false;
  if (filled(f.Instance) && f.Agent !== 'Ready') return false;
  const last = parseAttempts(docOf(row)).at(-1);
  if (liveClaim(last, now, CLAIM_HOURS)) return false;
  if (last && last.outcome !== 'fixed') return changedSinceLastAttempt(row);
  return true;
}
