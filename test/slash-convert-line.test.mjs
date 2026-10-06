import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

const M = (kind) => LIB.blockMarker(kind);

test('a paragraph becomes a task, a quote, a list item or a heading', () => {
  assert.equal(LIB.convertLine('Buy milk', 'task'), '- [ ] Buy milk');
  assert.equal(LIB.convertLine('Buy milk', 'quote'), '> Buy milk');
  assert.equal(LIB.convertLine('Buy milk', 'bullet'), '- Buy milk');
  assert.equal(LIB.convertLine('Buy milk', 'number'), '1. Buy milk');
  assert.equal(LIB.convertLine('Buy milk', 'h1'), '# Buy milk');
  assert.equal(LIB.convertLine('Buy milk', 'h6'), '###### Buy milk');
});

test('the old block marker comes off before the new one goes on', () => {
  assert.equal(LIB.convertLine('## Plan', 'task'), '- [ ] Plan', 'heading to task');
  assert.equal(LIB.convertLine('- [ ] Plan', 'h2'), '## Plan', 'task to heading');
  assert.equal(LIB.convertLine('- [x] Done', 'h2'), '## Done', 'a checked box goes with its marker');
  assert.equal(LIB.convertLine('- [X] Done', 'bullet'), '- Done');
  assert.equal(LIB.convertLine('- [ ]  Plan', 'h3'), '### Plan');
  assert.equal(LIB.convertLine('- item', 'number'), '1. item', 'bulleted to numbered');
  assert.equal(LIB.convertLine('* item', 'number'), '1. item');
  assert.equal(LIB.convertLine('+ item', 'task'), '- [ ] item');
  assert.equal(LIB.convertLine('3. third', 'bullet'), '- third');
  assert.equal(LIB.convertLine('3) third', 'quote'), '> third');
  assert.equal(LIB.convertLine('1. [ ] numbered task', 'bullet'), '- numbered task');
  assert.equal(LIB.convertLine('> quoted', 'h1'), '# quoted');
  assert.equal(LIB.convertLine('> > twice', 'bullet'), '- twice', 'every quote caret on the line');
  assert.equal(LIB.convertLine('### Plan', 'h1'), '# Plan', 'a heading changes level');
});

test('Text takes the line back to a plain paragraph', () => {
  assert.equal(LIB.convertLine('## Plan', 'text'), 'Plan');
  assert.equal(LIB.convertLine('- [ ] Plan', 'text'), 'Plan');
  assert.equal(LIB.convertLine('> Plan', 'text'), 'Plan');
  assert.equal(LIB.convertLine('1. Plan', 'text'), 'Plan');
  assert.equal(LIB.convertLine('Plan', 'text'), 'Plan');
});

test('inline marks ride along untouched', () => {
  const line = '**Buy** `milk` and [eggs](https://example.com) for [[Task#12|the cake]]';
  assert.equal(LIB.convertLine(line, 'task'), `- [ ] ${line}`);
  assert.equal(LIB.convertLine(`## ${line}`, 'quote'), `> ${line}`);
  assert.equal(LIB.convertLine('*soon* and **now**', 'bullet'), '- *soon* and **now**');
  assert.equal(LIB.convertLine('**now**', 'h2'), '## **now**');
  assert.equal(LIB.convertLine('#tag first', 'task'), '- [ ] #tag first');
});

test('a nested item keeps its indent', () => {
  assert.equal(LIB.convertLine('  - two', 'number'), '  1. two');
  assert.equal(LIB.convertLine('   1. two', 'bullet'), '   - two');
  assert.equal(LIB.convertLine('    - [ ] deep', 'bullet'), '    - deep');
  assert.equal(LIB.convertLine('\t- tabbed', 'task'), '\t- [ ] tabbed');
});

test('a line with no words gets the placeholder, because an empty marker is not a block', () => {
  assert.equal(LIB.convertLine('', 'task'), '- [ ] To do');
  assert.equal(LIB.convertLine('', 'bullet'), '- List item');
  assert.equal(LIB.convertLine('', 'number'), '1. List item');
  assert.equal(LIB.convertLine('', 'quote'), '> Quote');
  assert.equal(LIB.convertLine('', 'h1'), '# Heading');
  assert.equal(LIB.convertLine('', 'h4'), '#### Heading');
  assert.equal(LIB.convertLine('', 'text'), 'Text');
  assert.equal(LIB.convertLine('   ', 'task'), '- [ ] To do', 'spaces are not words');
  assert.equal(LIB.convertLine('## ', 'quote'), '> Quote', 'a bare marker is an empty line');
  assert.equal(LIB.convertLine('- [ ] ', 'h2'), '## Heading');
  assert.equal(LIB.convertLine('  - ', 'number'), '  1. List item', 'and the indent still holds');
});

test('an unknown command changes nothing', () => {
  assert.equal(LIB.convertLine('## Plan', 'table'), '## Plan');
  assert.equal(LIB.convertLine('## Plan', undefined), '## Plan');
});

test('the marker is invisible, names its command, and is found again', () => {
  for (const kind of ['text', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'bullet', 'number', 'task', 'quote']) {
    const marker = M(kind);
    assert.match(marker, /^\u2063.+\u2063$/, 'same U+2063 fence as a reference marker');
    assert.equal(`a ${marker} b`.match(LIB.BLOCK_MARKER_RE)?.[1], kind);
  }
  assert.equal('\u2063ref:entity\u2063'.match(LIB.BLOCK_MARKER_RE), null, 'a reference marker is not a block marker');
  assert.equal('\u2063raw-html\u2063'.match(LIB.BLOCK_MARKER_RE), null);
});

test('a document without a marker is left alone', () => {
  assert.equal(LIB.convertMarkedLine('## Plan\n\nBuy milk\n'), null);
  assert.equal(LIB.convertMarkedLine(''), null);
  assert.equal(LIB.convertMarkedLine(null), null);
});

test('only the line that holds the marker is rewritten', () => {
  const out = LIB.convertMarkedLine(`# Title\n\n## Plan ${M('task')}\n\nBuy milk\n`);
  assert.deepEqual(out, { md: '# Title\n\n- [ ] Plan\n\nBuy milk\n', line: 2 });
});

test('the words on both sides of the caret survive', () => {
  assert.equal(LIB.convertMarkedLine(`Buy milk ${M('task')} today\n`).md, '- [ ] Buy milk today\n');
  assert.equal(LIB.convertMarkedLine(`${M('h2')} Plan\n`).md, '## Plan\n', 'marker first');
  assert.equal(LIB.convertMarkedLine(`## Plan${M('quote')}\n`).md, '> Plan\n', 'marker glued to the last word');
  assert.equal(LIB.convertMarkedLine(`**Buy** ${M('bullet')} *milk*\n`).md, '- **Buy** *milk*\n');
});

test('a marker alone on its line is the empty-line case', () => {
  assert.deepEqual(LIB.convertMarkedLine(`${M('task')}\n`), { md: '- [ ] To do\n', line: 0 });
  assert.deepEqual(LIB.convertMarkedLine(`Intro\n\n${M('h3')}\n`), { md: 'Intro\n\n### Heading\n', line: 2 });
});

test('a nested item converts in place inside its list', () => {
  const out = LIB.convertMarkedLine(`- one\n  - two ${M('number')}\n  - three\n`);
  assert.deepEqual(out, { md: '- one\n  1. two\n  - three\n', line: 1 });
  assert.equal(LIB.convertMarkedLine(`- one\n- two ${M('task')}\n- three\n`).md, '- one\n- [ ] two\n- three\n',
    'list to list needs no blank lines');
});

test('a line that stops being a list item is set apart, so it cannot fold into its neighbours', () => {
  assert.deepEqual(LIB.convertMarkedLine(`- a\n- b ${M('text')}\n- c\n`), { md: '- a\n\nb\n\n- c\n', line: 2 });
  assert.deepEqual(LIB.convertMarkedLine(`- a\n- b ${M('h2')}\n- c\n`), { md: '- a\n\n## b\n\n- c\n', line: 2 });
  assert.deepEqual(LIB.convertMarkedLine(`one\ntwo ${M('quote')}\nthree\n`), { md: 'one\n\n> two\n\nthree\n', line: 2 });
  assert.deepEqual(LIB.convertMarkedLine(`a\n\n## b ${M('text')}\n\nc\n`), { md: 'a\n\nb\n\nc\n', line: 2 });
  assert.deepEqual(LIB.convertMarkedLine(`## b ${M('text')}`), { md: 'b', line: 0 }, 'first and last line');
});

test('a table row and a line of code lose the marker and nothing else', () => {
  assert.deepEqual(LIB.convertMarkedLine(`| a ${M('task')} | b |\n| --- | --- |\n`),
    { md: '| a | b |\n| --- | --- |\n', line: -1 });
  assert.deepEqual(LIB.convertMarkedLine(`\`\`\`\nconst a = 1; ${M('h1')}\n\`\`\`\n`),
    { md: '```\nconst a = 1;\n```\n', line: -1 });
  assert.equal(LIB.convertMarkedLine(`\`\`\`\ncode\n\`\`\`\n\nPlan ${M('h1')}\n`).md, '```\ncode\n```\n\n# Plan\n');
});

const ITEMS = APP.slice(APP.indexOf('function slashItems'), APP.indexOf('function entityReference'));
const insertOf = (label) => ITEMS.match(new RegExp(`label: '${label}'[^\\n]*?insert: ([^\\n]*?) \\},?\\n`))?.[1];

test('every line-prefix command travels as a block marker', () => {
  assert.equal(insertOf('Text'), "blockMarker('text')");
  assert.equal(insertOf('Heading 1–6'), "blockMarker('h1')");
  assert.equal(insertOf('Bulleted list'), "blockMarker('bullet')");
  assert.equal(insertOf('Numbered list'), "blockMarker('number')");
  assert.equal(insertOf('Task list'), "blockMarker('task')");
  assert.equal(insertOf('Quote'), "blockMarker('quote')");
  assert.match(ITEMS, /insert: blockMarker\(`h\$\{n\}`\)/, 'and so do the six hidden heading levels');
});

test('blocks that are not a line prefix still insert', () => {
  for (const label of ['Code block', 'Mermaid diagram', 'Divider', 'Line break', 'Image', 'Raw HTML', 'Bold', 'Italic', 'Link']) {
    const insert = insertOf(label);
    assert.ok(insert, `${label} is in the catalogue`);
    assert.doesNotMatch(insert, /blockMarker/, `${label} is an insert`);
  }
  assert.equal(ITEMS.match(/blockMarker\(/g).length, 7, 'six rows and the heading template, no more');
});

test('the editor rewrites the marked line as it lands, puts the caret at its end and saves', () => {
  const watch = APP.slice(APP.indexOf('function watchCommandMarkers'), APP.indexOf('function applyCommandMarkers'));
  assert.match(watch, /new MutationObserver\(/, 'a marker is seen the moment it is in the surface');
  assert.match(watch, /applyCommandMarkers\(host, editor, onInput\)/);
  assert.match(watch, /holdsCommandMarker\(n\.textContent\)/, 'every command marker, not only a block one (Issue #456)');
  assert.match(APP, /after: \(\) => \{[\s\S]*?watchCommandMarkers\(host, editor, onInput\);[\s\S]*?\n    \},/, 'every editor watches its own surface');

  const apply = APP.slice(APP.indexOf('function applyCommandMarkers'), APP.indexOf('const CARET_SENTINEL'));
  assert.match(apply, /pickReference\(editor, v, ref\[0\], ref\[1\], onInput\)/, 'a reference hands off to the picker on the keypress');
  assert.match(apply, /convertBlockLine\(host, editor, onInput\)/, 'a block line is rewritten');
  assert.match(apply, /editor\.setValue\(next\);/, 'a deferred insert is swapped in the task the marker lands in, never on a timer');
  assert.doesNotMatch(apply, /queueMicrotask/, 'nothing waits for a later turn (Issue #456)');

  const settle = APP.slice(APP.indexOf('function convertBlockLine'), APP.indexOf('function pickReference'));
  assert.match(settle, /convertMarkedLine\(md\)/, 'the rewrite is the library\'s, on the markdown');
  assert.match(settle, /editor\.setValue\(/, 'the whole document is written, the path that round-trips');
  assert.match(settle, /lines\[next\.line\] \+= token;/, 'a sentinel marks the end of the converted line');
  assert.match(settle, /caretToToken\(host, token\)/, 'and the caret takes its place');
  assert.match(settle, /onInput\(editor\.getValue\(\)\)/, 'what the editor holds is saved through the same debounce as typing');
  assert.ok(settle.indexOf('caretToToken(host, token)') < settle.indexOf('onInput(editor.getValue())'),
    'the sentinel is out of the surface before the document is read for saving');

  const at = APP.indexOf('input: (v) => {');
  const handler = APP.slice(at, APP.indexOf('liveEditors.add(editor)', at));
  assert.match(handler, /holdsCommandMarker\(v\)\) return applyCommandMarkers\(/, 'a marker that reaches the input handler is applied, never saved');
});
