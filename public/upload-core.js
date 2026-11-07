(function (root) {
  const LIMIT = 10 * 1024 * 1024;
  const NAME_MAX = 48;
  const MB = 1048576;
  const RESTART_WAIT_MS = [2000, 5000, 10000];
  const RESTARTING = 'Server restarting';

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

  const errorId = (err) => (typeof err?.id === 'string' && err.id ? err.id : `HTTP ${err?.status}`);

  function reasonOf(err) {
    if (err?.kind === 'too-large' || err?.status === 413 || err?.code === 'too-large') return 'too-large';
    if (err?.status === 507 || err?.code === 'storage-full') return 'storage-full';
    if (err?.kind === 'timeout' || err?.status === 504) return 'timeout';
    if (err?.kind === 'offline' || err?.code === 'offline') return 'offline';
    if (err?.status === 502 || err?.status === 503) return 'restarting';
    if (err?.status >= 500) return 'server';
    return 'refused';
  }

  function failure(file, err) {
    const name = shortName(file.name);
    const reason = reasonOf(err);
    const limit = sizeText(err?.limit > 0 ? err.limit : LIMIT);
    switch (reason) {
      case 'too-large': return { reason, tile: `Over ${limit}`, retry: false, message: `${name} is ${sizeText(file.size)}, over the ${limit} limit, so it was not saved.` };
      case 'storage-full': return { reason, tile: 'Storage full', retry: false, message: `The weave server is out of storage, so ${name} was not saved. Ask whoever runs your weave to add storage; uploads will work again after that.` };
      case 'restarting': return { reason, tile: 'Still restarting', retry: true, message: `The weave server is still restarting, so ${name} was not saved. Try again in a minute.` };
      case 'server': {
        const id = errorId(err);
        return { reason, id, tile: `Error ${id}`, retry: true, message: `The weave server hit a bug, so ${name} was not saved. Include error ${id} when you report it to whoever runs your weave.` };
      }
      case 'offline': return { reason, tile: 'No connection', retry: true, message: `Could not reach the server; ${name} was not saved. Check your connection.` };
      case 'timeout': return { reason, tile: 'Timed out', retry: true, message: `${name} took too long to upload and was not saved.` };
      default: return { reason, tile: 'Not saved', retry: true, message: err?.error || err?.message || `${name} was not saved.` };
    }
  }

  const nextOf = (f) => (f.retry ? 'retry' : f.reason === 'storage-full' ? null : 'choose');
  const emptyText = (name) => `${shortName(name)} is empty and was saved anyway. Remove it if that was a mistake.`;
  const why = (f) => (f.reason === 'restarting' ? 'the server is still restarting' : `${f.tile[0].toLowerCase()}${f.tile.slice(1)}`);

  function summary(results, { limit = LIMIT } = {}) {
    const total = results.length;
    if (!total) return null;
    const failed = results.filter((r) => !r.ok);
    const done = total - failed.length;
    const empty = results.find((r) => r.ok && r.size === 0);
    if (total === 1) {
      const [r] = results;
      if (r.ok) return empty ? { kind: 'warn', text: emptyText(r.name), action: null } : null;
      return { kind: 'err', text: r.message, action: nextOf(r), ...(r.id ? { mono: r.id } : {}) };
    }
    if (!failed.length) return empty ? { kind: 'warn', text: emptyText(empty.name), action: null } : { kind: 'success', text: `${total} files uploaded.`, action: null };
    const head = `${done} of ${total} files uploaded.`;
    if (failed.length === 1) {
      const [f] = failed;
      return { kind: 'warn', text: `${head} ${shortName(f.name)} was not saved: ${why(f)}.`, action: nextOf(f), ...(f.id ? { mono: f.id } : {}) };
    }
    if (failed.every((f) => f.reason === 'too-large')) {
      return { kind: 'warn', text: `${head} ${failed.length} files were over the ${sizeText(limit)} limit and not saved.`, action: 'choose' };
    }
    const action = failed.some((f) => f.retry) ? 'retry' : failed.every((f) => f.reason === 'storage-full') ? null : 'choose';
    return { kind: 'warn', text: `${head} ${failed.length} files were not saved.`, action };
  }

  function statusText(status, method, id) {
    const read = method === 'GET';
    if ([502, 503, 504].includes(status)) return read ? 'The weave server is restarting. Try again in a minute.' : 'The weave server is restarting, so nothing was saved. Try again in a minute.';
    if (status === 507) return 'The weave server is out of storage, so nothing was saved. Ask whoever runs your weave to add storage.';
    if (status >= 500) return `The weave server hit a bug, so nothing was saved. Include error ${errorId({ id, status })} when you report it to whoever runs your weave.`;
    return `The server refused the request (HTTP ${status})`;
  }
  const serverError = (status, error) => (!error || status === 507 || (status >= 500 && /^Internal error\b/.test(error)) ? null : error);

  root.uploadCore = { LIMIT, NAME_MAX, RESTART_WAIT_MS, RESTARTING, sizeText, tooBig, shortName, reasonOf, failure, emptyText, summary, statusText, serverError };
})(typeof window !== 'undefined' ? window : globalThis);
