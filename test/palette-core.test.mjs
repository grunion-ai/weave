import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/palette-core.js');
const P = globalThis.weavePalette;

test('plainText strips headings, emphasis, links, references, code and URLs', () => {
  assert.equal(P.plainText('# Design onboarding wizard'), 'Design onboarding wizard');
  assert.equal(P.plainText('## Goals'), 'Goals');
  assert.equal(P.plainText('A **bold** and *soft* and ~~gone~~ word'), 'A bold and soft and gone word');
  assert.equal(P.plainText('Read [the spec](https://example.com/spec) first'), 'Read the spec first');
  assert.equal(P.plainText('See [[Product/Task#12|the wizard]] and [[Apollo Launch]]'), 'See the wizard and Apollo Launch');
  assert.equal(P.plainText('Run `npm test` now'), 'Run npm test now');
  assert.equal(P.plainText('Open http://127.0.0.1:4400/w/demo/e/abc to see it'), 'Open to see it');
  assert.equal(P.plainText('![logo](/files/x.png) caption'), 'logo caption');
  assert.equal(P.plainText('- [ ] draft\n- [x] ship\n1. one\n> quoted'), 'draft ship one quoted');
  assert.equal(P.plainText('| a | b |\n| --- | --- |\n| 1 | 2 |'), 'a b 1 2');
  assert.equal(P.plainText('<b>html</b> text'), 'html text');
});

test('plainText keeps a number sign that is content, not a heading', () => {
  assert.equal(P.plainText('Fixes Task #143 today'), 'Fixes Task #143 today');
});

test('plainText survives the fragments a snippet window cuts through', () => {
  assert.equal(P.plainText('e](https://example.com/a) the onboarding'), 'e the onboarding');
  assert.equal(P.plainText('the onboarding [flow](https://exa'), 'the onboarding flow');
  assert.equal(P.plainText('the onboarding ([spec](http://x)) flow'), 'the onboarding (spec) flow');
});

test('excerpt is plain text around the match, cut on words, with ellipses where it was cut', () => {
  const snip = 'unch The Q3 flagship release. Tracks the new onboarding flow and billing revamp. ## Goals';
  const x = P.excerpt(snip, 'onboard');
  assert.equal(x, '… Tracks the new onboarding flow and billing revamp. Goals');
  assert.doesNotMatch(x, /#|\*|\[|http/);
  assert.equal(P.excerpt('Short onboarding note', 'onboard'), 'Short onboarding note');
  const long = 'alpha beta gamma delta epsilon zeta eta theta onboarding iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon';
  assert.equal(P.excerpt(long, 'onboard'), '… zeta eta theta onboarding iota kappa lambda mu nu xi omicron pi …');
  assert.equal(P.excerpt('see https://x.test/onboard now', 'onboard'), 'see now');
  assert.equal(P.excerpt('', 'x'), '');
});

test('highlight marks every case-insensitive occurrence and nothing else', () => {
  assert.deepEqual(P.highlight('Design onboarding wizard', 'onboard'),
    [{ text: 'Design ', hit: false }, { text: 'onboard', hit: true }, { text: 'ing wizard', hit: false }]);
  assert.deepEqual(P.highlight('Onboard the onboarded', 'ONBOARD'),
    [{ text: 'Onboard', hit: true }, { text: ' the ', hit: false }, { text: 'onboard', hit: true }, { text: 'ed', hit: false }]);
  assert.deepEqual(P.highlight('No match', 'zzz'), [{ text: 'No match', hit: false }]);
  assert.deepEqual(P.highlight('Empty needle', ''), [{ text: 'Empty needle', hit: false }]);
});

const hit = (over) => ({ kind: 'entity', id: over.name, publicId: 1, db: 'Product/Task', url: '/e/x', score: 10, snippet: '', ...over });

test('groupHits orders Records, In documents, Tables, Spaces and views, and hides empty groups', () => {
  const hits = [
    { kind: 'table', id: 't1', name: 'Ops/Onboarding', url: '/#/table/t1' },
    hit({ name: 'Apollo Launch', score: 5, snippet: 'Tracks the new onboarding flow' }),
    hit({ name: 'Design onboarding wizard', score: 15, snippet: 'onboarding wizard' }),
    { kind: 'view', id: 'v1', name: 'Onboarding board', url: '/#/view/v1' },
    hit({ name: 'Onboarding call', workspace: 'weave' }),
  ];
  const groups = P.groupHits(hits, 'onboard');
  assert.deepEqual(groups.map((g) => g.label), ['Records', 'In documents', 'Tables', 'Spaces and views']);
  assert.deepEqual(groups[0].hits.map((h) => h.name), ['Design onboarding wizard', 'Onboarding call']);
  assert.deepEqual(groups[1].hits.map((h) => h.name), ['Apollo Launch']);
  assert.deepEqual(P.groupHits([hits[1]], 'onboard').map((g) => g.label), ['In documents'],
    'a group with no hits is hidden, every group alike');
  assert.deepEqual(P.groupHits([], 'x'), []);
});

test('an exact #id hit is a record even when its name does not contain the text', () => {
  const groups = P.groupHits([hit({ name: 'Printer jam', score: 20 })], '#1');
  assert.deepEqual(groups.map((g) => g.label), ['Records']);
});

test('whereText names the table and number, or what a container is', () => {
  assert.equal(P.whereText(hit({ db: 'Product/Task', publicId: 1 })), 'Task #1');
  assert.equal(P.whereText({ kind: 'table', name: 'Product/Task' }), 'Product · table');
  assert.equal(P.whereText({ kind: 'table', name: 'Task' }), 'table');
  assert.equal(P.whereText({ kind: 'view', name: 'Triage board' }), 'view');
  assert.equal(P.whereText({ kind: 'space', name: 'Ops' }), 'space');
  assert.equal(P.whereText({ kind: 'workspace', name: 'demo' }), 'workspace');
  assert.equal(P.displayName({ kind: 'table', name: 'Product/Task' }), 'Task');
  assert.equal(P.displayName(hit({ name: 'Leo Marsh' })), 'Leo Marsh');
});

test('groupJump moves to the first row of the next group and wraps; Shift goes back', () => {
  const groups = [{ hits: [1, 2] }, { hits: [3] }, { hits: [4, 5, 6] }];
  assert.equal(P.groupJump(groups, 0, 1), 2);
  assert.equal(P.groupJump(groups, 1, 1), 2);
  assert.equal(P.groupJump(groups, 2, 1), 3);
  assert.equal(P.groupJump(groups, 4, 1), 0, 'the last group wraps to the first');
  assert.equal(P.groupJump(groups, 4, -1), 2, 'back from inside a group lands on the one before');
  assert.equal(P.groupJump(groups, 0, -1), 3, 'back from the first wraps to the last');
  assert.equal(P.groupJump([{ hits: [1, 2] }], 1, 1), 0);
  assert.equal(P.groupJump([], 0, 1), 0);
});

test('pushRecent puts the newest first, drops the older copy and keeps eight', () => {
  let list = [];
  for (let i = 1; i <= 10; i++) list = P.pushRecent(list, { kind: 'entity', id: `e${i}`, name: `E${i}` });
  assert.equal(list.length, P.RECENT_MAX);
  assert.equal(P.RECENT_MAX, 8);
  assert.deepEqual(list.slice(0, 2).map((r) => r.id), ['e10', 'e9']);
  list = P.pushRecent(list, { kind: 'entity', id: 'e5', name: 'E5 renamed' });
  assert.deepEqual(list.slice(0, 2).map((r) => r.name), ['E5 renamed', 'E10']);
  assert.equal(list.filter((r) => r.id === 'e5').length, 1);
  list = P.pushRecent(list, { kind: 'table', id: 'e10', name: 'T' });
  assert.equal(list.filter((r) => r.id === 'e10').length, 2);
  assert.deepEqual(P.pushRecent(null, { kind: 'table', id: 't', name: 'T' }).map((r) => r.id), ['t'], 'a missing list starts one');
});
