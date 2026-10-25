import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLERK_EMAILS, CLERK_REQUIRED, clerkEmail, clerkPayload } from '../src/mail.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ORIGIN = 'https://weave.grunion.ai';
const SLUGS = ['new_device_sign_in', 'account_locked', 'mfa_enabled', 'passkey_added', 'passkey_removed', 'password_changed', 'password_removed',
  'primary_email_address_changed', 'reset_password_code', 'verification_code', 'magic_link_sign_in', 'magic_link_sign_up', 'magic_link_user_profile'];

test('clerk emails: every security template Clerk sends has weave copy', () => {
  assert.deepEqual(Object.keys(CLERK_EMAILS).sort(), [...SLUGS].sort());
  assert.deepEqual(Object.keys(CLERK_REQUIRED).sort(), [...SLUGS].sort());
});

for (const slug of SLUGS) {
  test(`clerk emails: ${slug} renders through the weave shell with its required variables`, () => {
    const m = clerkEmail(slug, { origin: ORIGIN });
    assert.ok(m.subject.length > 0 && !m.subject.includes('\n'), 'one-line subject');
    for (const v of CLERK_REQUIRED[slug]) {
      assert.ok(m.html.includes(`{{${v}}}`), `body carries {{${v}}}`);
    }
    assert.ok(m.html.includes(`${ORIGIN}/brand/email-lockup-light.png`), 'weave lockup, light');
    assert.ok(m.html.includes(`${ORIGIN}/brand/email-lockup-dark.png`), 'weave lockup, dark');
    assert.ok(m.html.includes('@media (prefers-color-scheme: dark)'), 'both themes');
    for (const gray of ['#747686', '#FAFAFB', '#111827']) assert.ok(!m.html.includes(gray), `no Clerk stock gray ${gray}`);
    assert.ok(!m.html.includes('{{> app_logo}}'), 'no Clerk logo partial');
    assert.ok(!/—/.test(m.html + m.subject), 'no em dash');
    const opens = (m.html.match(/\{\{#if /g) ?? []).length;
    const closes = (m.html.match(/\{\{\/if\}\}/g) ?? []).length;
    assert.equal(opens, closes, 'every {{#if}} closes');
    assert.ok(!/\{\{(?![#/]?[\w.]+\}\}|#if [\w.]+\}\})/.test(m.html.replace(/\{\{\/if\}\}/g, '')), 'only plain Handlebars variables and #if blocks');
  });
}

test('clerk emails: new_device_sign_in signs the device out from a button and hides empty rows', () => {
  const m = clerkEmail('new_device_sign_in', { origin: ORIGIN });
  assert.match(m.html, /\{\{#if revoke_session_url\}\}[\s\S]*href="\{\{revoke_session_url\}\}"[\s\S]*\{\{\/if\}\}/);
  for (const v of ['browser_name', 'operating_system', 'location', 'ip_address', 'session_created_at']) {
    assert.ok(m.html.includes(`{{${v}}}`), `shows ${v}`);
  }
  assert.match(m.html, /\{\{#if sign_in_method\}\}[\s\S]*\{\{sign_in_method\}\}[\s\S]*\{\{\/if\}\}/);
});

test('clerk emails: code templates lead the subject with the code and show it large', () => {
  for (const slug of ['reset_password_code', 'verification_code']) {
    const m = clerkEmail(slug, { origin: ORIGIN });
    assert.ok(m.subject.startsWith('{{otp_code}}'), `${slug} subject leads with the code`);
    assert.match(m.html, /class="code"[^>]*>\{\{otp_code\}\}</);
  }
});

test('clerk emails: unknown slug names the known ones', () => {
  assert.throws(() => clerkEmail('billing_receipt', { origin: ORIGIN }), /No weave copy for Clerk template 'billing_receipt'/);
});

test('clerk emails: the script writes a payload and a preview per template without pushing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-emails-test-'));
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts/clerk-emails.mjs'), '--out', dir], { encoding: 'utf8' });
  for (const slug of SLUGS) {
    assert.ok(out.includes(`wrote ${slug}: `), `reports ${slug}`);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')), clerkPayload(slug, { origin: ORIGIN }));
    assert.equal(readFileSync(join(dir, `${slug}.html`), 'utf8'), clerkEmail(slug, { origin: ORIGIN }).html);
  }
  assert.ok(!out.includes('pushed'), 'no push without --push');
});

test('clerk emails: payload is what PUT /v1/templates/email/{slug} takes', () => {
  const p = clerkPayload('password_changed', { origin: ORIGIN });
  assert.deepEqual(Object.keys(p).sort(), ['body', 'delivered_by_clerk', 'from_email_name', 'markup', 'name', 'subject']);
  assert.equal(p.markup, '');
  assert.equal(p.delivered_by_clerk, true);
  assert.equal(p.from_email_name, 'noreply');
  assert.equal(p.body, clerkEmail('password_changed', { origin: ORIGIN }).html);
});
