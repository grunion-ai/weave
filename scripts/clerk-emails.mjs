#!/usr/bin/env node
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { CLERK_EMAILS, clerkPayload } from '../src/mail.js';

const { values: o } = parseArgs({
  options: {
    out: { type: 'string' },
    push: { type: 'boolean', default: false },
    origin: { type: 'string', default: 'https://weave.grunion.ai' },
    app: { type: 'string', default: 'app_3K0fdQvzyD8BGG7JK8kmaAoiyeI' },
    instance: { type: 'string', default: 'prod' },
    only: { type: 'string' },
  },
});

const slugs = o.only ? o.only.split(',') : Object.keys(CLERK_EMAILS);
const dir = o.out ?? mkdtempSync(join(tmpdir(), 'clerk-emails-'));
mkdirSync(dir, { recursive: true });

for (const slug of slugs) {
  const p = clerkPayload(slug, { origin: o.origin });
  const file = join(dir, `${slug}.json`);
  writeFileSync(file, JSON.stringify(p));
  writeFileSync(join(dir, `${slug}.html`), p.body);
  if (o.push) {
    execFileSync('clerk', ['api', '-X', 'PUT', `/templates/email/${slug}`, '--app', o.app, '--instance', o.instance, '--file', file, '--yes', '--mode', 'agent'], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  console.log(`${o.push ? 'pushed' : 'wrote'} ${slug}: ${p.subject}`);
}
console.log(dir);
