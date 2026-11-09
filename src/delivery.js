const MINUTE = 60_000;
export const DELIVERY_ATTEMPTS = 8;
export const RETRY_DELAY_CAP_MS = 60 * MINUTE;

export function retryable({ status = null, network = false, refused = false } = {}) {
  if (refused) return false;
  if (network) return true;
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function retryDelayMs(attempt) {
  return Math.min(MINUTE * 2 ** (attempt - 1), RETRY_DELAY_CAP_MS);
}

export function utcMinute(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function waitingReason(error, attempt, cap, next) {
  return `${error}; attempt ${attempt} of ${cap} failed, next try ${utcMinute(next)}`;
}

export function exhaustedReason(error, attempts) {
  return `${error}; gave up after ${attempts} attempt${attempts === 1 ? '' : 's'}`;
}

export class DeliveryError extends Error {
  constructor(message, { status = null, network = false, refused = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable({ status, network, refused });
  }
}

export const DELIVERIES_DESCRIPTION = 'Every webhook or API call an automation could not deliver after its last retry, as a record: the rule, the record that fired it, the request it sent with any credential held by name, each attempt and the last error. Set Status to Replay to send it again; the steps after it then run.';

export const DELIVERY_STATUSES = [
  { name: 'Failed', hue: 'red' },
  { name: 'Replay', hue: 'blue' },
  { name: 'Delivered', hue: 'green' },
];

export function deliveryName(request) {
  const u = new URL(request.url);
  return `${request.method} ${u.host}${u.pathname}`;
}

export function requestText(request) {
  const { method, url, headers, body, signWith, integration } = request;
  return JSON.stringify({ method, url, headers, ...(body !== undefined ? { body } : {}), ...(signWith ? { signWith } : {}), ...(integration ? { integration } : {}) }, null, 2);
}

export function attemptsText(attempts) {
  return attempts.map((a) => `${utcMinute(new Date(a.at))}  ${a.error}`).join('\n');
}

export const INBOUND_WINDOW_MS = 24 * 60 * MINUTE;
export const ECHO_WINDOW_MS = 10 * MINUTE;
export const ECHO_KEEP = 500;

export function claimKey(seen, key, now, windowMs = INBOUND_WINDOW_MS) {
  const kept = Object.fromEntries(Object.entries(seen ?? {}).filter(([, at]) => now - at <= windowMs));
  if (key in kept) return { duplicate: true, firstAt: kept[key], seen: kept };
  return { duplicate: false, firstAt: now, seen: { ...kept, [key]: now } };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function matchesEcho(writes, change, now, windowMs = ECHO_WINDOW_MS) {
  const keys = Object.keys(change?.values ?? {});
  if (!keys.length) return false;
  return (writes ?? []).some((w) => w.source === change.source && now - w.at <= windowMs
    && (change.record == null || change.record === w.record || change.record === w.publicId)
    && keys.every((k) => w.values && k in w.values && same(w.values[k], change.values[k])));
}

export function sentValues(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
