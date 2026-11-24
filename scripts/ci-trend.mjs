import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TREND } from './ci-test.mjs';
import { probe, realIO as edgeIO } from './edge-probe.mjs';
import { TRACKER, alertRequest, short } from './sheriff.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const SUSTAINED = 3;
export const SUITES = {
  'test/feedback-budget-browser.test.mjs': 'feedback',
  'test/query-volume.test.mjs': 'query-volume',
  'test/render-budget-browser.test.mjs': 'renders',
  'test/vitals-budget-browser.test.mjs': 'vitals',
};
export const NOTE_LOG = `Trend note kept by the budgets workflow (scripts/ci-trend.mjs). This reading is taken on a shared GitHub runner and judged in the trend lane, never on a gate. A line is written when a run of misses starts and when it lasts ${SUSTAINED} main pushes; every reading of every run is in that run's trend-series artifact. One miss among holds is the runner; a run of misses is a regression to fix in the page, not a budget to raise.`;

const READING = /^# (?<suite>feedback|renders|vitals) (?<key>\S+) fastest (?<value>\S+)(?: ms)? median \S+(?: ms)? runs (?<runs>\S+) budget (?<budget>\S+)/;
const RATIO = /^# (?<suite>query-volume) (?<key>.+?) p50 .*, ratio (?<value>\S+)x, ceiling (?<budget>\S+)x$/;
const RESULT = /^(not )?ok \d+ - (.+?)(?: # (?:SKIP|TODO)\b.*)?$/;

const idOf = (r) => `${r.suite} ${r.key}`;
const over = (value, budget) => budget === null || value > budget;
const missed = (r) => over(r.value, r.budget);
const pushes = (n) => `${n} push${n === 1 ? '' : 'es'}`;
const runOf = (m) => `${m.streak === 1 ? 'a new miss' : `${m.streak} main pushes in a row`}${m.gaps ? `, across ${pushes(m.gaps)} that kept no reading` : ''}`;

export function readingOf(line) {
  const { suite, key, value, budget, runs } = (READING.exec(line) ?? RATIO.exec(line))?.groups ?? {};
  if (!suite || !Number.isFinite(Number(value))) return null;
  return { suite, key, value: Number(value), budget: budget === 'none' ? null : Number(budget), ...(runs ? { runs: runs.split(',').map(Number) } : {}) };
}

export function readTap(text) {
  const tests = new Map();
  const readings = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const result = RESULT.exec(line);
    if (result) {
      current = { name: result[2].replaceAll('\\#', '#'), pass: !result[1], readings: [] };
      tests.set(current.name, current);
      continue;
    }
    const reading = readingOf(line);
    if (!reading) continue;
    readings.push(reading);
    current?.readings.push(reading);
  }
  return { tests: [...tests.values()], readings };
}

const newestFirst = (history, run) => history.filter((p) => String(p.run) !== String(run)).sort((a, b) => Number(b.run) - Number(a.run));

function walk(reading, history, run) {
  let streak = 1;
  let gaps = 0;
  for (const point of newestFirst(history, run)) {
    if (point.gap) { gaps++; continue; }
    const past = (point.readings ?? []).find((r) => idOf(r) === idOf(reading));
    if (!past) continue;
    if (!over(past.value, reading.budget)) break;
    streak++;
  }
  return { streak, gaps };
}

export const streakOf = (reading, history, run) => walk(reading, history, run).streak;
export const gapsWithin = (reading, history, run) => walk(reading, history, run).gaps;

export function judge({ tests, readings }, { code = 0, history = [], run } = {}) {
  const best = new Map();
  for (const r of readings) if (!best.has(idOf(r)) || r.value < best.get(idOf(r)).value) best.set(idOf(r), r);
  const kept = [...best.values()];
  const faults = [
    ...Object.values(SUITES).filter((suite) => !kept.some((r) => r.suite === suite)).map((suite) => `the trend lane read no ${suite} budget: its suite recorded nothing`),
    ...tests.filter((t) => !t.pass && !t.readings.some(missed)).map((t) => `${t.name} failed without a budget miss`),
  ];
  if (code && !tests.some((t) => !t.pass)) faults.push(`the trend suites exited ${code} with no failing test`);
  return { readings: kept, misses: kept.filter(missed).map((r) => ({ ...r, ...walk(r, history, run) })), faults };
}

export const noteSymptom = (r) => (r.suite === 'renders' || r.key.endsWith('|cls') ? 'Looks broken' : 'Slow');
export const noteName = (r) => `${noteSymptom(r)}: ${idOf(r)} over its budget on main`;
export const noteLine = (m, point, url) => `${point.at} ${short(point.commit)} read ${m.value} against a budget of ${m.budget ?? 'none'}, ${runOf(m)}${url ? `: ${url}` : ''}`;

export async function trend(io) {
  const { code, text } = await io.suites();
  const point = { commit: io.commit, run: io.run, attempt: io.attempt, at: io.now() };
  const tap = readTap(text);
  const edge = await io.edge();
  const history = io.history();
  const { readings, misses, faults } = judge({ ...tap, readings: [...tap.readings, ...edge.readings] }, { code, history, run: io.run });
  io.write({ ...point, readings });
  for (const line of edge.skipped) io.log(`::warning::edge probe recorded nothing: ${line}`);
  const tail = io.url ? ` ${io.url}` : '';
  const counted = misses.length ? `${misses.length} of ${readings.length} readings over budget, kept as trend notes, not a red gate` : `${readings.length} readings inside their budgets`;
  const verdict = faults.length ? `trend lane broken (${faults.length} fault${faults.length === 1 ? '' : 's'}): ${counted}` : `timing budgets: ${counted}`;
  io.log(verdict);
  io.summary(`${verdict}${tail}`);
  const earlier = newestFirst(history, io.run);
  const gaps = earlier.filter((p) => p.gap);
  if (gaps.length) {
    const said = `${gaps.length} of the last ${earlier.length} main pushes kept no trend reading (${gaps.map((p) => `${p.run}: ${p.gap}`).join(', ')})`;
    io.log(`::warning title=Trend gap::${said}`);
    io.summary(`- ${said}`);
  }
  for (const m of misses) {
    const said = `${idOf(m)} read ${m.value} against a budget of ${m.budget ?? 'none'}, ${runOf(m)}`;
    io.log(`::warning title=Trend note::${said}`);
    io.summary(`- ${said}`);
    try {
      await io.note({ name: noteName(m), symptom: noteSymptom(m), line: noteLine(m, point, io.url), quiet: m.streak !== 1 && m.streak !== SUSTAINED });
    } catch (error) {
      io.log(`::warning::trend note not filed for ${idOf(m)}: ${error.message}`);
    }
  }
  for (const r of edge.readings) {
    const said = `${idOf(r)} ${r.value} ms (runs ${r.runs.join(', ')}, budget ${r.budget} ms)`;
    io.log(said);
    io.summary(`- ${said}`);
  }
  const sustained = misses.filter((m) => m.streak === SUSTAINED);
  if (sustained.length) {
    try {
      await io.alert(`weave budgets: ${sustained.map((m) => `${idOf(m)} over its budget on ${SUSTAINED} main pushes in a row`).join('; ')}${tail}`);
    } catch (error) {
      io.log(`::warning::alert not sent: ${error.message}`);
    }
  }
  for (const fault of faults) {
    io.log(`::error::${fault}`);
    io.summary(`- trend lane fault: ${fault}`);
  }
  return faults.length ? 1 : 0;
}

export function gap(io, reason) {
  if (io.kept()) return 0;
  io.write({ commit: io.commit, run: io.run, attempt: io.attempt, at: io.now(), readings: [], gap: reason });
  io.log(`::error title=Trend gap::this run kept no trend reading: ${reason}. The next runs count it as a gap in every streak.`);
  io.summary(`- trend gap: this run kept no trend reading (${reason})${io.url ? ` ${io.url}` : ''}`);
  return 0;
}

export async function fileNote(env, { name, symptom, line, quiet }, fetchImpl = fetch) {
  if (!env.WEAVE_TRACKER_TOKEN) throw new Error(`WEAVE_TRACKER_TOKEN missing; not filed: ${name}`);
  const base = `${(env.WEAVE_TRACKER_URL || TRACKER).replace(/\/$/, '')}/api`;
  const call = async (path, body) => {
    const res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WEAVE_TRACKER_TOKEN}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`tracker ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const rows = ((await call('/tables/Issue/query', { where: [['Name', '=', name]] })).items ?? []).sort((a, b) => b.publicId - a.publicId);
  const open = rows.find((r) => r.fields?.Status !== 'Fixed');
  if (open) return quiet ? open : call(`/entities/${open.id}/doc`, { doc: `\n\n${line}` });
  if (!rows.length) return call('/tables/Issue/entities', { Name: name, Severity: 'Low', Symptom: [symptom], Description: `${NOTE_LOG}\n\n${line}` });
  await call(`/entities/${rows[0].id}/doc`, { doc: `\n\n${line}\n\nReopened by the budgets workflow: this reading missed its budget again after the row was marked Fixed.` });
  return call(`/entities/${rows[0].id}/state`, { field: 'Status', state: 'Open' });
}

export function readHistory(dir) {
  if (!dir) return [];
  let names;
  try { names = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json')); }
  catch { return []; }
  return names.flatMap((name) => {
    try {
      const point = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      return Array.isArray(point?.readings) ? [point] : [];
    } catch { return []; }
  });
}

export const suiteEnv = ({ WEAVE_TRACKER_TOKEN, SHERIFF_ALERT_URL, SHERIFF_ALERT_TOKEN, ...rest }) => rest;

function runSuites(env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/test.mjs', '--targeted', '--timeout=1200000', ...TREND], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], env: suiteEnv(env) });
    let text = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { process.stdout.write(chunk); text += chunk; });
    child.on('close', (code) => done({ code: code ?? 1, text }));
  });
}

export function realIO(env = process.env) {
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    run: env.GITHUB_RUN_ID ?? 'local',
    attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1),
    url: env.GITHUB_RUN_ID ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '',
    now: () => new Date().toISOString(),
    suites: () => runSuites(env),
    edge: () => probe(edgeIO()),
    history: () => readHistory(env.WEAVE_TREND_HISTORY),
    kept: () => !!env.WEAVE_TREND_SERIES && existsSync(join(env.WEAVE_TREND_SERIES, 'series.json')),
    write: (point) => {
      if (!env.WEAVE_TREND_SERIES) return;
      mkdirSync(env.WEAVE_TREND_SERIES, { recursive: true });
      writeFileSync(join(env.WEAVE_TREND_SERIES, 'series.json'), `${JSON.stringify(point, null, 2)}\n`);
    },
    note: (note) => fileNote(env, note),
    alert: async (alert) => {
      if (env.SHERIFF_ALERT_URL) await fetch(env.SHERIFF_ALERT_URL, alertRequest(env, alert));
    },
    log: (line) => console.log(line),
    summary: (line) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) (process.argv[2] === '--gap' ? Promise.resolve(gap(realIO(), process.argv[3] || 'the run stopped before its readings')) : trend(realIO())).then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 1; });
