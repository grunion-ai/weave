#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { exerciseSpace, httpApi } from './template-exercise-core.mjs';

const pad = (n) => String(n).padStart(2, '0');
export const stampOf = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function table(rows) {
  const head = ['where', 'table', 'fields', 'relations', 'computed', 'ok'];
  const cells = [head, ...rows.map((r) => [r.where, r.table, String(r.fields), String(r.relations), String(r.computed), r.ok ? 'ok' : 'FAIL'])];
  const widths = head.map((_, i) => Math.max(...cells.map((c) => c[i].length)));
  return cells.map((c) => c.map((x, i) => x.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

export async function runLive({ base, from = 'weave', into = 'test', stamp = stampOf(), keep = false, headers = {}, log = console.log } = {}) {
  const root = base.replace(/\/+$/, '');
  const suffix = randomBytes(2).toString('hex');
  const src = httpApi(`${root}/w/${from}`, { headers });
  const dst = httpApi(`${root}/w/${into}`, { headers });
  const templates = await src.call('GET', '/api/templates');
  const results = [];
  if (!templates.length) log(`${from} has no template spaces`);
  for (const tpl of templates) {
    const result = { template: tpl.name, copy: null, reports: [], failures: [], cleanup: null };
    results.push(result);
    for (const r of await exerciseSpace(src, tpl.name, { label: tpl.name, tag: stamp })) result.reports.push({ where: from, ...r });
    const copyName = `${tpl.name} check ${stamp} ${suffix}`;
    let made = null;
    try {
      const used = await src.call('POST', `/api/spaces/${encodeURIComponent(tpl.id)}/use`, { workspace: into, name: copyName });
      made = used.space;
      result.copy = { name: made.name, id: made.id, url: used.url, skipped: used.skipped ?? [] };
      for (const s of used.skipped ?? []) result.failures.push(`${tpl.name}: Use template left ${s.table}.${s.field} behind`);
      const copied = (await dst.schema()).find((s) => s.space === copyName);
      const srcTables = (await src.schema()).find((s) => s.space === tpl.name)?.tables.map((t) => t.name);
      const dstTables = copied?.tables.map((t) => t.name);
      if (JSON.stringify(srcTables) !== JSON.stringify(dstTables)) {
        result.failures.push(`${tpl.name}: the copy in ${into} has tables ${JSON.stringify(dstTables)}, the template ${JSON.stringify(srcTables)}`);
      }
      for (const r of await exerciseSpace(dst, copyName, { label: `${into}/${copyName}`, tag: stamp })) result.reports.push({ where: into, ...r });
    } catch (err) {
      result.failures.push(`${tpl.name}: Use template into ${into} failed: ${err.message}`);
    } finally {
      if (made && keep) {
        result.cleanup = `copy '${made.name}' kept in ${into} (--keep)`;
      } else if (made) {
        try {
          await dst.call('DELETE', `/api/spaces/${encodeURIComponent(made.id)}?hard=1`);
          result.cleanup = `copy '${made.name}' purged from ${into}`;
        } catch (err) {
          result.failures.push(`${tpl.name}: purging the copy '${made.name}' failed: ${err.message}`);
        }
      }
    }
    for (const r of result.reports) result.failures.push(...r.failures);
    log(`\n${tpl.name}${result.copy ? ` → ${into}/${result.copy.name}` : ''}`);
    log(table(result.reports));
    for (const r of result.reports) for (const n of r.notes) log(`  note (${r.where} ${r.table}): ${n}`);
    for (const r of result.reports) for (const s of r.skipped) log(`  skipped (${r.where} ${r.table}): ${s.field}, a ${s.type} field the exercise has no sample for`);
    if (result.cleanup) log(`  ${result.cleanup}`);
    for (const f of result.failures) log(`  FAIL ${f}`);
  }
  const ok = results.every((r) => r.failures.length === 0);
  return { ok, results };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (key, fallback) => {
    const i = process.argv.indexOf(key);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const token = process.env.WEAVE_TOKEN;
  const { ok } = await runLive({
    base: arg('--base', 'http://127.0.0.1:4400'),
    from: arg('--from', 'weave'),
    into: arg('--into', 'test'),
    keep: process.argv.includes('--keep'),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  console.log(ok ? '\nevery template passed' : '\ntemplate exercise FAILED');
  process.exit(ok ? 0 : 1);
}
