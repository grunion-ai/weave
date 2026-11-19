import { request as httpsRequest } from 'node:https';

export const SUITE = 'edge';
export const PATH = '/api/health';
export const ROUNDS = 3;
export const HOSTS = ['weave.grunion.ai', 'dev.weave.grunion.ai'];
export const TIMEOUT_MS = 10_000;
export const BUDGET = { 'first-byte': 350, 'after-tls': 250 };
export const BUDGET_SOURCE = 'Issue #1268 measured 507 to 518 ms to the first byte of a fresh connection, 50 to 58 ms of it TLS; the same host answered 124 to 126 ms with 47 to 51 ms of TLS once the wait cleared. Both budgets sit between the two, so a return of the wait reads as a miss and a healthy reading from a shared runner does not.';

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function readingsFor(host, samples) {
  if (!samples.length) return [];
  const reading = (name, values) => ({
    suite: SUITE,
    key: `${host}|${name}`,
    value: Math.round(median(values)),
    budget: BUDGET[name],
    runs: values.map((v) => Math.round(v)),
  });
  return [
    reading('first-byte', samples.map((s) => s.firstByte)),
    reading('after-tls', samples.map((s) => s.firstByte - s.tls)),
  ];
}

export async function probe(io, { hosts = HOSTS, rounds = ROUNDS } = {}) {
  const readings = [];
  const skipped = [];
  for (const host of hosts) {
    const samples = [];
    for (let round = 1; round <= rounds; round++) {
      const taken = await io.sample(host);
      const wrong = taken.error ?? (taken.status === 200 ? null : `HTTP ${taken.status}`);
      if (wrong) {
        skipped.push(`${host} answered nothing on round ${round}: ${wrong}`);
        samples.length = 0;
        break;
      }
      samples.push(taken);
    }
    readings.push(...readingsFor(host, samples));
  }
  return { readings, skipped };
}

export function sample(host, { requestImpl = httpsRequest, path = PATH, timeoutMs = TIMEOUT_MS } = {}) {
  const [name, port] = String(host).split(':');
  return new Promise((resolve) => {
    const began = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - began) / 1e6;
    let tls = null;
    const req = requestImpl({ host: name, ...(port ? { port: Number(port) } : {}), path, method: 'GET', agent: false, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      const firstByte = ms();
      res.resume();
      resolve({ host, status: res.statusCode, tls: tls ?? firstByte, firstByte });
    });
    req.on('socket', (socket) => {
      socket.once('connect', () => { tls ??= ms(); });
      socket.once('secureConnect', () => { tls = ms(); });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer in ${timeoutMs} ms`)));
    req.on('error', (error) => resolve({ host, error: error.message }));
    req.end();
  });
}

export const realIO = () => ({ sample: (host) => sample(host) });
