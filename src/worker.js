// Cloudflare Worker entry (Feature #84): the same dispatcher node serves,
// wrapped for workerd. One workspace = one SQLite-backed Durable Object;
// the outer Worker routes /w/<name>/* to that workspace's DO and everything
// else to the default workspace's. Static assets are served by the Assets
// binding before this code runs; the one non-file asset path (Vditor's
// mermaid probe) is aliased here, same as the node adapter does.
//
// Deliberate v1 limits, lifted in later increments:
// - POST /api/workspaces is refused (workspace enumeration needs the registry
//   DO — a static DO-per-name namespace has nothing to enumerate)
// - /api/search?all= degrades to the current workspace (same reason)
// - file blobs persist in-DO (store.path is null → engine keeps them in
//   state.fileBlobs); R2 offload is the next increment
import { Weave, WeaveError } from './engine.js';
import { CFStore } from './store-cf.js';
import { createRequestHandler, statusFor } from './routes.js';

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
    const weave = new Weave({ store, actor: 'web' });
    if (!weave.state.meta.name || weave.state.meta.name === 'Weave Workspace') {
      weave.state.meta.name = name;
      weave.save();
    }
    const self = weave.state.meta.name;
    // A single-member hub: each DO only ever sees its own traffic — the outer
    // Worker already routed /w/<name>/* here. The registry DO replaces this.
    const hub = {
      get defaultName() { return self; },
      get(n) { return (n === self || (n === 'weave' && self === 'weaver')) ? weave : null; },
      rename() { throw new WeaveError('Workspace rename is not yet available on the hosted instance', 'invalid'); },
      create() { throw new WeaveError('Workspace creation is not yet available on the hosted instance', 'invalid'); },
      list() {
        return [{
          name: self, default: true,
          spaces: weave.listSpaces().length,
          tables: weave.listTables().length,
          entities: Object.keys(weave.state.entities).length,
          logo: !!weave.state.meta.logo,
        }];
      },
      entries() { return [[self, weave]]; },
    };
    this.#handle = createRequestHandler(hub, {
      version: this.env.WEAVE_VERSION || 'dev',
      uptime: () => (Date.now() - this.#bootedAt) / 1000,
      serveStatic: null, // the Assets binding served files before we ran
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.#boot(request.headers.get('x-weave-workspace') || this.env.DEFAULT_WORKSPACE || 'weave');
    try {
      const outcome = await this.#handle({
        method: request.method,
        path: decodeURIComponent(url.pathname),
        searchParams: url.searchParams,
        header: (name) => request.headers.get(name) ?? undefined,
        readBody: async () => {
          const raw = await request.text();
          if (!raw) return {};
          try { return JSON.parse(raw); }
          catch { throw new WeaveError('Invalid JSON body', 'invalid'); }
        },
      });
      return new Response(outcome.body, { status: outcome.status, headers: outcome.headers });
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
    // Vditor lazy-loads mermaid from inside its own dist tree; alias onto the
    // vendored build instead of shipping a second copy (same as node's adapter).
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
