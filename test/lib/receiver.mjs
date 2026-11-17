import { createServer } from 'node:http';

export const reply = (res, status = 200, text = '{}') => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(text); };

export async function receiver(answer = (req, res) => reply(res), { host = null } = {}) {
  const seen = [];
  const sent = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    answer(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const real = globalThis.fetch;
  if (host) {
    globalThis.fetch = (url, init) => {
      const u = new URL(String(url));
      sent.push(u.href);
      if (u.protocol === 'https:' && u.hostname === host) { u.protocol = 'http:'; u.host = `127.0.0.1:${port}`; }
      return real(u, init);
    };
  }
  return {
    seen, sent, port, base: `http://127.0.0.1:${port}`,
    close: () => { if (host) globalThis.fetch = real; server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}

export async function endpoint({ id = 'remote-1', host = null } = {}) {
  const plan = [];
  const hook = await receiver((req, res) => {
    const next = plan.length ? plan.shift() : 200;
    if (next === 'hang') return;
    reply(res, next, next < 300 ? `{"id":"${id}"}` : '{"error":"down"}');
  }, { host });
  return { ...hook, url: `${hook.base}/hook`, fail: (...codes) => plan.push(...codes) };
}
