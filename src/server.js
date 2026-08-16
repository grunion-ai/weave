import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WeaveError } from './engine.js';
import { renderDocumentPage } from './markdown.js';
import { markdownToPdf } from './pdf.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function statusFor(err) {
  if (!(err instanceof WeaveError)) return 500;
  return { 'not-found': 404, conflict: 409, invalid: 400, ambiguous: 400 }[err.code] ?? 400;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new WeaveError('Body too large', 'invalid');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new WeaveError('Invalid JSON body', 'invalid');
  }
}

export function createServer(weave) {
  // Resolves [[Database#12]] mentions in rendered documents.
  const resolveMention = (dbName, pid) => {
    let db;
    try {
      db = weave.findDatabase(dbName);
    } catch {
      return null;
    }
    if (!db) return null;
    const entity = weave.listEntities(db.id).find((e) => String(e.publicId) === String(pid));
    if (!entity) return null;
    return { href: `/e/${entity.id}/doc.html`, label: `${db.name}#${pid} — ${weave.entityName(entity)}` };
  };

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const send = (status, data, headers = {}) => {
      const isBuf = Buffer.isBuffer(data);
      const isStr = typeof data === 'string';
      const body = isBuf ? data : isStr ? data : JSON.stringify(data, null, 1);
      res.writeHead(status, {
        'Content-Type': headers['Content-Type'] ?? (isBuf || isStr ? 'text/plain; charset=utf-8' : 'application/json'),
        'Access-Control-Allow-Origin': '*',
        ...headers,
      });
      res.end(body);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    try {
      // ---------- native document views ----------
      let m;
      if ((m = path.match(/^\/e\/([^/]+)\/doc\.(md|html|pdf)$/))) {
        const entity = weave.readEntity(m[1]);
        const subtitle = `${entity.db} #${entity.publicId} • ${entity.name} • updated ${entity.updatedAt.slice(0, 10)}`;
        if (m[2] === 'md') {
          return send(200, entity.doc, { 'Content-Type': 'text/markdown; charset=utf-8' });
        }
        if (m[2] === 'html') {
          const page = renderDocumentPage({ title: entity.name || `#${entity.publicId}`, subtitle, markdown: entity.doc, resolveMention });
          return send(200, page, { 'Content-Type': 'text/html; charset=utf-8' });
        }
        const pdf = markdownToPdf(entity.doc, { title: entity.name || `#${entity.publicId}`, subtitle });
        return send(200, pdf, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${(entity.name || 'document').replace(/[^\w.-]+/g, '_')}.pdf"`,
        });
      }
      if ((m = path.match(/^\/e\/([^/]+)$/))) {
        const entity = weave.readEntity(m[1]); // 404s if missing
        res.writeHead(302, { Location: `/#/entity/${entity.id}` });
        return res.end();
      }

      // ---------- API ----------
      if (path.startsWith('/api/')) {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const route = `${req.method} ${path}`;

        if (route === 'GET /api/health') return send(200, { ok: true, name: 'weave', version: '0.1.0' });
        if (route === 'GET /api/schema') return send(200, weave.describeSchema());

        if (route === 'GET /api/spaces') return send(200, weave.listSpaces());
        if (route === 'POST /api/spaces') return send(201, weave.createSpace(body));
        if ((m = path.match(/^\/api\/spaces\/([^/]+)$/))) {
          if (req.method === 'GET') return send(200, weave.getSpace(m[1]));
          if (req.method === 'PATCH') return send(200, weave.updateSpace(m[1], body));
          if (req.method === 'DELETE') { weave.deleteSpace(m[1]); return send(200, { ok: true }); }
        }

        if (route === 'GET /api/databases') {
          const space = url.searchParams.get('space');
          const dbs = weave.listDatabases(space ? weave.getSpace(space).id : null);
          return send(200, dbs.map((db) => ({ id: db.id, name: db.name, qualified: weave.qualifiedName(db), spaceId: db.spaceId })));
        }
        if (route === 'POST /api/databases') return send(201, weave.createDatabase(body));
        if ((m = path.match(/^\/api\/databases\/([^/]+)$/))) {
          if (req.method === 'GET') {
            const db = weave.getDatabase(m[1]);
            const schema = weave.describeSchema().flatMap((s) => s.databases).find((d) => d.id === db.id);
            return send(200, schema);
          }
          if (req.method === 'PATCH') return send(200, weave.updateDatabase(m[1], body));
          if (req.method === 'DELETE') { weave.deleteDatabase(m[1]); return send(200, { ok: true }); }
        }

        if ((m = path.match(/^\/api\/databases\/([^/]+)\/fields$/)) && req.method === 'POST') {
          return send(201, weave.addField(m[1], body));
        }
        if ((m = path.match(/^\/api\/databases\/([^/]+)\/fields\/([^/]+)$/))) {
          if (req.method === 'PATCH') return send(200, weave.updateField(m[1], m[2], body));
          if (req.method === 'DELETE') { weave.deleteField(m[1], m[2]); return send(200, { ok: true }); }
        }
        if ((m = path.match(/^\/api\/databases\/([^/]+)\/relations$/)) && req.method === 'POST') {
          return send(201, weave.addRelation(m[1], body));
        }

        if ((m = path.match(/^\/api\/databases\/([^/]+)\/entities$/))) {
          if (req.method === 'POST') {
            const e = weave.createEntity(m[1], body);
            return send(201, weave.readEntity(e.id));
          }
          if (req.method === 'GET') {
            const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null;
            const offset = Number(url.searchParams.get('offset') ?? 0);
            return send(200, weave.query(m[1], { limit, offset }));
          }
        }
        if ((m = path.match(/^\/api\/databases\/([^/]+)\/query$/)) && req.method === 'POST') {
          return send(200, weave.query(m[1], body));
        }
        if ((m = path.match(/^\/api\/databases\/([^/]+)\/export\.csv$/)) && req.method === 'GET') {
          return send(200, weave.exportCSV(m[1]), { 'Content-Type': 'text/csv; charset=utf-8' });
        }
        if ((m = path.match(/^\/api\/databases\/([^/]+)\/import\.csv$/)) && req.method === 'POST') {
          return send(200, weave.importCSV(m[1], body.csv ?? ''));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)$/))) {
          if (req.method === 'GET') return send(200, weave.readEntity(m[1]));
          if (req.method === 'PATCH') {
            weave.updateEntity(m[1], body.values ?? body);
            return send(200, weave.readEntity(m[1]));
          }
          if (req.method === 'DELETE') { weave.deleteEntity(m[1]); return send(200, { ok: true }); }
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/link$/)) && req.method === 'POST') {
          weave.link(m[1], body.field, body.targets ?? body.items);
          return send(200, weave.readEntity(m[1]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/unlink$/)) && req.method === 'POST') {
          weave.unlink(m[1], body.field, body.targets ?? body.items);
          return send(200, weave.readEntity(m[1]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/state$/)) && req.method === 'POST') {
          weave.setState(m[1], body.field, body.state);
          return send(200, weave.readEntity(m[1]));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc$/))) {
          if (req.method === 'GET') return send(200, { doc: weave.getDoc(m[1]) });
          if (req.method === 'PUT') { weave.setDoc(m[1], body.doc ?? body.markdown ?? ''); return send(200, { ok: true }); }
          if (req.method === 'POST') { weave.appendDoc(m[1], body.doc ?? body.markdown ?? ''); return send(200, { ok: true }); }
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files$/)) && req.method === 'POST') {
          return send(201, weave.attachFile(m[1], { name: body.name, mime: body.mime, bytes: body.contentBase64 }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files\/([^/]+)$/)) && req.method === 'DELETE') {
          weave.deleteFile(m[1], m[2]);
          return send(200, { ok: true });
        }
        if ((m = path.match(/^\/api\/files\/([^/]+)$/)) && req.method === 'GET') {
          const { meta, bytes } = weave.readFile(m[1]);
          return send(200, bytes, {
            'Content-Type': meta.mime,
            'Content-Disposition': `inline; filename="${meta.name.replace(/[^\w.-]+/g, '_')}"`,
          });
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments$/)) && req.method === 'POST') {
          return send(201, weave.addComment(m[1], body));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments\/([^/]+)$/)) && req.method === 'DELETE') {
          weave.deleteComment(m[1], m[2]);
          return send(200, { ok: true });
        }

        if (route === 'GET /api/automations') {
          return send(200, weave.listAutomations(url.searchParams.get('db')));
        }
        if (route === 'POST /api/automations') {
          return send(201, weave.createAutomation(body.db, body));
        }
        if ((m = path.match(/^\/api\/automations\/([^/]+)$/))) {
          if (req.method === 'PATCH') return send(200, weave.updateAutomation(m[1], body));
          if (req.method === 'DELETE') { weave.deleteAutomation(m[1]); return send(200, { ok: true }); }
        }

        if (route === 'GET /api/search') {
          return send(200, weave.search(url.searchParams.get('q') ?? '', { limit: Number(url.searchParams.get('limit') ?? 25) }));
        }
        if (route === 'GET /api/export') return send(200, weave.exportJSON());
        if (route === 'POST /api/import') { weave.importJSON(body); return send(200, { ok: true }); }

        return send(404, { error: `No route: ${route}` });
      }

      // ---------- static UI ----------
      const file = path === '/' ? '/index.html' : path;
      const full = join(PUBLIC_DIR, file.replace(/\.\./g, ''));
      if (existsSync(full) && !full.endsWith('/')) {
        return send(200, readFileSync(full), { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
      }
      return send(404, 'Not found');
    } catch (err) {
      const status = statusFor(err);
      if (status === 500) console.error(err);
      return send(status, { error: err.message, code: err.code ?? 'internal' });
    }
  });

  return server;
}

export function startServer(weave, { port = 4400, host = '127.0.0.1' } = {}) {
  const server = createServer(weave);
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
