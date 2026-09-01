import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { serviceOptions, buildPlist, parseLaunchctlPrint, buildStatus, probeHealth } from '../src/service.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

// Pure functions only below — no test may invoke launchctl or write a plist.

test('serviceOptions: defaults derive from the port', () => {
  const o = serviceOptions({}, { home: '/Users/u' });
  assert.equal(o.port, 4400);
  assert.equal(o.label, 'ai.grunion.weave.4400');
  assert.equal(o.plistPath, '/Users/u/Library/LaunchAgents/ai.grunion.weave.4400.plist');
  assert.equal(o.logPath, '/Users/u/Library/Logs/weave/ai.grunion.weave.4400.log');
  assert.equal(o.dataPath, '/Users/u/.weave/workspace.json');
  assert.ok(isAbsolute(o.nodePath));
  assert.ok(o.binPath.endsWith(join('bin', 'weave.js')));
});

test('serviceOptions: flags override defaults, data resolves absolute', () => {
  const o = serviceOptions({ port: '5500', data: 'uno.json', label: 'my.label' }, { home: '/Users/u', cwd: '/repo' });
  assert.equal(o.port, 5500);
  assert.equal(o.label, 'my.label');
  assert.equal(o.plistPath, '/Users/u/Library/LaunchAgents/my.label.plist');
  assert.equal(o.dataPath, '/repo/uno.json');
});

test('serviceOptions: custom port flows into the default label', () => {
  const o = serviceOptions({ port: 4401 }, { home: '/Users/u' });
  assert.equal(o.label, 'ai.grunion.weave.4401');
});

test('buildPlist: launchd agent with absolute paths, KeepAlive, logs', () => {
  const o = serviceOptions({ port: 4400, data: '/data/uno.json' }, { home: '/Users/u' });
  const xml = buildPlist(o);
  assert.match(xml, /<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<key>Label<\/key>\s*<string>ai\.grunion\.weave\.4400<\/string>/);
  // ProgramArguments: absolute node, absolute bin, serve --port N --data abs.
  assert.ok(xml.includes(`<string>${o.nodePath}</string>`));
  assert.ok(xml.includes(`<string>${o.binPath}</string>`));
  assert.match(xml, /<string>serve<\/string>\s*<string>--port<\/string>\s*<string>4400<\/string>\s*<string>--data<\/string>\s*<string>\/data\/uno\.json<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/u\/Library\/Logs\/weave\/ai\.grunion\.weave\.4400\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/u\/Library\/Logs\/weave\/ai\.grunion\.weave\.4400\.log<\/string>/);
});

test('buildPlist: XML-escapes reserved characters in paths', () => {
  const o = serviceOptions({ data: '/data/a&b <c>.json' }, { home: '/Users/u' });
  const xml = buildPlist(o);
  assert.ok(xml.includes('/data/a&amp;b &lt;c&gt;.json'));
  assert.ok(!xml.includes('a&b'));
});

test('parseLaunchctlPrint: running agent', () => {
  const text = [
    'gui/501/ai.grunion.weave.4400 = {',
    '\tactive count = 1',
    '\tpath = /Users/u/Library/LaunchAgents/ai.grunion.weave.4400.plist',
    '\tstate = running',
    '\tprogram = /usr/local/bin/node',
    '\tpid = 54321',
    '\tlast exit code = 0',
    '}',
  ].join('\n');
  assert.deepEqual(parseLaunchctlPrint(text), { loaded: true, state: 'running', pid: 54321, lastExitCode: 0 });
});

test('parseLaunchctlPrint: not loaded / never exited', () => {
  assert.deepEqual(parseLaunchctlPrint(''), { loaded: false });
  assert.deepEqual(parseLaunchctlPrint(null), { loaded: false });
  const idle = 'gui/501/x = {\n\tstate = not running\n\tlast exit code = (never exited)\n}';
  assert.deepEqual(parseLaunchctlPrint(idle), { loaded: true, state: 'not running', pid: null, lastExitCode: null });
});

test('buildStatus: healthy managed service', () => {
  const s = buildStatus({
    label: 'ai.grunion.weave.4400', port: 4400, plistPath: '/p.plist', plistInstalled: true,
    launchctl: { loaded: true, state: 'running', pid: 7, lastExitCode: 0 },
    health: { reachable: true, ok: true, version: '0.3.0', workspace: 'uno', startedAt: '2026-08-21T00:00:00.000Z', uptime: 12 },
    localVersion: '0.3.0',
  });
  assert.equal(s.summary, 'running');
  assert.equal(s.server.stale, false);
  assert.equal(s.server.startedAt, '2026-08-21T00:00:00.000Z');
  assert.equal(s.launchctl.pid, 7);
});

test('buildStatus: version mismatch flags a stale server', () => {
  const s = buildStatus({
    label: 'l', port: 4400, plistPath: '/p', plistInstalled: true,
    launchctl: { loaded: true, state: 'running', pid: 7, lastExitCode: 0 },
    health: { reachable: true, ok: true, version: '0.2.0', workspace: 'uno' },
    localVersion: '0.3.0',
  });
  assert.equal(s.server.stale, true);
  assert.match(s.summary, /stale/);
});

test('buildStatus: reachable but unmanaged', () => {
  const s = buildStatus({
    label: 'l', port: 4400, plistPath: '/p', plistInstalled: false,
    launchctl: { loaded: false },
    health: { reachable: true, ok: true, version: '0.3.0' },
    localVersion: '0.3.0',
  });
  assert.match(s.summary, /unmanaged/);
});

test('buildStatus: installed but not responding', () => {
  const s = buildStatus({
    label: 'l', port: 4400, plistPath: '/p', plistInstalled: true,
    launchctl: { loaded: true, state: 'not running', pid: null, lastExitCode: 1 },
    health: { reachable: false },
    localVersion: '0.3.0',
  });
  assert.match(s.summary, /not responding/);
});

test('buildStatus: nothing installed, nothing running', () => {
  const s = buildStatus({
    label: 'l', port: 4400, plistPath: '/p', plistInstalled: false,
    launchctl: { loaded: false }, health: { reachable: false }, localVersion: '0.3.0',
  });
  assert.equal(s.summary, 'not installed');
  assert.equal(s.plist.installed, false);
  assert.equal(s.server.reachable, false);
});

test('probeHealth: passes the payload through, injectable fetch', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'http://127.0.0.1:4400/api/health');
    return { ok: true, json: async () => ({ ok: true, version: '0.3.0', startedAt: 'x', uptime: 1 }) };
  };
  const h = await probeHealth(4400, { fetchImpl });
  assert.deepEqual(h, { reachable: true, ok: true, version: '0.3.0', startedAt: 'x', uptime: 1 });
});

test('probeHealth: connection refused reports unreachable', async () => {
  const h = await probeHealth(4400, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(h, { reachable: false });
});

test('health payload carries startedAt + uptime for staleness checks', async () => {
  const { server } = await startServer(new Weave(), { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const health = await res.json();
    assert.equal(health.ok, true);
    // ISO start time: a caller can compare against commit/package mtimes.
    assert.ok(!Number.isNaN(Date.parse(health.startedAt)));
    assert.equal(typeof health.uptime, 'number');
  } finally {
    server.close();
  }
});

test('CLI: help documents the service commands', () => {
  const help = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });
  assert.match(help, /service install/);
  assert.match(help, /service uninstall/);
  assert.match(help, /service status/);
});

test('CLI: unknown service subcommand errors without touching launchd', () => {
  assert.throws(
    () => execFileSync('node', [BIN, 'service', 'bogus'], { encoding: 'utf8', stdio: 'pipe' }),
    /Unknown service subcommand/,
  );
});

/* ---------------- promote (lifecycle gate, Phase 3) ---------------- */

test('parseTap reads failures out of node --test output by name', async () => {
  const { parseTap } = await import('../src/service.js');
  const red = parseTap('ok 1 - lifecycle: entity create\nnot ok 2 - lifecycle: table restore brings rows and relations back\n# pass 1\n# fail 1');
  assert.equal(red.pass, false);
  assert.deepEqual(red.failed, ['lifecycle: table restore brings rows and relations back']);
  const green = parseTap('ok 1 - a\nok 2 - b\n# pass 2\n# fail 0');
  assert.deepEqual(green, { pass: true, failed: [] });
  assert.equal(parseTap('').pass, false, 'no TAP plan is not a pass');
});

test('promoteVerdict demands a reachable server running the promoted version', async () => {
  const { promoteVerdict } = await import('../src/service.js');
  assert.equal(promoteVerdict({ health: { reachable: false }, expectedVersion: '1.0.0' }).healthy, false);
  const stale = promoteVerdict({ health: { reachable: true, ok: true, version: '0.9.0' }, expectedVersion: '1.0.0' });
  assert.equal(stale.healthy, false);
  assert.match(stale.reason, /not serving the promote checkout/);
  assert.equal(promoteVerdict({ health: { reachable: true, ok: true, version: '1.0.0' }, expectedVersion: '1.0.0' }).healthy, true);
});
