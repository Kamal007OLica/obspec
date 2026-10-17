/**
 * Obspec Bridge — a tiny local HTTP server the Figma plugin talks to.
 *
 *   obspec-bridge --vault ~/Notes [--port 27123] [--token secret]
 *
 * Binds to 127.0.0.1 only. CORS allows the Figma plugin iframe (origin "null")
 * and figma.com. All responses are JSON; /events is Server-Sent Events.
 */
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { Vault } from './vault';
import { search } from './search';
import { parseFrontmatter, replaceSection, withFrontmatter } from './markdown';
import type { BridgeError, HealthResponse, PatchNoteRequest, SearchResponse, VaultEvent, WriteNoteRequest, WriteNoteResponse } from '../../src/shared/protocol';

export const VERSION = '1.0.0';

export interface BridgeOptions { vault: string; port: number; host?: string; token?: string; quiet?: boolean }

export async function startBridge(opts: BridgeOptions): Promise<{ server: http.Server; vault: Vault; url: string; close: () => Promise<void> }> {
  const vault = new Vault(opts.vault);
  const t0 = Date.now();
  await vault.index();
  vault.startWatching();
  const host = opts.host ?? '127.0.0.1';
  const log = opts.quiet ? () => {} : (...a: unknown[]) => console.log('[obspec]', ...a);

  const sseClients = new Set<http.ServerResponse>();
  vault.on('event', (ev: VaultEvent) => {
    const payload = `event: vault\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of sseClients) res.write(payload);
    log(ev.type, ev.type === 'hello' ? '' : ev.path);
  });

  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const origin = req.headers.origin;
    // Figma plugin iframes have an opaque origin ("null"); preview harness is localhost.
    res.setHeader('Access-Control-Allow-Origin', origin && isAllowedOrigin(origin) ? origin : 'null');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (opts.token) {
      const auth = req.headers.authorization ?? '';
      const q = url.searchParams.get('token') ?? '';
      if (auth !== `Bearer ${opts.token}` && q !== opts.token) return fail(res, 'FORBIDDEN', 'Invalid token');
    }

    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /health': {
          const body: HealthResponse = { ok: true, version: VERSION, vault: vault.info() };
          return json(res, body);
        }
        case 'GET /search': {
          const q = url.searchParams.get('q') ?? '';
          const limit = clampInt(url.searchParams.get('limit'), 1, 200, 50);
          const t = performance.now();
          const { results, total } = search(vault.all(), q, limit);
          const body: SearchResponse = { query: q, total, results, tookMs: Math.round((performance.now() - t) * 10) / 10 };
          return json(res, body);
        }
        case 'GET /note': {
          const p = url.searchParams.get('path') ?? '';
          const n = vault.get(p);
          if (!n) return fail(res, 'NOT_FOUND', `No note at ${p}`);
          return json(res, vault.toNote(n));
        }
        case 'GET /notes': {
          // Lightweight listing for pickers: path + title + mtime.
          const list = [...vault.all()].map((n) => ({ path: n.path, title: n.title, mtime: n.mtime, tags: n.tags, hash: n.hash })).sort((a, b) => b.mtime - a.mtime);
          return json(res, { notes: list.slice(0, clampInt(url.searchParams.get('limit'), 1, 5000, 200)) });
        }
        case 'PUT /note': {
          const body = (await readJson(req)) as WriteNoteRequest;
          if (!body?.path || typeof body.content !== 'string') return fail(res, 'BAD_REQUEST', 'path and content are required');
          if (!body.path.endsWith('.md')) return fail(res, 'BAD_REQUEST', 'path must end with .md');
          const { note, created } = await vault.write(body.path, body.content, { ifHash: body.ifHash, mkdirs: body.mkdirs });
          const out: WriteNoteResponse = { ok: true, note, created };
          return json(res, out, created ? 201 : 200);
        }
        case 'PATCH /note': {
          const body = (await readJson(req)) as PatchNoteRequest;
          if (!body?.path) return fail(res, 'BAD_REQUEST', 'path is required');
          const existing = vault.get(body.path);
          if (!existing) return fail(res, 'NOT_FOUND', `No note at ${body.path}`);
          let content = existing.content;
          if (body.frontmatter) {
            const { frontmatter } = parseFrontmatter(content);
            const merged: Record<string, unknown> = { ...frontmatter };
            for (const [k, v] of Object.entries(body.frontmatter)) { if (v === null) delete merged[k]; else merged[k] = v; }
            content = withFrontmatter(content, merged);
          }
          if (body.section) {
            const { frontmatter, body: md } = parseFrontmatter(content);
            content = withFrontmatter('', frontmatter) + replaceSection(md, body.section.heading, body.section.markdown);
          }
          const { note } = await vault.write(body.path, content, { ifHash: body.ifHash });
          const out: WriteNoteResponse = { ok: true, note, created: false };
          return json(res, out);
        }
        case 'GET /events': {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(`event: vault\ndata: ${JSON.stringify({ type: 'hello', vault: vault.info() } satisfies VaultEvent)}\n\n`);
          sseClients.add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
          req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
          return;
        }
        default:
          return fail(res, 'NOT_FOUND', `No route ${req.method} ${url.pathname}`);
      }
    } catch (err) {
      const e = err as Error & { code?: BridgeError['code'] };
      const code = e.code && ['NOT_FOUND', 'CONFLICT', 'BAD_REQUEST', 'FORBIDDEN'].includes(e.code) ? e.code : 'INTERNAL';
      if (code === 'INTERNAL') console.error('[obspec] error', err);
      return fail(res, code, e.message);
    }
  };
  const server = http.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  // "localhost" may resolve to ::1 first; serve that loopback too when running on the default host.
  const extra: http.Server[] = [];
  if (!opts.host) {
    const v6 = http.createServer(handler);
    await new Promise<void>((resolve) => {
      v6.once('error', () => resolve()); // no IPv6 loopback — IPv4 alone is fine
      v6.listen(port, '::1', () => { extra.push(v6); resolve(); });
    });
  }
  const url = `http://${host}:${port}`;
  log(`Obspec Bridge v${VERSION}`);
  log(`vault   ${vault.root} (${vault.info().notes} notes, indexed in ${Date.now() - t0} ms)`);
  log(`listen  ${url}${extra.length ? ' and [::1]' : ''}${opts.token ? '  (token required)' : ''}`);
  return {
    server, vault, url,
    close: () => new Promise<void>((r) => { for (const c of sseClients) c.end(); vault.stop(); for (const e of extra) e.close(); server.close(() => r()); }),
  };
}

function isAllowedOrigin(origin: string): boolean {
  return origin === 'null' || /^https:\/\/([a-z0-9-]+\.)?figma\.com$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function fail(res: http.ServerResponse, code: BridgeError['code'], error: string): void {
  const status = { NOT_FOUND: 404, CONFLICT: 409, BAD_REQUEST: 400, FORBIDDEN: 403, INTERNAL: 500 }[code];
  json(res, { ok: false, error, code } satisfies BridgeError, status);
}

function clampInt(v: string | null, min: number, max: number, dflt: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 5_000_000) throw Object.assign(new Error('Body too large'), { code: 'BAD_REQUEST' });
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON body'), { code: 'BAD_REQUEST' }); }
}
