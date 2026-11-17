import { COMMANDS, httpPaths } from '../../src/commands.js';
import { read } from './source.mjs';

export const ID = '00000000-0000-4000-8000-000000000000';
export const TOKEN = 'nosuchtoken';

export function listRoutes(src = read('src/routes.js')) {
  const seen = new Map();
  const add = (method, path, line) => seen.set(`${method} ${path}`, { method, path, line });
  const concretise = (re) => re
    .replace(/^\^/, '').replace(/\$$/, '')
    .replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)\?/g, '')
    .replace(/\(\[\^\/\]\+\??\)/g, ID)
    .replace(/\(\[A-Za-z0-9_-\]\+\)/g, TOKEN)
    .replace(/\(\.\+\)/g, ID)
    .replace(/\(\\\/\.\*\|\$\)/g, '/')
    .replace(/\(([a-z]+)(?:\|[a-z]+)+\)/g, '$1')
    .replace(/\\\//g, '/').replace(/\\\./g, '.');
  for (const c of COMMANDS) for (const p of httpPaths(c)) add(c.http.method, p.replace(/:[a-z]+\*?\??/gi, ID), 'src/commands.js');
  for (const line of src.split('\n')) {
    const method = line.match(/rx\.method === '([A-Z]+)'/)?.[1] ?? 'GET';
    for (const [, m, p] of line.matchAll(/route === '([A-Z]+) ([^']+)'/g)) add(m, p, line);
    for (const [, p] of line.matchAll(/path === '([^']+)'/g)) add(method, p, line);
    for (const [, re] of line.matchAll(/path\.match\(\/(\^.+?\$)\/\)/g)) add(method, concretise(re), line);
  }
  return [...seen.values()];
}
