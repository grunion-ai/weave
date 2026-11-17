export function memoryBucket({ from = '2026-11-11T04:00:00Z', sorted = true, signed = false, lengths = true, multipart = true } = {}) {
  const objects = new Map();
  const uploads = new Map();
  const requests = [];
  const aborted = [];
  let made = 0;
  let clock = Date.parse(from);
  const fetchImpl = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const u = new URL(url);
    const key = u.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const bytes = body == null ? Buffer.alloc(0) : Buffer.from(body);
    requests.push({ method, path: u.pathname, key, query: Object.fromEntries(u.searchParams), bytes: bytes.length });
    if (signed && !String(headers.Authorization ?? '').startsWith('AWS4-HMAC-SHA256 ')) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    const uploadId = multipart ? u.searchParams.get('uploadId') : null;
    if (multipart && method === 'POST' && u.searchParams.has('uploads')) {
      const id = `upload-${++made}`;
      uploads.set(id, []);
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (uploadId && !uploads.has(uploadId)) return new Response('<Error><Code>NoSuchUpload</Code></Error>', { status: 404 });
    if (method === 'PUT' && uploadId) { uploads.get(uploadId).push(bytes); return new Response('', { headers: { ETag: `"part-${u.searchParams.get('partNumber')}"` } }); }
    if (method === 'POST' && uploadId) { objects.set(key, { body: Buffer.concat(uploads.get(uploadId)), at: new Date(clock += 1000).toISOString() }); uploads.delete(uploadId); return new Response('<CompleteMultipartUploadResult/>'); }
    if (method === 'DELETE' && uploadId) { uploads.delete(uploadId); aborted.push(uploadId); return new Response(null, { status: 204 }); }
    if (method === 'PUT') { objects.set(key, { body: bytes, at: new Date(clock += 1000).toISOString() }); return new Response(''); }
    if (method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const rows = [...objects].filter(([k]) => k.startsWith(prefix));
      if (sorted) rows.sort(([a], [b]) => (a < b ? -1 : 1));
      return new Response(`<ListBucketResult>${rows.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.at}</LastModified><Size>${o.body.length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    const o = objects.get(key);
    if (!o) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    return lengths ? new Response(o.body, { headers: { 'Content-Length': String(o.body.length) } }) : new Response(o.body);
  };
  return { objects, uploads, requests, aborted, fetchImpl };
}
