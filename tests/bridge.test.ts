import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startBridge } from '../bridge/src/server';

let dir: string; let url: string; let close: () => Promise<void>;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'obspec-'));
  await mkdir(path.join(dir, 'Specs'), { recursive: true });
  await mkdir(path.join(dir, '.obsidian'), { recursive: true });
  await writeFile(path.join(dir, 'Specs/Checkout.md'), '---\ntags: [spec]\n---\n# Checkout\nApple Pay first. See [[Button]].\n');
  await writeFile(path.join(dir, 'Button.md'), '# Button\nPrimary button.\n');
  await writeFile(path.join(dir, '.obsidian/workspace.md'), 'should be ignored');
  const b = await startBridge({ vault: dir, port: 0, quiet: true });
  url = b.url; close = b.close;
});
after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });

const get = (p: string) => fetch(url + p).then((r) => r.json() as Promise<any>);

test('health reports the vault and ignores .obsidian', async () => {
  const h = await get('/health');
  assert.equal(h.ok, true);
  assert.equal(h.vault.notes, 2);
});

test('search finds notes with snippets', async () => {
  const r = await get('/search?q=apple');
  assert.equal(r.total, 1);
  assert.equal(r.results[0].path, 'Specs/Checkout.md');
  assert.ok(r.results[0].snippets[0].ranges.length > 0);
});

test('note resolves outlinks and backlinks', async () => {
  const n = await get('/note?path=Button.md');
  assert.deepEqual(n.backlinks, [{ path: 'Specs/Checkout.md', title: 'Checkout' }]);
  const c = await get('/note?path=Specs/Checkout.md');
  assert.deepEqual(c.outlinks, [{ path: 'Button.md', title: 'Button' }]);
});

test('PUT creates, PATCH merges frontmatter + section, conflicts on stale hash', async () => {
  const put = await fetch(url + '/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Figma/New.md', content: '# New\n' }) });
  assert.equal(put.status, 201);
  const created = await put.json() as any;
  assert.equal(created.created, true);
  const patch = await fetch(url + '/note', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Figma/New.md', frontmatter: { figma_node: '1:2' }, section: { heading: 'Design', markdown: '| a | b |' }, ifHash: created.note.hash }) }).then((r) => r.json() as Promise<any>);
  assert.equal(patch.note.frontmatter.figma_node, '1:2');
  assert.match(patch.note.body, /## Design\n\n\| a \| b \|/);
  const onDisk = await readFile(path.join(dir, 'Figma/New.md'), 'utf8');
  assert.match(onDisk, /^---\nfigma_node: "1:2"\n---\n# New/);
  const stale = await fetch(url + '/note', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Figma/New.md', frontmatter: { x: 1 }, ifHash: created.note.hash }) });
  assert.equal(stale.status, 409);
});

test('rejects paths that escape the vault or touch protected folders', async () => {
  const r1 = await fetch(url + '/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '../escape.md', content: 'x' }) });
  assert.equal(r1.status, 403);
  const r2 = await fetch(url + '/note', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '.obsidian/app.md', content: 'x' }) });
  assert.equal(r2.status, 403);
});

test('CORS allows the null origin of a Figma plugin iframe', async () => {
  const r = await fetch(url + '/health', { headers: { Origin: 'null' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'null');
  const evil = await fetch(url + '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), 'null');
});
