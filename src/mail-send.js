export const RESEND_URL = 'https://api.resend.com/emails';

export function createMailer({ key, from, fetch = globalThis.fetch }) {
  return async function send({ to, subject, html, text, idempotencyKey }) {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Resend answered ${res.status}${idempotencyKey ? '' : `: ${body.split(key).join('••••').slice(0, 300)}`}`), { status: res.status });
    return body ? JSON.parse(body) : {};
  };
}

export function mailerFromEnv(env = process.env, opts = {}) {
  const key = String(env.WEAVE_MAIL_KEY ?? '').trim();
  const from = String(env.WEAVE_MAIL_FROM ?? '').trim();
  return key && from ? createMailer({ key, from, ...opts }) : null;
}
