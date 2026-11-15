import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';

const { Weave } = await import('../src/engine.js');

const realLookup = dns.lookup;
const realFetch = globalThis.fetch;
const realAllow = process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;

test('an http-request step to a host that does not resolve fails with its own reason before any request leaves', async (t) => {
  delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
  const lookups = [];
  const sent = [];
  dns.lookup = async (host) => {
    lookups.push(host);
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  };
  syncBuiltinESMExports();
  globalThis.fetch = async (url) => { sent.push(String(url)); throw new Error('no network in this test'); };
  t.after(() => {
    dns.lookup = realLookup;
    syncBuiltinESMExports();
    globalThis.fetch = realFetch;
    if (realAllow === undefined) delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE; else process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = realAllow;
  });

  const w = new Weave({ actor: 'kyle' });
  w.createSpace({ name: 'Sales' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  const auto = w.createAutomation(deal.id, {
    name: 'Notify',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'http-request', method: 'POST', url: 'https://hooks.nowhere.test/deals', body: 'new deal' }],
  });
  w.createEntity(deal.id, { Name: 'Open' });
  await w.automationsSettled();

  const fields = w.readEntity(auto.id).fields;
  assert.deepEqual(lookups, ['hooks.nowhere.test']);
  assert.deepEqual(sent, [], 'nothing was sent to a host that cannot be resolved');
  assert.equal(fields.Health, 'Warning');
  assert.match(fields['Health Reason'], /could not resolve hooks\.nowhere\.test \(ENOTFOUND\)/);
});
