export const RESEND_URL = 'https://api.resend.com/emails';

export function createMailer({ key, from, fetch = globalThis.fetch }) {
  return async function send({ to, subject, html, text }) {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Resend answered ${res.status}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : {};
  };
}

export function mailerFromEnv(env = globalThis.process?.env ?? {}, opts = {}) {
  const key = String(env.WEAVE_MAIL_KEY ?? '').trim();
  const from = String(env.WEAVE_MAIL_FROM ?? '').trim();
  return key && from ? createMailer({ key, from, ...opts }) : null;
}
