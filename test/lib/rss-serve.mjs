import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './source.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const PROBE = `data:text/javascript,${encodeURIComponent(`
let base = 0, peak = 0, sweep = null;
const look = () => { const now = process.memoryUsage.rss(); if (now > peak) peak = now; };
setInterval(look, 2).unref();
process.on('message', (m) => {
  if (m?.rss === 'start') { globalThis.gc(); base = peak = process.memoryUsage.rss(); clearInterval(sweep); sweep = setInterval(() => globalThis.gc(), 20); process.send({ rss: 'started', base }); }
  if (m?.rss === 'read') { clearInterval(sweep); look(); process.send({ rss: 'read', base, peak }); }
});
`)}`;

export async function rssServe(db, env) {
  const child = spawn(process.execPath, ['--expose-gc', '--import', PROBE, BIN, 'serve', '--port', '0', '--host', '127.0.0.1', '--data', db], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    timeout: 300_000,
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const { port } = await new Promise((resolve, reject) => {
    child.on('message', (m) => { if (m?.weave === 'listening') resolve(m); });
    exited.then((code) => reject(new Error(`weave serve exited (${code}) before it listened:\n${log}`)));
  });
  const ask = (rss, answer) => new Promise((resolve) => {
    const on = (m) => { if (m?.rss === answer) { child.off('message', on); resolve(m); } };
    child.on('message', on);
    child.send({ rss });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    log: () => log,
    start: () => ask('start', 'started'),
    grown: async () => { const { base, peak } = await ask('read', 'read'); return peak - base; },
    stop: async () => { if (child.exitCode === null && child.signalCode === null) child.disconnect(); await exited; },
  };
}
