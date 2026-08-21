// Service management — launchd auto-start for the local instance.
// Pure logic only: plist generation, launchctl-output parsing, status
// assembly. Nothing here shells out or touches the network; bin/weave.js
// wires these to the real launchctl and the live /api/health probe.

import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

// Resolve flags into the full set of absolute paths a launch agent needs.
// launchd runs with no cwd and no shell env, so every path must be absolute.
export function serviceOptions(flags = {}, { home = homedir(), cwd = process.cwd(), nodePath = process.execPath } = {}) {
  const port = Number(flags.port ?? 4400);
  const label = flags.label && flags.label !== true ? String(flags.label) : `ai.grunion.weave.${port}`;
  const dataPath = flags.data && flags.data !== true
    ? resolve(cwd, String(flags.data))
    : join(home, '.weave', 'workspace.json');
  return {
    port,
    label,
    dataPath,
    nodePath,
    binPath: BIN_PATH,
    plistPath: join(home, 'Library', 'LaunchAgents', `${label}.plist`),
    logPath: join(home, 'Library', 'Logs', 'weave', `${label}.log`),
  };
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildPlist({ label, port, dataPath, nodePath, binPath, logPath }) {
  const args = [nodePath, binPath, 'serve', '--port', String(port), '--data', dataPath];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

// `launchctl print gui/$UID/<label>` output is key = value lines inside a
// brace block. Only the fields status needs are extracted; anything absent
// stays null so callers can distinguish "idle" from "never parsed".
export function parseLaunchctlPrint(text) {
  if (!text || !String(text).trim()) return { loaded: false };
  const s = String(text);
  const grab = (re) => s.match(re)?.[1] ?? null;
  const state = grab(/^\s*state = (.+)$/m);
  const pid = grab(/^\s*pid = (\d+)$/m);
  const exit = grab(/^\s*last exit code = (\d+)$/m);
  return {
    loaded: true,
    state,
    pid: pid == null ? null : Number(pid),
    lastExitCode: exit == null ? null : Number(exit),
  };
}

// Live probe of /api/health. fetchImpl is injectable so tests never open a
// socket; any thrown error (refused, timeout) collapses to unreachable.
export async function probeHealth(port, { fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const payload = await res.json();
    return { reachable: true, ...payload };
  } catch {
    return { reachable: false };
  }
}

// Assemble the three independent facts — plist on disk, launchctl's view,
// the live health probe — into one report with a one-line verdict.
export function buildStatus({ label, port, plistPath, plistInstalled, launchctl, health, localVersion }) {
  const reachable = health?.reachable === true && health?.ok !== false;
  const stale = reachable && localVersion != null && health.version != null && health.version !== localVersion;
  let summary;
  if (reachable) {
    if (stale) summary = `running (stale: server v${health.version}, local v${localVersion} — restart to update)`;
    else if (!plistInstalled) summary = 'running (unmanaged — run `weave service install` to auto-start on login)';
    else summary = 'running';
  } else if (plistInstalled && launchctl?.loaded) {
    summary = `installed but not responding on port ${port}`;
  } else if (plistInstalled) {
    summary = 'installed but not loaded (launchctl)';
  } else {
    summary = 'not installed';
  }
  return {
    label,
    port,
    summary,
    plist: { installed: Boolean(plistInstalled), path: plistPath },
    launchctl: launchctl ?? { loaded: false },
    server: {
      reachable: Boolean(health?.reachable),
      ok: health?.ok ?? null,
      version: health?.version ?? null,
      workspace: health?.workspace ?? null,
      startedAt: health?.startedAt ?? null,
      uptime: health?.uptime ?? null,
      stale,
    },
  };
}
