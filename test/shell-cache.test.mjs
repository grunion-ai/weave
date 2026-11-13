import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { writeFileSync, utimesSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { Weave } from '../src/engine.js';
import { createShell } from '../src/server.js';
import { withServer } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const INDEX = `${sep}public${sep}index.html`;

async function countingShellReads(run) {
  const read = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function readFileSync(file, ...rest) {
    if (String(file).endsWith(INDEX)) reads.push(String(file));
    return read.call(this, file, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await run();
    return reads.length;
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
}

const sha = (text) => createHash('sha1').update(text).digest('hex');

test('a shell built once serves every head from the same template and follows a file change at its next check (Issue #1639)', () => {
  const dir = tempDir('weave-shell-');
  const write = (file, text, at) => {
    writeFileSync(join(dir, file), text);
    utimesSync(join(dir, file), at, at);
  };
  write('index.html', '<head><title>Weave</title><script src="/a.js" defer></script>\n<script src="/app.js" defer></script></head>', new Date(1e12));
  write('a.js', 'one', new Date(1e12));
  write('app.js', 'app', new Date(1e12));
  write('head.js', 'head', new Date(1e12));
  let clock = 0;
  const shell = createShell(dir, { extra: '<script src="/extra.js" defer></script>\n', every: 1000, now: () => clock });
  const v = (text) => sha(text).slice(0, 12);

  const bare = shell();
  assert.equal(bare.body, `<head><title>Weave</title><script src="/a.js?v=${v('one')}" defer></script>\n<script src="/extra.js" defer></script>\n<script src="/app.js?v=${v('app')}" defer></script></head>`);
  assert.equal(bare.etag, `W/"${sha(bare.body).slice(0, 16)}"`);
  const headed = shell('<title>Deal #1</title><script src="/head.js"></script>');
  assert.equal(headed.body, bare.body.replace('<title>Weave</title>', `<title>Deal #1</title><script src="/head.js?v=${v('head')}"></script>`));
  assert.equal(headed.etag, `W/"${sha(headed.body).slice(0, 16)}"`);

  write('a.js', 'two', new Date(2e12));
  clock = 999;
  assert.equal(shell().body, bare.body, 'within the check window the built template is served as is');
  clock = 1000;
  assert.match(shell().body, new RegExp(`/a\\.js\\?v=${v('two')}"`), 'an asset edit shows at the next check');
  write('extra.js', 'extra', new Date(2e12));
  clock = 2000;
  assert.match(shell().body, new RegExp(`/extra\\.js\\?v=${v('extra')}"`), 'a script the server adds is versioned once it exists');
  write('index.html', '<head><title>Weave 2</title></head>', new Date(3e12));
  clock = 3000;
  assert.equal(shell().body, '<head><title>Weave 2</title></head>', 'an index.html edit shows at the next check');
  assert.equal(shell('<title>Deal #2</title>').body, '<head><title>Deal #2</title></head>', 'a head fills the title slot of the new template');
});

test('the shell is read and templated once, not on every page request (Issue #1639)', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deals' });
  const row = w.createEntity(t.id, { Name: 'Acme renewal' });
  const pages = [];
  const reads = await countingShellReads(() => withServer(w, async ({ fetch: get }) => {
    for (let i = 0; i < 4; i++) {
      for (const path of ['/', `/e/${row.id}`, `/t/${t.id}`]) {
        const res = await get(path);
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.ok(res.headers.get('etag').includes(createHash('sha1').update(body).digest('hex').slice(0, 16)), `${path}: the ETag is a hash of the served shell`);
        pages.push(body);
      }
    }
  }));
  assert.equal(reads, 1, 'index.html is read once per build, however many pages are served');
  assert.match(pages[1], /Acme renewal/, 'each permalink still gets its own preview head');
  assert.match(pages[1], /src="\/permalink\.js\?v=[0-9a-f]{12}"/, 'the head names its script at the current version');
});
