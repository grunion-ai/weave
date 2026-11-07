(function (root) {
  const LIMIT = 10 * 1024 * 1024;
  const NAME_MAX = 48;
  const MB = 1048576;

  const sizeText = (n) => {
    if (n < MB) return `${Math.ceil(n / 1024)} KB`;
    const mb = Math.ceil((n / MB) * 10) / 10;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  };
  const tooBig = (file, limit = LIMIT) => !!file && file.size > limit;

  function shortName(name, max = NAME_MAX) {
    const chars = Array.from(String(name));
    if (chars.length <= max) return chars.join('');
    const ext = Array.from(String(name).match(/\.[^.\s]{1,10}$/)?.[0] ?? '');
    const stem = chars.slice(0, chars.length - ext.length);
    const room = max - 1 - ext.length;
    const head = Math.ceil(room * 0.6);
    const tail = room - head;
    return stem.slice(0, head).join('') + '…' + (tail > 0 ? stem.slice(-tail).join('') : '') + ext.join('');
  }

  function reasonOf(err) {
    if (err?.kind === 'too-large' || err?.status === 413 || err?.code === 'too-large') return 'too-large';
    if (err?.kind === 'timeout') return 'timeout';
    if (err?.kind === 'offline' || err?.code === 'offline') return 'offline';
    if ([502, 503, 504].includes(err?.status)) return 'unavailable';
    if (err?.status >= 500) return 'server';
    return 'refused';
  }

  function failure(file, err) {
    const name = shortName(file.name);
    const reason = reasonOf(err);
    const limit = sizeText(err?.limit > 0 ? err.limit : LIMIT);
    switch (reason) {
      case 'too-large': return { reason, tile: `Over ${limit}`, retry: false, message: `${name} is ${sizeText(file.size)}, over the ${limit} limit, so it was not saved.` };
      case 'server': return { reason, tile: 'Server error', retry: true, message: `The server returned an error, so ${name} was not saved.` };
      case 'unavailable': return { reason, tile: 'Server unavailable', retry: true, message: `The server is unavailable, so ${name} was not saved.` };
      case 'offline': return { reason, tile: 'No connection', retry: true, message: `Could not reach the server; ${name} was not saved. Check your connection.` };
      case 'timeout': return { reason, tile: 'Timeout', retry: true, message: `${name} took too long to upload and was not saved.` };
      default: return { reason, tile: 'Not saved', retry: true, message: err?.error || err?.message || `${name} was not saved.` };
    }
  }

  const emptyText = (name) => `${shortName(name)} is empty and was saved anyway. Remove it if that was a mistake.`;

  function summary(results, { limit = LIMIT } = {}) {
    const total = results.length;
    if (!total) return null;
    const failed = results.filter((r) => !r.ok);
    const done = total - failed.length;
    const empty = results.find((r) => r.ok && r.size === 0);
    if (total === 1) {
      const [r] = results;
      if (r.ok) return empty ? { kind: 'warn', text: emptyText(r.name), action: null } : null;
      return { kind: 'err', text: r.message, action: r.retry ? 'retry' : 'choose' };
    }
    if (!failed.length) return empty ? { kind: 'warn', text: emptyText(empty.name), action: null } : { kind: 'success', text: `${total} files uploaded.`, action: null };
    const head = `${done} of ${total} files uploaded.`;
    if (failed.length === 1) {
      const [f] = failed;
      return { kind: 'warn', text: `${head} ${shortName(f.name)} was not saved: ${f.tile[0].toLowerCase()}${f.tile.slice(1)}.`, action: f.retry ? 'retry' : 'choose' };
    }
    if (failed.every((f) => f.reason === 'too-large')) {
      return { kind: 'warn', text: `${head} ${failed.length} files were over the ${sizeText(limit)} limit and not saved.`, action: 'choose' };
    }
    return { kind: 'warn', text: `${head} ${failed.length} files were not saved.`, action: failed.some((f) => f.retry) ? 'retry' : 'choose' };
  }

  function statusText(status, method) {
    const saved = method === 'GET' ? '' : '; nothing was saved';
    if ([502, 503, 504].includes(status)) return `The server is unavailable${saved}`;
    if (status >= 500) return `The server returned an error${saved}`;
    return `The server refused the request (HTTP ${status})`;
  }
  const serverError = (status, error) => (!error || (status >= 500 && /^Internal error\b/.test(error)) ? null : error);

  root.uploadCore = { LIMIT, NAME_MAX, sizeText, tooBig, shortName, reasonOf, failure, emptyText, summary, statusText, serverError };
})(typeof window !== 'undefined' ? window : globalThis);
