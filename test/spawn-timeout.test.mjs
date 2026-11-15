import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/source.mjs';

const ALLOWED = new Set(['test/spawn-timeout.test.mjs']);

function sources(directory = 'test') {
  const found = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sources(relative));
    else if (entry.name.endsWith('.mjs')) found.push(relative);
  }
  return found;
}

const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

export function codeOnly(source) {
  let out = '';
  const braces = [];
  let last = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + c;
      i = j; last = c; continue;
    }
    if (c === '`' || (c === '}' && braces.at(-1) === 'template')) {
      if (c === '}') braces.pop();
      let j = i + 1;
      while (j < source.length && source[j] !== '`' && !(source[j] === '$' && source[j + 1] === '{')) j += source[j] === '\\' ? 2 : 1;
      out += c + source.slice(i + 1, j).replace(/[^\n]/g, ' ');
      if (source[j] === '$') { out += '${'; braces.push('template'); i = j + 1; } else { out += '`'; i = j; }
      last = '`'; continue;
    }
    if (c === '/' && source[i + 1] !== '/' && source[i + 1] !== '*' && REGEX_BEFORE.has(last)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      out += '/' + ' '.repeat(Math.max(0, j - i - 1)) + '/';
      i = j; last = '/'; continue;
    }
    if (c === '{') braces.push('code');
    if (c === '}') braces.pop();
    out += c;
    if (!/\s/.test(c)) last = /[\w$)\]]/.test(c) ? 'x' : c;
  }
  return out;
}

export function spawnsWithoutTimeout(source) {
  const code = codeOnly(source);
  const offenders = [];
  for (const match of code.matchAll(/(?<![\w$.])(spawnSync|spawn)\(/g)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < code.length; end++) {
      if ('([{'.includes(code[end])) depth++;
      else if (')]}'.includes(code[end]) && --depth === 0) break;
    }
    if (!/\btimeout\s*:/.test(code.slice(match.index, end))) offenders.push(code.slice(0, match.index).split('\n').length);
  }
  return offenders;
}

test('the gate reads past strings, templates and regexes to the call it names', () => {
  assert.deepEqual(spawnsWithoutTimeout("spawnSync('node', ['-e', ')'], { encoding: 'utf8' });"), [1]);
  assert.deepEqual(spawnsWithoutTimeout("spawnSync('node', ['-e', ')'], { encoding: 'utf8', timeout: 1000 });"), []);
  assert.deepEqual(spawnsWithoutTimeout("const child = spawn(process.execPath, [file], {\n  env,\n  timeout: 60_000,\n});"), []);
  assert.deepEqual(spawnsWithoutTimeout("const s = `spawnSync('node', [BIN, ${x}])`;\nconst r = /spawn\\(/;"), []);
  assert.deepEqual(spawnsWithoutTimeout("const s = `a ${f({ b: 1 })} c`;\nspawn('x', []);"), [2]);
  assert.deepEqual(spawnsWithoutTimeout("child.spawn('x'); mySpawn('y');"), []);
});

test('every spawn and spawnSync in test/ carries a timeout, so a hung child fails its test by name (Issue #1817)', () => {
  const offenders = [];
  for (const file of sources()) {
    if (ALLOWED.has(file)) continue;
    for (const line of spawnsWithoutTimeout(readFileSync(join(ROOT, file), 'utf8'))) offenders.push(`${file}:${line}`);
  }
  assert.deepEqual(offenders, [], `pass a timeout to each spawn and spawnSync, so a child that never exits ends the test instead of the shard: ${offenders.join(', ')}`);
});
