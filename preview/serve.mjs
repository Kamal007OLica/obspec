// Obspec local preview: real bridge + real plugin UI + mock Figma sandbox.
//   npm run preview   →  http://127.0.0.1:5177
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../bridge/dist/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PREVIEW_PORT ?? 5177);
const BRIDGE_PORT = Number(process.env.OBSPEC_PORT ?? 27123);
const SRC_VAULT = path.join(root, 'examples/vault');
const WORK_VAULT = path.join(root, 'preview/.work/Obspec Demo Vault');

async function resetVault() {
  await fs.rm(WORK_VAULT, { recursive: true, force: true });
  await fs.mkdir(path.dirname(WORK_VAULT), { recursive: true });
  await fs.cp(SRC_VAULT, WORK_VAULT, { recursive: true });
}
await resetVault();

const bridge = await startBridge({ vault: WORK_VAULT, port: BRIDGE_PORT, quiet: false });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png' };
const ROUTES = { '/': 'preview/index.html', '/ui.html': 'dist/ui.html', '/harness.js': 'preview/dist/harness.js', '/harness.css': 'preview/harness.css' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    // Simulates a human editing a note in Obsidian: write straight to disk, bypassing the bridge.
    if (req.method === 'POST' && url.pathname === '/__obsidian/edit') {
      const body = JSON.parse(await text(req));
      const abs = path.join(WORK_VAULT, body.path);
      if (!abs.startsWith(WORK_VAULT)) { res.writeHead(400); return res.end(); }
      let content = body.content;
      if (body.append) content = (await fs.readFile(abs, 'utf8')).replace(/\s*$/, '\n') + body.append;
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'POST' && url.pathname === '/__obsidian/reset') {
      await resetVault(); await bridge.vault.index();
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'GET' && url.pathname === '/__obsidian/raw') {
      const abs = path.join(WORK_VAULT, url.searchParams.get('path') ?? '');
      if (!abs.startsWith(WORK_VAULT)) { res.writeHead(400); return res.end(); }
      const raw = await fs.readFile(abs, 'utf8').catch(() => null);
      res.writeHead(raw === null ? 404 : 200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(raw ?? '');
    }
    const rel = ROUTES[url.pathname];
    if (!rel) { res.writeHead(404); return res.end('not found'); }
    const data = await fs.readFile(path.join(root, rel));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (err) {
    res.writeHead(500); res.end(String(err));
  }
});

function text(req) { return new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); }); }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Obspec preview  →  http://127.0.0.1:${PORT}`);
  console.log(`  bridge          →  ${bridge.url}  (vault copy at preview/.work)\n`);
});
