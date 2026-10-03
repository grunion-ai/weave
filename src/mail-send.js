/* Sending weave's email (Feature #216): one POST to Resend's API, no SDK,
   no imports. Off unless the operator sets both WEAVE_MAIL_KEY (a Resend API
   key) and WEAVE_MAIL_FROM (the sender, e.g. "weave <no-reply@mail.example.com>",
   on a domain Resend has verified). The templates are src/mail.js. */
export const RESEND_URL = 'https://api.resend.com/emails';

/* send({ to, subject, html, text }) resolves to Resend's answer ({ id }) or
   throws with its status and message. Ten seconds, then it gives up, so a
   stuck provider cannot hold an invite open. */
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
