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
