import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks } from '../src/markdown.js';
import { markParts } from '../src/mark.js';

test('an opening code fence followed by trailing spaces still opens a code block', () => {
  const blocks = parseBlocks('```js   \nconst a = 1;\n```\n');
  assert.deepEqual(blocks, [{ type: 'code', lang: 'js', text: 'const a = 1;' }]);
});

test('a bare opening fence with trailing whitespace opens a code block with no language', () => {
  const blocks = parseBlocks('```\t \nplain\n```');
  assert.deepEqual(blocks, [{ type: 'code', lang: '', text: 'plain' }]);
});

test('markParts places the caller markup inside the first stroke', () => {
  const { body } = markParts({ c1: '#111111', c2: '#222222', kids: { a: '<animate id="first"/>' } });
  assert.match(body, /<path d="[^"]*" fill="none" stroke="#111111"[^>]*>(<animate id="first"\/>)<\/path>/);
});

test('markParts with no inner markup draws the first stroke as a self-closing path', () => {
  const { body } = markParts({ c1: '#111111', c2: '#222222' });
  assert.match(body, /stroke="#111111"[^>]*\/>/);
  assert.doesNotMatch(body, /<\/path>/);
});
