import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-md-')), 'keystore.json');
const { renderMarkdown } = await import('../../src/markdown.js');

const HOSTILE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '\u0001javascript:alert(1)',
  'java\u0000script:alert(1)',
  'java\u000bscript:alert(1)',
  '&#106;avascript:alert(1)',
  '&#x6A;avascript:alert(1)',
  'javascript&colon;alert(1)',
  'javascript&#58;alert(1)',
  '&amp;#106;avascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'blob:https://x/1',
  'file:///etc/passwd',
];

test('a hostile link target renders its text with no anchor', () => {
  for (const url of HOSTILE) {
    const html = renderMarkdown(`see [click me](${url}) now`);
    assert.doesNotMatch(html, /<a\b/, `${JSON.stringify(url)} made an anchor: ${html}`);
    assert.match(html, /click me/, 'the link text stays');
  }
});

test('a hostile image source renders its alt text with no image', () => {
  for (const url of [...HOSTILE, 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'DATA:text/html,x']) {
    const html = renderMarkdown(`see ![a picture](${url}) now`);
    assert.doesNotMatch(html, /<img\b/, `${JSON.stringify(url)} made an image: ${html}`);
    assert.match(html, /a picture/, 'the alt text stays');
  }
});

test('ordinary links, anchors and in-app targets still render', () => {
  for (const url of [
    'https://example.com/a?b=c',
    'HTTP://example.com',
    'mailto:kyle@example.com',
    '#section',
    '/w/weave/e/123',
    '#/entity/abc',
    'relative/page.md',
    '?q=1',
    '/api/files/00000000-0000-0000-0000-000000000001',
  ]) {
    const html = renderMarkdown(`[go](${url})`);
    assert.match(html, /<a href="[^"]+"[^>]*>go<\/a>/, `${url}: ${html}`);
  }
  assert.match(renderMarkdown('[[workspace|home]]', { resolveMention: () => ({ href: '#/', label: 'w' }) }), /<a class="mention/);
});

test('ordinary images, including inline raster data, still render', () => {
  for (const url of [
    '/api/files/00000000-0000-0000-0000-000000000001',
    'https://example.com/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/4AAQ',
    'data:image/gif;base64,R0lGODlh',
    'data:image/webp;base64,UklGRg==',
  ]) {
    assert.match(renderMarkdown(`![pic](${url})`), /<img src="[^"]+" alt="pic">/, url);
  }
});

test('a reference whose resolver hands back a hostile href renders as a broken chip', () => {
  const html = renderMarkdown('[[workspace|home]]', { resolveMention: () => ({ href: 'javascript:alert(1)', label: 'w' }) });
  assert.doesNotMatch(html, /<a\b/, html);
  assert.match(html, /mention broken/);
});
