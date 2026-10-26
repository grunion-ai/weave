import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/source.mjs';

const BARE = /mkdtempSync\(\s*(?:[A-Za-z_$][\w$]*\.)?join\(\s*(?:[A-Za-z_$][\w$]*\.)?tmpdir\(\)/;
const ALLOWED = new Set(['test/temp-dirs.test.mjs', 'test/lib/temp.mjs']);

function sources(directory = 'test') {
  const found = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sources(relative));
    else if (entry.name.endsWith('.mjs')) found.push(relative);
  }
  return found;
}

test('no test file opens a temp directory the suite never removes', () => {
  const offenders = [];
  for (const file of sources()) {
    if (ALLOWED.has(file)) continue;
    for (const [index, line] of readFileSync(join(ROOT, file), 'utf8').split('\n').entries()) {
      if (BARE.test(line)) offenders.push(`${file}:${index + 1}`);
    }
  }
  assert.deepEqual(offenders, [], `call tempDir() from test/lib/temp.mjs instead, so the directory goes when the process does: ${offenders.join(', ')}`);
});

test('tempDir removes every directory it opened when the process exits', () => {
  const module = pathToFileURL(join(ROOT, 'test/lib/temp.mjs')).href;
  const script = `import { tempDir } from ${JSON.stringify(module)};
process.stdout.write(JSON.stringify([tempDir('weave-temp-gate-a-'), tempDir('weave-temp-gate-b-')]));`;
  const made = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.equal(made.length, 2);
  for (const dir of made) assert.equal(existsSync(dir), false, `${dir} outlived the process that made it`);
});
