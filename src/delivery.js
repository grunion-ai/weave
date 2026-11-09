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
