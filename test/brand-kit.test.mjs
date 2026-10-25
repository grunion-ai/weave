import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDir } from './lib/temp.mjs';

const KIT = fileURLToPath(new URL('../brand/kit/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(KIT, 'manifest.json'), 'utf8'));
const labels = JSON.parse(readFileSync(join(KIT, 'labels.json'), 'utf8'));
const svgOf = (a) => readFileSync(join(KIT, a.svg), 'utf8');
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const rendered = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const readmeSection = (title) => readFileSync(join(KIT, 'README.md'), 'utf8').split(`\n## ${title}\n`)[1].split('\n## ')[0];
const RING_WORDS_ABSENT = new Set(['badge-small', 'badge-small-ink', 'badge-release', 'badge-footer-light', 'badge-footer-dark']);

test('every manifest asset has its SVG and PNG, and every SVG is listed', () => {
  for (const a of manifest.assets) {
    assert.ok(existsSync(join(KIT, a.svg)), `${a.svg} missing`);
    assert.ok(existsSync(join(KIT, a.png)), `${a.png} missing; run node brand/kit/render-kit-png.mjs`);
  }
  const listed = new Set(manifest.assets.map((a) => a.svg));
  for (const f of readdirSync(join(KIT, 'svg'))) assert.ok(listed.has(`svg/${f}`), `svg/${f} is not in manifest.json`);
});

test('every asset names its code, ground and where it goes', () => {
  for (const a of manifest.assets) {
    assert.match(a.code, /^[BILXM]\d+[a-z]?$/, `${a.id} code`);
    assert.ok(a.ground, `${a.id} has no ground in guide.json`);
    assert.ok(a.use.length > 0, `${a.id} has no use in guide.json`);
  }
});

test('every badge with ring type carries the chosen words', () => {
  const { top, bottom } = manifest.badgeWords;
  assert.equal(top, 'DATA · AGENTS');
  assert.equal(bottom, 'SYSTEMS');
  const ringed = manifest.assets.filter((a) => a.family === 'badge' && !RING_WORDS_ABSENT.has(a.id));
  assert.ok(ringed.length >= 10);
  for (const a of ringed) {
    const s = svgOf(a);
    assert.ok(s.includes(`>${top}</textPath>`) && s.includes(`>${bottom}</textPath>`), `${a.id} lacks the badge words`);
  }
});

test('assets place the canonical mark files instead of redrawing the mark', () => {
  const placed = manifest.assets.filter((a) => a.family !== 'icon' && a.id !== 'badge-release');
  for (const a of placed) assert.match(svgOf(a), /<mask id="m\d+A"/, `${a.id} does not embed a canonical mark file`);
});

test('the kit carries the inline and stacked lockups, each placing the canonical lockup file', () => {
  const lockups = manifest.assets.filter((a) => a.family === 'lockup');
  assert.deepEqual(lockups.map((a) => a.id).sort(), ['lockup-dark', 'lockup-light', 'lockup-stacked-dark', 'lockup-stacked-light']);
  for (const a of lockups) {
    const file = a.id.replace('lockup-', 'weave-lockup-') + '.svg';
    const canonical = readFileSync(join(KIT, '..', 'assets', file), 'utf8');
    const word = canonical.match(/<path d="(M28\.1 0[^"]+)"/)[1];
    assert.ok(svgOf(a).includes(word), `${a.id} draws the outlined wordmark from ${file}`);
    assert.ok(!svgOf(a).includes('<text'), `${a.id} has no live text`);
    const [, , vw, vh] = canonical.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    assert.equal(a.height, Math.round(a.width * vh / vw), `${a.id} keeps the lockup's shape`);
  }
});

test('every PNG is rendered at the scale the manifest states, and no scale is under 2x', () => {
  for (const a of manifest.assets) {
    assert.ok(Number.isInteger(a.scale) && a.scale >= 2, `${a.id} renders at ${a.scale}x`);
    assert.deepEqual(pngSize(join(KIT, a.png)), [a.width * a.scale, a.height * a.scale], `${a.png} is not ${a.scale}x of ${a.width} × ${a.height}`);
  }
  const by = (family) => manifest.assets.find((a) => a.family === family).scale;
  assert.deepEqual([by('icon'), by('lockup'), by('badge'), by('poster'), by('pattern')], [4, 3, 2, 2, 2]);
});

test('the kit carries the 1280 × 640 GitHub social preview with its own line', () => {
  const a = manifest.assets.find((x) => x.id === 'poster-github');
  assert.equal(a.family, 'poster');
  assert.deepEqual([a.width, a.height], [1280, 640]);
  assert.ok(svgOf(a).includes(`>${labels.githubLine}</text>`), 'poster-github draws labels.githubLine');
  assert.ok(a.use.some((u) => /GitHub/.test(u)), 'guide.json names the GitHub use');
});

test('the kit page shows every asset with its files and pixel sizes, and carries the README recipes and rules', () => {
  const page = readFileSync(join(KIT, 'index.html'), 'utf8');
  for (const a of manifest.assets) {
    assert.ok(page.includes(`href="${a.svg}"`), `${a.id} links its SVG`);
    assert.ok(page.includes(`href="${a.png}"`), `${a.id} links its PNG`);
    assert.ok(page.includes(`${a.width} × ${a.height}`), `${a.id} states its size`);
    assert.ok(page.includes(`${a.width * a.scale} × ${a.height * a.scale}`), `${a.id} states its PNG pixel size`);
    assert.ok(page.includes(`>${a.code}<`), `${a.id} shows its code`);
  }
  const recipes = readmeSection('Recipes').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Need') && !l.startsWith('| ---'));
  assert.ok(recipes.length >= 15);
  for (const r of recipes) assert.ok(page.includes(rendered(r.split('|')[1].trim())), `recipe missing from the page: ${r.slice(0, 40)}`);
  const rules = readmeSection('Rules').split('\n').filter((l) => l.startsWith('- '));
  assert.equal(rules.length, 5);
  for (const r of rules) assert.ok(page.includes(rendered(r.slice(2)).slice(0, 40)), `rule missing from the page: ${r.slice(0, 40)}`);
  assert.ok(page.includes(`>${manifest.badgeWords.top}<`) && page.includes(`>${manifest.badgeWords.bottom}<`), 'the page states the badge words');
});

test('the kit README lists every asset', () => {
  const readme = readFileSync(join(KIT, 'README.md'), 'utf8');
  for (const a of manifest.assets) assert.ok(readme.includes(`\`${a.id}\``), `${a.id} is missing from brand/kit/README.md`);
});

test('the committed kit matches a fresh build', () => {
  const tmp = tempDir('weave-kit-');
  execFileSync(process.execPath, [join(KIT, 'build-kit.mjs'), '--out', tmp], { stdio: 'pipe' });
  assert.equal(readFileSync(join(tmp, 'manifest.json'), 'utf8'), readFileSync(join(KIT, 'manifest.json'), 'utf8'));
  assert.equal(readFileSync(join(tmp, 'index.html'), 'utf8'), readFileSync(join(KIT, 'index.html'), 'utf8'), 'index.html drifted from build-kit.mjs');
  for (const f of readdirSync(join(tmp, 'svg'))) {
    assert.equal(readFileSync(join(tmp, 'svg', f), 'utf8'), readFileSync(join(KIT, 'svg', f), 'utf8'), `svg/${f} drifted from build-kit.mjs`);
  }
});
