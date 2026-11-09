import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './temp.mjs';
import { SECURITY } from '../../src/keystore.js';

export const hasKeychain = process.platform === 'darwin' && existsSync(SECURITY);

const searchList = () => execFileSync(SECURITY, ['list-keychains', '-d', 'user'], { encoding: 'utf8' });

export function throwawayKeychain(prefix = 'weave-kc-') {
  const path = join(tempDir(prefix), 'throwaway.keychain-db');
  const before = searchList();
  execFileSync(SECURITY, ['create-keychain', '-p', 'throwaway', path]);
  if (searchList() !== before) {
    execFileSync(SECURITY, ['delete-keychain', path]);
    throw new Error('Creating a throwaway keychain changed the user search list; stopped before any item was written');
  }
  execFileSync(SECURITY, ['unlock-keychain', '-p', 'throwaway', path]);
  execFileSync(SECURITY, ['set-keychain-settings', path]);
  return {
    path,
    find: (service, account = 'weave') => execFileSync(SECURITY, ['find-generic-password', '-s', service, '-a', account, '-w', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, ''),
    dump: () => execFileSync(SECURITY, ['dump-keychain', path], { encoding: 'utf8' }),
    remove: () => { if (existsSync(path)) execFileSync(SECURITY, ['delete-keychain', path]); },
  };
}
