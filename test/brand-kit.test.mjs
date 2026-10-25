import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = fileURLToPath(new URL('../brand/kit/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(KIT, 'manifest.json'), 'utf8'));
const svgOf = (a) => readFileSync(join(KIT, a.svg), 'utf8');
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

test('the kit README lists every asset', () => {
  const readme = readFileSync(join(KIT, 'README.md'), 'utf8');
  for (const a of manifest.assets) assert.ok(readme.includes(`\`${a.id}\``), `${a.id} is missing from brand/kit/README.md`);
});

test('the committed kit matches a fresh build', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'weave-kit-'));
  execFileSync(process.execPath, [join(KIT, 'build-kit.mjs'), '--out', tmp], { stdio: 'pipe' });
  assert.equal(readFileSync(join(tmp, 'manifest.json'), 'utf8'), readFileSync(join(KIT, 'manifest.json'), 'utf8'));
  for (const f of readdirSync(join(tmp, 'svg'))) {
    assert.equal(readFileSync(join(tmp, 'svg', f), 'utf8'), readFileSync(join(KIT, 'svg', f), 'utf8'), `svg/${f} drifted from build-kit.mjs`);
  }
});
