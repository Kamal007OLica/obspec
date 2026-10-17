import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startBridge } from '../bridge/src/server';

let dir: string; let other: string; let url: string; let close: () => Promise<void>;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'obspec-'));
  other = await mkdtemp(path.join(os.tmpdir(), 'obspec-other-'));
  await mkdir(path.join(dir, 'Specs'), { recursive: true });
  await mkdir(path.join(dir, '.obsidian'), { recursive: true });
  await writeFile(path.join(dir, 'Specs/Checkout.md'), '---\ntags: [spec]\n---\n# Checkout\nApple Pay first. See [[Button]].\n![[shot.png]]\n');
  await writeFile(path.join(dir, 'Button.md'), '# Button\nPrimary button.\n');
  await writeFile(path.join(dir, '.obsidian/workspace.md'), 'should be ignored');
  await writeFile(path.join(other, 'Only.md'), '# Only\nIn the other vault.\n');
  await mkdir(path.join(dir, 'Specs/attachments'), { recursive: true });
  // 1×1 PNG
  await writeFile(path.join(dir, 'Specs/attachments/shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(path.join(dir, 'secret.txt'), 'not an image');
  // A fake Obsidian registry so /vaults is deterministic.
  const reg = path.join(other, 'obsidian.json');
  await writeFile(reg, JSON.stringify({ vaults: { a: { path: dir, ts: 2, open: true }, b: { path: other, ts: 1 }, gone: { path: path.join(other, 'missing'), ts: 0 } } }));
  process.env.OBSPEC_OBSIDIAN_CONFIG = reg;
  const b = await startBridge({ vault: dir, port: 0, quiet: true });
  url = b.url; close = b.close;
});
after(async () => { await close(); await rm(dir, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); });

const get = (p: string) => fetch(url + p).then((r) => r.json() as Promise<any>);
const send = (method: string, p: string, body?: unknown) => fetch(url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('health reports the vault and ignores .obsidian', async () => {
  const h = await get('/health');
  assert.equal(h.ok, true);
  assert.equal(h.vault.notes, 2);
  assert.equal(typeof h.canPick, 'boolean');
});

test('search finds notes with snippets', async () => {
  const r = await get('/search?q=apple');
  assert.equal(r.total, 1);
  assert.equal(r.results[0].path, 'Specs/Checkout.md');
  assert.ok(r.results[0].snippets[0].ranges.length > 0);
  assert.equal(r.results[0].thumbnail, 'Specs/attachments/shot.png');
  const recent = await get('/notes?limit=5');
  assert.equal(recent.notes.find((n: any) => n.path === 'Specs/Checkout.md').thumbnail, 'Specs/attachments/shot.png');
});

test('note resolves outlinks and backlinks through the indexes', async () => {
  const n = await get('/note?path=Button.md');
  assert.deepEqual(n.backlinks, [{ path: 'Specs/Checkout.md', title: 'Checkout' }]);
  const c = await get('/note?path=Specs/Checkout.md');
  assert.deepEqual(c.outlinks, [{ path: 'Button.md', title: 'Button' }]);
});

test('hashes endpoint returns many hashes at once, null for missing', async () => {
  const r = await get('/hashes?path=Button.md&path=Nope.md');
  assert.equal(typeof r.hashes['Button.md'], 'string');
  assert.equal(r.hashes['Nope.md'], null);
});

test('PUT creates, PATCH merges frontmatter + section, conflicts on stale hash; backlinks follow', async () => {
  const put = await send('PUT', '/note', { path: 'Figma/New.md', content: '# New\nLinks to [[Button]].\n' });
  assert.equal(put.status, 201);
  const created = await put.json() as any;
  assert.equal(created.created, true);
  const b = await get('/note?path=Button.md');
  assert.deepEqual(b.backlinks.map((l: any) => l.path).sort(), ['Figma/New.md', 'Specs/Checkout.md']);
  const patch = await (await send('PATCH', '/note', { path: 'Figma/New.md', frontmatter: { figma_node: '1:2' }, section: { heading: 'Design', markdown: '- **Size:** 1 × 2' }, ifHash: created.note.hash })).json() as any;
  assert.equal(patch.note.frontmatter.figma_node, '1:2');
  assert.match(patch.note.body, /## Design\n\n- \*\*Size:\*\* 1 × 2/);
  const onDisk = await readFile(path.join(dir, 'Figma/New.md'), 'utf8');
  assert.match(onDisk, /^---\nfigma_node: "1:2"\n---\n# New/);
  const stale = await send('PATCH', '/note', { path: 'Figma/New.md', frontmatter: { x: 1 }, ifHash: created.note.hash });
  assert.equal(stale.status, 409);
});

test('file endpoint serves images by exact path or bare name, and nothing else', async () => {
  const byName = await fetch(url + '/file?path=shot.png');
  assert.equal(byName.status, 200);
  assert.equal(byName.headers.get('content-type'), 'image/png');
  assert.equal(byName.headers.get('x-vault-path'), 'Specs/attachments/shot.png');
  const exact = await fetch(url + '/file?path=Specs/attachments/shot.png');
  assert.equal(exact.status, 200);
  assert.equal((await fetch(url + '/file?path=secret.txt')).status, 404);  // not indexed: not an image
  assert.equal((await fetch(url + '/file?path=../outside.png')).status, 404);
  assert.equal((await fetch(url + '/file?path=nope.png')).status, 404);
});

test('rejects paths that escape the vault or touch protected folders', async () => {
  assert.equal((await send('PUT', '/note', { path: '../escape.md', content: 'x' })).status, 403);
  assert.equal((await send('PUT', '/note', { path: '.obsidian/app.md', content: 'x' })).status, 403);
});

test('CORS allows the null origin of a Figma plugin iframe', async () => {
  const r = await fetch(url + '/health', { headers: { Origin: 'null' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'null');
  const evil = await fetch(url + '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), 'null');
});

test('vaults lists Obsidian registry entries (open first) and marks missing ones', async () => {
  const r = await get('/vaults');
  assert.equal(r.vaults[0].path, dir);
  assert.equal(r.vaults[0].open, true);
  assert.equal(r.vaults.find((v: any) => v.path.endsWith('missing')).exists, false);
});

test('switching vaults re-indexes and reports NO_VAULT when cleared', async () => {
  const sw = await (await send('POST', '/vault', { path: other })).json() as any;
  assert.equal(sw.vault.notes, 1);
  assert.equal((await get('/search?q=only')).total, 1);
  const bad = await send('POST', '/vault', { path: path.join(other, 'does-not-exist') });
  assert.equal(bad.status, 400);
  assert.equal((await send('DELETE', '/vault')).status, 200);
  const r = await fetch(url + '/search?q=x');
  assert.equal(r.status, 412);
  assert.equal(((await r.json()) as any).code, 'NO_VAULT');
  await send('POST', '/vault', { path: dir });
  assert.equal((await get('/health')).vault.notes, 3); // the two seeded notes + Figma/New.md from the PUT test
});
