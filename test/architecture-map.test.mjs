import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'architecture');

const spec = JSON.parse(readFileSync(join(DIR, 'weave.architecture.json'), 'utf8'));
const html = readFileSync(join(DIR, 'weave.architecture.html'), 'utf8');
const sources = spec.components.flatMap((c) => (c.sources ?? []).map((s) => ({ id: c.id, ...s })));

const embedded = (id) => {
  const m = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
  assert.ok(m, `the HTML carries no #${id} block: re-render with node scripts/architecture.mjs`);
  return JSON.parse(m[1]);
};

test('the map is pinned to a commit in this repository', () => {
  const { url, revision } = spec.meta.repository;
  assert.equal(url, 'https://github.com/grunion-ai/weave');
  assert.match(revision, /^[0-9a-f]{40}$/);
  assert.doesNotThrow(
    () => execFileSync('git', ['-C', ROOT, 'merge-base', '--is-ancestor', revision, 'HEAD'], { stdio: 'ignore' }),
    `pinned revision ${revision} is not an ancestor of HEAD`,
  );
});

test('every cited source file still exists', () => {
  assert.ok(sources.length > 0);
  const missing = sources.filter((s) => !existsSync(join(ROOT, s.path))).map((s) => `${s.id}: ${s.path}`);
  assert.deepEqual(missing, [], 'the map cites files that moved or were deleted: update the map and re-pin');
});

test('every runtime module is named in the map', () => {
  const text = JSON.stringify(spec);
  const modules = [
    ...readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
    ...readdirSync(join(ROOT, 'bin')).filter((f) => f.endsWith('.js')).map((f) => `bin/${f}`),
  ];
  const unnamed = modules.filter((m) => !text.includes(m));
  assert.deepEqual(unnamed, [], 'new modules need a place on the map (a component source or a card line)');
});

test('the HTML was rendered from the JSON beside it', () => {
  assert.match(html, /<meta name="generator" content="archify [\d.]+">/);
  assert.ok(html.includes(`<title>${spec.meta.title} Diagram</title>`), 'HTML title differs from meta.title');
  const evidence = embedded('archify-source-evidence-data');
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.revision, spec.meta.repository.revision, 'HTML is pinned to a different revision');
  const cite = (id, s) => `${id} ${s.path}:${s.line ?? ''}`;
  const rendered = Object.entries(evidence.nodes).flatMap(([id, list]) => list.map((s) => cite(id, s)));
  assert.deepEqual(rendered.sort(), sources.map((s) => cite(s.id, s)).sort(), 'HTML cites different sources');
  assert.deepEqual(embedded('archify-guided-views-data'), spec.meta.views, 'HTML carries different guided views');
  for (const c of spec.components) assert.ok(html.includes(`<title>${c.label} · `), `HTML has no node for ${c.id}`);
});
