import test from 'node:test';
import assert from 'node:assert/strict';
import { trialEmail } from '../src/mail.js';

const mail = (extra = {}) => trialEmail({ workspace: 'Acme', daysLeft: 3, endsAt: '2026-12-01T00:00:00Z', billing: 'https://weave.test/billing', origin: 'https://weave.test', ...extra });

test('the trial email heading carries the heading class and its inline style', () => {
  const { html } = mail();
  const h1 = html.match(/<h1[^>]*>/)[0];
  assert.match(h1, /class="h1"/);
  assert.match(h1, /font-size:26px/);
});

test('the heading class is the hook the dark and narrow rules restyle', () => {
  assert.match(mail().html, /\.h1\{font-size:23px !important/);
});

test('the last-day trial email heading says today', () => {
  assert.match(mail({ stage: 'last' }).html, /<h1[^>]*class="h1"[^>]*>Your free trial ends today<\/h1>/);
});
