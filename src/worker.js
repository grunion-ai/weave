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
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.#boot(request.headers.get('x-weave-workspace') || this.env.DEFAULT_WORKSPACE || 'weave');
    try {
      const outcome = await this.#handle({
        method: request.method,
        path: decodePath(url.pathname),
        searchParams: url.searchParams,
        header: (name) => request.headers.get(name) ?? undefined,
        readBody: async () => {
          const raw = await request.text();
          if (!raw) return {};
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
