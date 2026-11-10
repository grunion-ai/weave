import test from 'node:test';
import assert from 'node:assert/strict';
import { runEmail } from '../src/mail.js';
import { createMailer } from '../src/mail-send.js';

const run = { name: 'Daily review', status: 'succeeded', summary: 'Reviewed three items.', error: '', startedAt: '2026-11-10T14:00:00Z', finishedAt: '2026-11-10T14:03:00Z', sessionUrl: 'https://claude.ai/code/session_example', runUrl: 'https://weave.example.com/w/work/e/run-example', origin: 'https://weave.example.com' };

test('run confirmation has HTML and text with result, timing, summary and links', () => {
  const m = runEmail(run);
  assert.match(m.subject, /Daily review/);
  assert.match(m.subject, /succeeded/i);
  assert.match(m.html, /<!doctype html>/i);
  for (const part of [m.html, m.text]) {
    for (const value of ['Reviewed three items.', run.sessionUrl, run.runUrl, '2026-11-10', '3m']) assert.ok(part.includes(value), value);
  }
});

test('failure and timeout are labeled accurately', () => {
  for (const status of ['failed', 'timed-out']) {
    const m = runEmail({ ...run, status, error: 'Worker stopped.' });
    assert.match(m.html, /Worker stopped\./);
    assert.match(m.text, /Worker stopped\./);
    assert.match(m.subject, status === 'failed' ? /failed/i : /timed out/i);
  }
  assert.throws(() => runEmail({ ...run, status: 'running' }), /terminal|status|complete/i);
});

test('untrusted run text is escaped, dangerous links are omitted, subject stays one line', () => {
  const m = runEmail({ ...run, name: 'Review\r\nBcc: victim@example.com', summary: '<img src=x onerror=alert(1)>', error: '<script>x</script>', sessionUrl: 'javascript:alert(1)' });
  assert.doesNotMatch(m.subject, /[\r\n]/);
  assert.ok(m.html.includes('&lt;img'));
  assert.doesNotMatch(m.html, /<script>|<img src=x|javascript:/);
  assert.doesNotMatch(m.text, /javascript:/);
});

test('run confirmation reuses mail layout for light and dark themes', () => {
  for (const theme of ['light', 'dark']) {
    const m = runEmail({ ...run, theme });
    assert.ok(m.html.includes(`email-lockup-${theme}.png`));
    assert.match(m.html, /max-width:600px/);
  }
});

test('mail transport passes stable provider idempotency key without altering old callers', async () => {
  const calls = [];
  const mail = createMailer({ key: 'test-only', from: 'weave@example.com', fetch: async (url, init) => { calls.push(init); return new Response('{"id":"mail-1"}', {status:200}); } });
  await mail({ to: 'person@example.com', ...runEmail(run), idempotencyKey: 'weave-run/example-run' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'weave-run/example-run');
  await mail({ to: 'person@example.com', subject: 'Invite', html: '<p>Invite</p>', text: 'Invite' });
  assert.equal(calls[1].headers['Idempotency-Key'], undefined);
});
