import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { TREND } from '../scripts/ci-test.mjs';

const NOW = /\b(?:performance|Date)\.now\(\)/;
const TIMEISH = /^(?:ms|elapsed|\w+Ms|\w+_MS)$/;
const ASSIGN = /\b([A-Za-z_$][\w$]*)(?:\[[^\]]*\]|\.[\w$]+)*\s*(?:=(?![=>])|\.push\()/g;
const UPPER = /([\w$.[\]()\s+\-*/]+?)\s*<=?\s*(?:[\d_]+|[A-Z][A-Z_]*)\b/g;

export function clockNames(source) {
  const lines = source.split('\n');
  const names = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const line of lines) {
      const ids = line.match(/[A-Za-z_$][\w$]*/g) ?? [];
      const timed = NOW.test(line) || ids.some((id) => names.has(id));
      if (!timed) continue;
      for (const m of line.matchAll(ASSIGN)) {
        const rhs = line.slice(m.index + m[0].length);
        const rhsIds = rhs.match(/[A-Za-z_$][\w$]*/g) ?? [];
        if ((NOW.test(rhs) || rhsIds.some((id) => names.has(id))) && !names.has(m[1])) { names.add(m[1]); grew = true; }
      }
    }
  }
  return names;
}

export function upperClockBounds(source) {
  const names = clockNames(source);
  const found = [];
  source.split('\n').forEach((line, i) => {
    if (!/\bassert\b/.test(line)) return;
    for (const m of line.matchAll(UPPER)) {
      const left = m[1].split(/&&|\|\||[(,!]/).at(-1);
      if (left.trim().endsWith(')')) continue;
      const ids = left.match(/[A-Za-z_$][\w$]*/g) ?? [];
      if (NOW.test(left) || /\.ms\b/.test(left) || ids.some((id) => names.has(id) || TIMEISH.test(id))) found.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return found;
}

export const KNOWN = [
  { file: 'test/file-index.test.mjs', text: 'ms < 20', issue: 1933 },
  { file: 'test/update-check.test.mjs', text: 'Date.now() - t < 20', issue: 1933 },
  { file: 'test/space-home-paint-browser.test.mjs', text: 'ms < DELAY * 1.6', issue: 1933 },
  { file: 'test/serve-shutdown.test.mjs', text: 'took < 5000', issue: 1933 },
  { file: 'test/supervisor.test.mjs', text: 'Date.now() - closedAt < 5000', issue: 1933 },
  { file: 'test/supervisor.test.mjs', text: "Date.now() - started < 10_000, 'the refusal came from the health timeout'", issue: 1933 },
  { file: 'test/supervisor.test.mjs', text: 'Date.now() - started < 10_000, `refused after', issue: 1933 },
];
export const NOT_CLOCK = [
  { file: 'test/drag-reorder-browser.test.mjs', text: 'ms >= 150 && ms <= 200', why: 'reads the computed CSS transition duration, not a clock' },
  { file: 'test/flicker-probe-browser.test.mjs', text: 'c[0].ms > 0 && c[0].ms <= 300', why: 'reads the time left on the running slide transition, which its 300 ms duration caps' },
];

test('the scan names an upper bound on a clock reading and passes a count or a lower bound', () => {
  assert.equal(upperClockBounds('const t = performance.now();\nwork();\nconst ms = performance.now() - t;\nassert.ok(ms < 120);').length, 1);
  assert.equal(upperClockBounds('const started = Date.now();\nassert.ok(Date.now() - started < 10_000);').length, 1);
  assert.equal(upperClockBounds('times.push(performance.now() - t);\nconst p95 = times[19];\nassert.ok(p95 < 30);').length, 1);
  assert.equal(upperClockBounds('assert.ok(t[0].ms > 0 && t[0].ms < 150);').length, 1);
  assert.equal(upperClockBounds('const ms = Math.round(m.peek - m.down);\nassert.ok(ms <= PRESS_BUDGET_MS);').length, 1);
  assert.equal(upperClockBounds('const t = Date.now();\nawait wait();\nassert.ok(Date.now() - t >= 400);').length, 0);
  assert.equal(upperClockBounds('assert.ok(visits.ids.size < 200);').length, 0);
  assert.equal(upperClockBounds('const painted = Date.now() - t0;\nconst before = calls.filter((c) => c.end <= painted);\nassert.ok(depth(before) <= 1);').length, 0);
});

test('no gating test asserts an upper bound on a wall-clock reading; that reading belongs in the trend lane (Issue #1768)', () => {
  const files = readdirSync('test').filter((f) => f.endsWith('.test.mjs') && f !== basename(import.meta.filename)).map((f) => `test/${f}`).filter((f) => !TREND.includes(f));
  const listed = [...KNOWN, ...NOT_CLOCK];
  const hits = files.flatMap((f) => upperClockBounds(readFileSync(f, 'utf8')).map((line) => ({ f, line })));
  const found = hits.filter((h) => !listed.some((k) => k.file === h.f && h.line.includes(k.text))).map((h) => `${h.f}:${h.line}`);
  assert.deepEqual(found, [], 'count the work or assert event order instead of milliseconds on a shared runner');
  const stale = listed.filter((k) => !hits.some((h) => h.f === k.file && h.line.includes(k.text)));
  assert.deepEqual(stale, [], 'a listed assertion is gone: drop its entry');
});
