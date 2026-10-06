import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../lib/source.mjs';

const CHILD = `
  import { Weave } from ${JSON.stringify(join(ROOT, 'src/engine.js'))};
  import { startServer } from ${JSON.stringify(join(ROOT, 'src/server.js'))};
  const w = new Weave();
  const refresh = w.maybeRefresh.bind(w);
  // A throw from before the dispatcher's own try/catch.
  w.maybeRefresh = () => { if (globalThis.boom) { globalThis.boom = false; throw new Error('boom'); } return refresh(); };
  const { server } = await startServer(w, { port: 0 });
  server.prependListener('request', (req) => { if (req.url === '/api/health?boom=1') globalThis.boom = true; });
  console.log('PORT ' + server.address().port);
`;

async function child() {
  const env = { ...process.env, WEAVE_KEYSTORE: join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json') };
  const proc = spawn(process.execPath, ['--input-type=module', '-e', CHILD], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = null;
  proc.on('exit', (code) => { exited = code ?? 'signal'; });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    proc.on('exit', () => reject(new Error('server exited before listening')));
  });
  return { proc, base: `http://127.0.0.1:${port}`, exited: () => exited };
}

test('a malformed percent-escape in the path is a 400 and the server keeps serving', async () => {
  const { proc, base, exited } = await child();
  try {
    const bad = await fetch(base + '/%E0%A4%A');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'invalid');
    const bad2 = await fetch(base + '/w/%ZZ/api/health');
    assert.equal(bad2.status, 400);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(exited(), null, 'the server process exited');
    const ok = await fetch(base + '/api/health');
    assert.equal(ok.status, 200);
  } finally { proc.kill(); }
});

test('a throw anywhere in the listener is a 500 and the server keeps serving', async () => {
  const { proc, base, exited } = await child();
  try {
    const boom = await fetch(base + '/api/health?boom=1');
    assert.equal(boom.status, 500);
    assert.doesNotMatch(await boom.text(), /boom/, 'the internal message stays in the log');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(exited(), null, 'the server process exited');
    const ok = await fetch(base + '/api/health');
    assert.equal(ok.status, 200);
  } finally { proc.kill(); }
});
