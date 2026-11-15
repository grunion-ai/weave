import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

test('the backups door reads the account token only from an Authorization header that starts with Bearer', async () => {
  const w = new Weave({ name: 'vault' });
  const { token } = w.createAccount({ name: 'owner', role: 'architect' });
  const { server, port } = await startServer(w, { port: 0, cloudBackups: null });
  const get = (authorization) => fetch(`http://127.0.0.1:${port}/api/backups`, { headers: { Authorization: authorization } });
  try {
    const proper = await get(`Bearer ${token}`);
    assert.equal(proper.status, 400, 'a Bearer header names the account, so the door reaches the missing-bucket answer');
    for (const header of [`xBearer ${token}`, `Basic ${token}`, token]) {
      const res = await get(header);
      assert.equal(res.status, 401, header.replace(token, '<token>'));
    }
  } finally {
    server.close();
  }
});
