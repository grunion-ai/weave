import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APT_CONF = 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "3";\nDPkg::Lock::Timeout "300";\nAPT::Keep-Downloaded-Packages "true";\n';
export const ATTEMPTS = 3;

const debsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.deb')).sort() : []);

export function install(browsers, { run, log, cache, archives, conf }) {
  const ok = (cmd, ...args) => run(cmd, args) === 0;
  const playwright = (...args) => ok('npx', '--no-install', 'playwright', ...args);
  const ready = () => playwright('install', ...browsers) && playwright('install-deps', '--dry-run', ...browsers);

  if (run('sudo', ['tee', conf], APT_CONF) !== 0) log(`could not write ${conf}; apt runs on its defaults`);
  if (ready()) return { source: 'image' };

  const cached = debsIn(cache);
  if (cached.length) {
    log(`installing ${cached.length} cached packages from ${cache}; apt downloads nothing`);
    if (ok('sudo', 'apt-get', 'install', '-y', '--no-download', '--no-install-recommends', ...cached.map((name) => join(cache, name))) && ready()) {
      return { source: 'cache', installed: cached.length };
    }
    log('the cached packages left a dependency missing; installing from the Ubuntu mirror');
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (playwright('install', '--with-deps', ...browsers) && ready()) {
      const kept = debsIn(archives);
      if (kept.length) {
        rmSync(cache, { recursive: true, force: true });
        mkdirSync(cache, { recursive: true });
        for (const name of kept) copyFileSync(join(archives, name), join(cache, name));
      }
      log(`kept ${kept.length} downloaded packages in ${cache} for the next run`);
      return { source: 'mirror', kept: kept.length };
    }
    log(`browser install attempt ${attempt} failed`);
    if (attempt < ATTEMPTS) {
      log(ok('sudo', 'dpkg', '--configure', '-a') ? 'dpkg is configured again' : `dpkg --configure -a failed after attempt ${attempt}; another process still holds the lock`);
    }
  }
  log(`browser install failed after ${ATTEMPTS} attempts; no test ran`);
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const browsers = process.argv.slice(2);
  if (!browsers.length) {
    console.error('usage: node scripts/ci/install-browsers.mjs <browser...>');
    process.exit(2);
  }
  const started = Date.now();
  const run = (cmd, args, input) => {
    const child = spawnSync(cmd, args, { stdio: [input === undefined ? 'inherit' : 'pipe', input === undefined ? 'inherit' : 'ignore', 'inherit'], input });
    return child.status ?? 1;
  };
  const result = install(browsers, {
    run,
    log: (line) => console.log(line),
    cache: process.env.WEAVE_APT_CACHE ?? join(homedir(), '.cache', 'weave-apt'),
    archives: '/var/cache/apt/archives',
    conf: '/etc/apt/apt.conf.d/99weave-apt',
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!result) process.exit(1);
  console.log(`browsers and system dependencies ready from the ${result.source} in ${seconds}s`);
}
