import { WeaveError } from './store.js';

export const ERROR_CONTRACT = Object.freeze({
  invalid: { http: 400, mcp: -32602, exit: 40 },
  ambiguous: { http: 400, mcp: -32602, exit: 41 },
  slug_invalid: { http: 400, mcp: -32602, exit: 40 },
  slug_reserved: { http: 400, mcp: -32602, exit: 40 },
  forbidden: { http: 403, mcp: -32003, exit: 46 },
  'not-found': { http: 404, mcp: -32001, exit: 44 },
  conflict: { http: 409, mcp: -32002, exit: 45 },
  slug_taken: { http: 409, mcp: -32002, exit: 45 },
  stale: { http: 412, mcp: -32004, exit: 47 },
  'too-large': { http: 413, mcp: -32005, exit: 48 },
  'unsupported-type': { http: 415, mcp: -32006, exit: 49 },
  'rate-limited': { http: 429, mcp: -32007, exit: 50 },
  'weave-error': { http: 400, mcp: -32000, exit: 1 },
  'storage-full': { http: 507, mcp: -32008, exit: 51 },
  internal: { http: 500, mcp: -32603, exit: 70 },
});

export const storageFull = (err) => err?.code === 'ENOSPC' || err?.code === 'SQLITE_FULL' || err?.errcode === 13 || /database or disk is full/.test(String(err?.message ?? ''));

const codeOf = (err) => {
  if (err instanceof WeaveError) return Object.hasOwn(ERROR_CONTRACT, err.code) ? err.code : 'weave-error';
  return storageFull(err) ? 'storage-full' : 'internal';
};

export function contractFor(err) {
  const code = codeOf(err);
  return { code, ...ERROR_CONTRACT[code] };
}

export const statusFor = (err) => contractFor(err).http;

export function errorBody(err) {
  if (err instanceof WeaveError) return { error: err.message, code: err.code ?? 'weave-error' };
  const id = crypto.randomUUID().slice(0, 8);
  if (typeof console !== 'undefined') console.error(`weave: request ${id} failed:`, err);
  if (storageFull(err)) return { error: 'The weave server is out of storage, so nothing was saved. Ask whoever runs your weave to add storage.', code: 'storage-full', id };
  return { error: `Internal error (request ${id})`, code: 'internal', id };
}

export function mcpToolError(err) {
  const error = err?.message ?? String(err);
  const { code, mcp } = contractFor(err);
  const named = err instanceof WeaveError ? err.code ?? code : code;
  return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true, structuredContent: { error, code: named, rpc: mcp } };
}

export function cliFailure(err) {
  const { code, exit } = contractFor(err);
  const named = err instanceof WeaveError ? err.code ?? code : code;
  return { line: `weave: error [${named}]: ${err?.message ?? String(err)}`, exit };
}

export function nonNegativeInteger(name, value, fallback = 0) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new WeaveError(`${name} must be a whole number of rows, not '${value}'`, 'invalid');
  return n;
}
