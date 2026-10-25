#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PROBE_QUESTION, PROBE_UNANSWERED } from '../src/bugreport.js';

export const BREAKPOINTS = [480, 600, 700, 900];
export const BASELINE = /^test\/(?!byte-budget\.json$)[^/]+-(?:baseline|budget)\.json$|^test\/flicker-fixed\.json$/;
export const PROBES_LIB = ['clicks', 'cutoff', 'feedback', 'flicker', 'journeys', 'overlays', 'renders', 'states', 'vitals']
  .map((n) => `test/lib/${n}.mjs`);
export const SOURCE_RULES = [
  'architecture-map', 'brand-kit', 'form-control-classes', 'hover-touch', 'icon-registry',
  'no-inline-comments', 'outside-dismiss', 'phone-no-zoom', 'surface-palette', 'type-scale',
].map((n) => `test/${n}.test.mjs`);
export const RULE_CLASSES = {
  'Touch repeats': /44\s?px|44x44|touch target|hit area|tap target|finger-sized/i,
  'Cut-off repeats': /cut[- ]?off|\bcut\b|clip|truncat|ellips|overflow|\bin full\b/i,
  'Alignment repeats': /\balign|centred|centered|lines? up|off[- ]cent/i,
};
const PROBE_LABELS = { cutoff: 'Cut-off', flicker: 'Flicker', budgets: 'Budgets', a11y: 'A11y', touch: 'Touch' };
const DECLARATION = /(?:^|[;{\s])((?:margin|padding)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap|z-index)\s*:\s*([^;{}]+)/g;

const share = (n, d) => (d ? Math.round((n / d) * 10000) / 10000 : null);
const isRevert = (c) => /^Revert "|^sheriff: revert\b/i.test(c.subject);
const isUiFix = (c) => !isRevert(c) && /\bIssues? #\d+/.test(c.subject) && c.files.some((f) => /^public\/(?!vendor\/)/.test(f));
const isClassWide = (c) => c.files.some((f) => BASELINE.test(f) || PROBES_LIB.includes(f) || SOURCE_RULES.includes(f));

export function parseLog(text) {
  const commits = [];
  for (const line of text.split('\n')) {
    const head = line.match(/^@@ (\S+) (\S+) (.*)$/);
    if (head) commits.push({ sha: head[1], date: head[2], subject: head[3], files: [] });
    else if (line.trim() && commits.length) commits.at(-1).files.push(line.trim());
  }
  return commits;
}

export function commitsSince(root, since) {
  return parseLog(execFileSync('git', ['-C', root, 'log', 'HEAD', '--first-parent', '--diff-merges=first-parent',
    `--since=${since.toISOString()}`, '--format=@@ %H %cI %s', '--name-only'], { encoding: 'utf8', maxBuffer: 64 << 20 }));
}

export function history(commits) {
  const ui = commits.filter(isUiFix);
  const classWide = ui.filter(isClassWide).length;
  return {
    'UI fixes': ui.length,
    'Class-wide fixes': classWide,
    'Generalization rate': share(classWide, ui.length),
    ...Object.fromEntries(Object.entries(RULE_CLASSES).map(([k, re]) => [k, ui.filter((c) => re.test(c.subject)).length])),
    Reverts: commits.filter(isRevert).length,
  };
}

export function tokenShares(cssTexts) {
  const out = { spacing: { declarations: 0, onTokens: 0 }, zIndex: { declarations: 0, onTokens: 0 } };
  for (const css of cssTexts) {
    for (const [, prop, value] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(DECLARATION)) {
      const bucket = prop === 'z-index' ? out.zIndex : out.spacing;
      bucket.declarations++;
      if (/var\(--/.test(value)) bucket.onTokens++;
    }
  }
  return out;
}

export const widthsIn = (src) => [...src.matchAll(/viewport:\s*\{\s*width:\s*(\d+)/g)].map((m) => Number(m[1]));
export const bandsCovered = (widths) => new Set(widths.map((w) => BREAKPOINTS.filter((b) => w >= b).length)).size;

export function probeSources(root) {
  const files = [...readdirSync(join(root, 'test')).map((f) => `test/${f}`), ...readdirSync(join(root, 'scripts')).map((f) => `scripts/${f}`)]
    .filter((f) => f.endsWith('.mjs'));
  const out = new Set();
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    if (!/lib\/states\.mjs['"]/.test(src)) continue;
    out.add(f);
    for (const [, lib] of src.matchAll(/from '(?:\.\/|\.\.\/test\/)lib\/([\w-]+\.mjs)'/g)) out.add(`test/lib/${lib}`);
  }
  return [...out].map((f) => readFileSync(join(root, f), 'utf8'));
}

export function entriesOf(json) {
  if (!json) return 0;
  if (json.linux) return Object.keys(json.linux).length;
  if (json.violations) return Object.keys(json.violations).length;
  return Object.keys(json).filter((k) => k !== '_').length;
}

export function ceilings({ cutoff, a11y, touchBaseline, states }) {
  const touchIssues = new Set(states.STATES.flatMap((s) => Object.entries(s.hold ?? {})
    .filter(([k]) => k === 'touch' || k.startsWith('touch|')).flatMap(([, ids]) => ids)));
  const heldPairs = new Set(Object.keys(states.PROBES).flatMap((p) => states.held(p).map((e) => `${p}\u0000${e.state.name}`)));
  return {
    'Cut-off instances': Object.values(cutoff?.linux ?? {}).reduce((a, n) => a + n, 0),
    'Cut-off fingerprints': entriesOf(cutoff),
    'A11y entries': entriesOf(a11y),
    'Touch holds': touchIssues.size,
    'Touch baseline entries': entriesOf(touchBaseline),
    'Held states': heldPairs.size,
  };
}

export function coverage({ STATES, PROBES, walked }) {
  return Object.fromEntries(Object.keys(PROBES).map((p) => [
    `${PROBE_LABELS[p] ?? p} coverage`,
    share(new Set(walked(p).map((e) => e.state)).size, STATES.length),
  ]));
}

export function seededTypes(seeds, make) {
  const types = new Set();
  for (const seed of Object.values(seeds)) {
    const w = make();
    const { createTable, addField, addRelation } = w;
    w.createTable = (...a) => (types.add('text'), createTable.apply(w, a));
    w.addField = (t, f, ...a) => (types.add(f.type), addField.call(w, t, f, ...a));
    w.addRelation = (...a) => (types.add('relation'), addRelation.apply(w, a));
    seed(w);
  }
  return types;
}

export function answerOf(md) {
  const heading = `## ${PROBE_QUESTION}`;
  const at = String(md ?? '').indexOf(heading);
  if (at < 0) return null;
  const answer = md.slice(at + heading.length).split(/\n## /)[0].trim();
  return !answer || answer === PROBE_UNANSWERED || answer.startsWith('_Unanswered') ? null : answer;
}

export function probeAnswers(rows, { since }) {
  if (!rows) return { 'Probe answers': null, 'Probe answers none': null };
  const answers = rows.filter((r) => new Date(r.updatedAt) >= since).map((r) => answerOf(r.fields?.Description ?? r.doc)).filter(Boolean);
  return {
    'Probe answers': answers.length,
    'Probe answers none': answers.filter((a) => /^none\b/i.test(a.replace(/[*_`]/g, '').trim())).length,
  };
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const json = (root, file) => (existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), 'utf8')) : null);

export async function scorecard(root, { now = new Date(), days = 7, issues = null } = {}) {
  const since = new Date(now - days * 86400000);
  const states = await import(pathToFileURL(join(root, 'test/lib/states.mjs')));
  const { Weave } = await import(pathToFileURL(join(root, 'src/engine.js')));
  const types = seededTypes(states.SEEDS, () => new Weave());
  const css = readdirSync(join(root, 'public')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(root, 'public', f), 'utf8'));
  const tokens = tokenShares(css);
  return {
    Name: isoWeek(now),
    Measured: now.toISOString().slice(0, 10),
    Commit: execFileSync('git', ['-C', root, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim(),
    ...history(commitsSince(root, since)),
    ...coverage(states),
    'Field types seeded': types.size,
    'Width bands covered': bandsCovered(probeSources(root).flatMap(widthsIn)),
    ...ceilings({ cutoff: json(root, 'test/cutoff-baseline.json'), a11y: json(root, 'test/a11y-baseline.json'), touchBaseline: json(root, 'test/touch-baseline.json'), states }),
    'Spacing on tokens': share(tokens.spacing.onTokens, tokens.spacing.declarations),
    'Z-index on tokens': share(tokens.zIndex.onTokens, tokens.zIndex.declarations),
    ...probeAnswers(issues, { since }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { days: { type: 'string', default: '7' }, issues: { type: 'string' }, now: { type: 'string' } } });
  const loaded = a.issues ? JSON.parse(readFileSync(a.issues, 'utf8')) : null;
  const issues = loaded ? (Array.isArray(loaded) ? loaded : loaded.items) : null;
  const row = await scorecard(resolve(dirname(fileURLToPath(import.meta.url)), '..'), { now: a.now ? new Date(a.now) : new Date(), days: Number(a.days), issues });
  console.log(JSON.stringify(row));
}
