import { request } from 'node:http';
import { CLERK_API } from '../../src/billing.js';

export const hit = (port, host, method, path, { cookie, body, token, ua, headers = {} } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ua ? { 'User-Agent': ua } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});

export const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(';')[0];

export const clerkAt = (routes) => async (url, init = {}) => {
  const hit = routes[`${init.method ?? 'GET'} ${String(url).slice(CLERK_API.length).split('?')[0]}`];
  const [status, body] = hit ?? [404, { errors: [{ code: 'resource_not_found' }] }];
  return new Response(JSON.stringify(body), { status });
};
