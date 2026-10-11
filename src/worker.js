import { Weave, WeaveError } from './engine.js';
import { CFStore } from './store-cf.js';
import { createRequestHandler, decodePath, statusFor } from './routes.js';

export class WeaveWorkspace {
  #handle = null;
  #bootedAt = null;

  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  #boot(name) {
    if (this.#handle) return;
    this.#bootedAt = Date.now();
    const store = new CFStore(this.ctx.storage);
    const weave = new Weave({ store, actor: 'web', name });
    if (!weave.state.meta.name || weave.state.meta.name === 'Weave Workspace') {
      weave.state.meta.name = name;
      weave.save();
    }
    const self = weave.state.meta.name;
    const hub = {
      get defaultName() { return self; },
      get(n) { return (n === self || (n === 'weave' && self === 'weaver')) ? weave : null; },
      rename() { throw new WeaveError('Workspace rename is not yet available on the hosted instance', 'invalid'); },
      create() { throw new WeaveError('Workspace creation is not yet available on the hosted instance', 'invalid'); },
      list() {
        return [{
          name: self, default: true,
          spaces: weave.listSpaces().length,
          tables: weave.userTables().length,
          entities: Object.keys(weave.state.entities).length,
          logo: !!weave.state.meta.logo,
        }];
      },
      entries() { return [[self, weave]]; },
    };
    this.#handle = createRequestHandler(hub, {
      version: this.env.WEAVE_VERSION || 'dev',
      uptime: () => (Date.now() - this.#bootedAt) / 1000,
      serveStatic: null,
      anonymousForms: ['1', 'true'].includes(String(this.env.WEAVE_ANONYMOUS_FORMS ?? '').toLowerCase()),
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.#boot(request.headers.get('x-weave-workspace') || this.env.DEFAULT_WORKSPACE || 'weave');
    try {
      const path = decodePath(url.pathname);
      const from = request.headers.get('origin');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && (request.headers.get('sec-fetch-site') === 'cross-site' || (from !== null && from.toLowerCase() !== url.origin.toLowerCase()))) throw new WeaveError('Cross-site write refused', 'forbidden');
      const form = request.method === 'POST' && /^(?:\/w\/[^/]+)?\/(?:f\/[^/]+|api\/forms\/[^/]+\/submit)$/.test(path);
      const outcome = await this.#handle({
        method: request.method,
        path,
        remote: request.headers.get('cf-connecting-ip'),
        searchParams: url.searchParams,
        header: (name) => request.headers.get(name) ?? undefined,
        readBody: async () => {
          const type = request.headers.get('content-type') ?? '';
          const encoded = form && /^application\/x-www-form-urlencoded\s*(;|$)/i.test(type);
          if (from !== null && !encoded && !/^application\/json\s*(;|$)/i.test(type)) throw new WeaveError('A request with an Origin must send its body as application/json', 'invalid');
          const maxSize = form ? 64 * 1024 : 10 * 1024 * 1024;
          if (Number(request.headers.get('content-length')) > maxSize) throw new WeaveError('Body too large', form ? 'too-large' : 'invalid');
          const chunks = [];
          let size = 0;
          const reader = request.body?.getReader();
          if (reader) {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxSize) {
                  await reader.cancel();
                  throw new WeaveError('Body too large', form ? 'too-large' : 'invalid');
                }
                chunks.push(value);
              }
            } finally { reader.releaseLock(); }
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          const raw = new TextDecoder().decode(bytes);
          if (!raw) return {};
          if (encoded) {
            const params = new URLSearchParams(raw);
            return Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
          }
          try { return JSON.parse(raw); }
          catch { throw new WeaveError('Invalid JSON body', 'invalid'); }
        },
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(outcome.headers ?? {})) for (const v of [value].flat()) headers.append(name, v);
      return new Response(outcome.body, { status: outcome.status, headers });
    } catch (err) {
      const status = statusFor(err);
      return Response.json({ error: err.message, code: err.code ?? 'internal' }, { status });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    if (path === '/vendor/vditor/dist/js/mermaid/mermaid.min.js' && env.ASSETS) {
      return env.ASSETS.fetch(new Request(new URL('/vendor/mermaid.min.js', url), request));
    }
    const m = path.match(/^\/w\/([^/]+)(\/.*|$)/);
    const ws = m && m[1] !== 'undefined'
      ? (m[1] === 'weaver' ? 'weave' : m[1])
      : (env.DEFAULT_WORKSPACE || 'weave');
    const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(ws));
    const forwarded = new Request(request);
    forwarded.headers.set('x-weave-workspace', ws);
    return stub.fetch(forwarded);
  },
};
