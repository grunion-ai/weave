import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../lib/source.mjs';
import { scrub, scrubRow } from '../../scripts/export-development.mjs';

test('a home directory becomes ~ and an address outside grunion.ai is removed', () => {
  assert.equal(scrub('ran from /Users/kyle/Documents/weave-wt/x and /Users/alice/bin/node'), 'ran from ~/Documents/weave-wt/x and ~/bin/node');
  assert.equal(scrub('`/Users/kyle`, then /Users/kyle/.gerrit/log'), '`~`, then ~/.gerrit/log');
  assert.equal(scrub('mail kyle@undersight.ai or invite-check@example.invalid'), 'mail <email removed> or <email removed>');
  assert.equal(scrub('weave@grunion.ai, kyle@grunion.ai and agent@weave stay; so does core@1.4.0'), 'weave@grunion.ai, kyle@grunion.ai and agent@weave stay; so does core@1.4.0');
  assert.equal(scrub('/home/kyle/x and /Users/ alone'), '/home/kyle/x and /Users/ alone');
});

test('scrubRow cleans every string field and every name in a relation list', () => {
  const row = scrubRow({
    name: 'Error: log at /Users/kyle/.gerrit/weave/review-logs/445-6.log',
    status: 'Open',
    symptom: ['Error', 'from /Users/kyle/bin'],
    fixes: ['Issue about a@b.co'],
    description: 'Filed by kyle@undersight.ai from /Users/kyle/Documents/harness.nosync.',
  });
  assert.deepEqual(row, {
    name: 'Error: log at ~/.gerrit/weave/review-logs/445-6.log',
    status: 'Open',
    symptom: ['Error', 'from ~/bin'],
    fixes: ['Issue about <email removed>'],
    description: 'Filed by <email removed> from ~/Documents/harness.nosync.',
  });
});

test('the shipped export carries no home directory and no address outside grunion.ai', () => {
  const text = read('docs/development.json');
  assert.equal((text.match(/\/Users\//g) ?? []).length, 0, 'docs/development.json names a /Users/ path');
  const foreign = [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi)].map((m) => m[0]).filter((a) => !a.toLowerCase().endsWith('@grunion.ai'));
  assert.deepEqual([...new Set(foreign)], [], 'docs/development.json carries a personal address');
});
