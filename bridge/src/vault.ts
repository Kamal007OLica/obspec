/**
 * Vault indexer. Reads every .md in the vault into memory, keeps the index
 * fresh with fs.watch, and maintains the secondary indexes that make large
 * vaults (thousands of notes) feel instant: basename lookup for wikilinks,
 * inbound-link sets for backlinks, and a recency-sorted listing.
 */
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fnv1a, folderFromPath, titleFromPath, type Note, type NoteLink, type NoteListItem, type VaultEvent, type VaultInfo } from '../../src/shared/protocol';
import { countWords, extractTags, extractWikilinks, parseFrontmatter } from './markdown';

export interface IndexedNote {
  path: string;
  title: string;
  folder: string;
  frontmatter: Record<string, unknown>;
  content: string;
  body: string;
  bodyLower: string;
  titleLower: string;
  pathLower: string;
  /** Lower-case file name without extension — the key wikilinks resolve by. */
  baseLower: string;
  tags: string[];
  outlinks: string[]; // raw wikilink targets
  mtime: number;
  hash: string;
  words: number;
}

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
export const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif' };
const isImage = (rel: string) => IMAGE_EXT.has(path.extname(rel).toLowerCase());

export class Vault extends EventEmitter {
  readonly root: string;
  readonly name: string;
  private notes = new Map<string, IndexedNote>();
  private byBase = new Map<string, Set<IndexedNote>>();
  /** wikilink target key (base lower) → paths of notes that link to it */
  private inbound = new Map<string, Set<string>>();
  private recent: NoteListItem[] | null = null;
  /** Attachments (images): lower-case rel path → exact rel path, and file name → rel paths. */
  private files = new Map<string, string>();
  private filesByBase = new Map<string, Set<string>>();
  private watcher?: FSWatcher;
  private poller?: NodeJS.Timeout;
  private indexedAt = 0;
  private pending = new Map<string, NodeJS.Timeout>();
  /** Writes we made ourselves — suppress the echo from the watcher. */
  private selfWrites = new Map<string, string>();

  constructor(root: string) {
    super();
    this.root = path.resolve(root);
    this.name = path.basename(this.root);
  }

  info(): VaultInfo {
    return { name: this.name, path: this.root, notes: this.notes.size, indexedAt: this.indexedAt };
  }

  all(): IterableIterator<IndexedNote> { return this.notes.values(); }
  get size(): number { return this.notes.size; }

  async index(): Promise<void> {
    this.notes.clear(); this.byBase.clear(); this.inbound.clear(); this.recent = null; this.files.clear(); this.filesByBase.clear();
    const mds: string[] = [];
    for await (const rel of walk(this.root)) { if (rel.toLowerCase().endsWith('.md')) mds.push(rel); else this.addFile(rel); }
    // Read in parallel batches: thousands of small files, IO-bound.
    const BATCH = 64;
    for (let i = 0; i < mds.length; i += BATCH) await Promise.all(mds.slice(i, i + BATCH).map((rel) => this.load(rel, false)));
    this.indexedAt = Date.now();
  }

  startWatching(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename).split(path.sep).join('/');
        if (rel.split('/').some((p) => IGNORED_DIRS.has(p))) return;
        if (isImage(rel)) { void fs.access(path.join(this.root, rel)).then(() => this.addFile(rel), () => this.removeFile(rel)); return; }
        if (!rel.toLowerCase().endsWith('.md')) return;
        clearTimeout(this.pending.get(rel));
        this.pending.set(rel, setTimeout(() => { this.pending.delete(rel); void this.refresh(rel); }, 80));
      });
      this.watcher.on('error', (err) => console.warn('[obspec] watcher error:', err.message));
    } catch (err) {
      console.warn('[obspec] fs.watch unavailable, falling back to 2s polling:', (err as Error).message);
      this.poller = setInterval(() => void this.poll(), 2000);
      this.poller.unref();
    }
  }

  stop(): void { this.watcher?.close(); if (this.poller) clearInterval(this.poller); for (const t of this.pending.values()) clearTimeout(t); }

  get(rel: string): IndexedNote | undefined { return this.notes.get(normalize(rel)); }

  /** Resolve an image embed like Obsidian: exact path, else by file name anywhere in the vault. */
  resolveFile(target: string): { rel: string; abs: string } | undefined {
    let t = normalize(decodeURIComponentSafe(target).replace(/^\.\//, '').trim());
    if (!t) return undefined;
    const exact = this.files.get(t.toLowerCase());
    if (exact) return { rel: exact, abs: path.join(this.root, exact) };
    const set = this.filesByBase.get((t.split('/').pop() ?? t).toLowerCase());
    if (!set?.size) return undefined;
    let best: string | undefined;
    for (const rel of set) if (!best || rel.split('/').length < best.split('/').length) best = rel;
    return best ? { rel: best, abs: path.join(this.root, best) } : undefined;
  }

  /** Current content hash, or null when the note doesn't exist. */
  hashOf(rel: string): string | null { return this.notes.get(normalize(rel))?.hash ?? null; }

  /** Recency-sorted listing, cached until the next change. */
  listRecent(limit: number): NoteListItem[] {
    if (!this.recent) {
      this.recent = [...this.notes.values()].sort((a, b) => b.mtime - a.mtime)
        .map((n) => ({ path: n.path, title: n.title, mtime: n.mtime, tags: n.tags, hash: n.hash }));
    }
    return this.recent.slice(0, limit);
  }

  /** Resolve a wikilink target the way Obsidian does: exact path first, then by file name anywhere. */
  resolveLink(target: string): IndexedNote | undefined {
    const t = normalize(target.endsWith('.md') ? target : `${target}.md`);
    const exact = this.notes.get(t);
    if (exact) return exact;
    const set = this.byBase.get(baseKey(t));
    if (!set || set.size === 0) return undefined;
    if (set.size === 1) return set.values().next().value;
    // Ambiguous short link: prefer the shallowest path (what Obsidian does by default).
    let best: IndexedNote | undefined;
    for (const n of set) if (!best || n.path.split('/').length < best.path.split('/').length) best = n;
    return best;
  }

  toNote(n: IndexedNote): Note {
    const outlinks: NoteLink[] = [];
    for (const target of n.outlinks) {
      const r = this.resolveLink(target);
      outlinks.push(r ? { path: r.path, title: r.title } : { path: target, title: target });
    }
    const backlinks: NoteLink[] = [];
    for (const src of this.inbound.get(n.baseLower) ?? []) {
      if (src === n.path) continue;
      const s = this.notes.get(src);
      if (s && s.outlinks.some((t) => this.resolveLink(t) === n)) backlinks.push({ path: s.path, title: s.title });
    }
    backlinks.sort((a, b) => a.title.localeCompare(b.title));
    return {
      path: n.path, title: n.title, folder: n.folder, frontmatter: n.frontmatter, content: n.content, body: n.body,
      tags: n.tags, outlinks, backlinks, mtime: n.mtime, hash: n.hash, words: n.words,
    };
  }

  async write(rel: string, content: string, opts: { ifHash?: string; mkdirs?: boolean } = {}): Promise<{ note: Note; created: boolean }> {
    rel = normalize(rel);
    assertInside(this.root, rel);
    const existing = this.notes.get(rel);
    if (opts.ifHash && existing && existing.hash !== opts.ifHash) {
      throw Object.assign(new Error('Note changed since you last read it'), { code: 'CONFLICT' });
    }
    const abs = path.join(this.root, rel);
    if (opts.mkdirs !== false) await fs.mkdir(path.dirname(abs), { recursive: true });
    this.selfWrites.set(rel, fnv1a(content));
    await fs.writeFile(abs, content, 'utf8');
    const note = await this.load(rel, true, existing ? 'changed' : 'created');
    return { note: this.toNote(note!), created: !existing };
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async refresh(rel: string): Promise<void> {
    const abs = path.join(this.root, rel);
    try {
      await fs.access(abs);
    } catch {
      if (this.remove(rel)) this.emit('event', { type: 'deleted', path: rel } satisfies VaultEvent);
      return;
    }
    const before = this.notes.get(rel);
    const after = await this.load(rel, false);
    if (!after) return;
    const self = this.selfWrites.get(rel);
    if (self && self === after.hash) { this.selfWrites.delete(rel); return; }
    if (!before) this.emit('event', { type: 'created', path: rel, mtime: after.mtime, hash: after.hash } satisfies VaultEvent);
    else if (before.hash !== after.hash) this.emit('event', { type: 'changed', path: rel, mtime: after.mtime, hash: after.hash } satisfies VaultEvent);
  }

  private async poll(): Promise<void> {
    const seen = new Set<string>();
    for await (const rel of walk(this.root)) { seen.add(rel); if (isImage(rel)) this.addFile(rel); else await this.refresh(rel); }
    for (const rel of [...this.notes.keys()]) if (!seen.has(rel)) await this.refresh(rel);
  }

  private async load(rel: string, emit: boolean, eventType: 'changed' | 'created' = 'changed'): Promise<IndexedNote | undefined> {
    const abs = path.join(this.root, rel);
    let content: string; let stat;
    try {
      [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
    } catch { return undefined; }
    const { frontmatter, body } = parseFrontmatter(content);
    const title = (typeof frontmatter.title === 'string' && frontmatter.title) || titleFromPath(rel);
    const note: IndexedNote = {
      path: rel, title, folder: folderFromPath(rel), frontmatter, content, body,
      bodyLower: body.toLowerCase(), titleLower: title.toLowerCase(), pathLower: rel.toLowerCase(), baseLower: baseKey(rel),
      tags: extractTags(body, frontmatter), outlinks: extractWikilinks(body),
      mtime: Math.round(stat.mtimeMs), hash: fnv1a(content), words: countWords(body),
    };
    this.remove(rel, false);
    this.notes.set(rel, note);
    addTo(this.byBase, note.baseLower, note);
    for (const t of note.outlinks) addTo(this.inbound, baseKey(t.endsWith('.md') ? t : `${t}.md`), rel);
    this.recent = null;
    if (emit) this.emit('event', { type: eventType, path: rel, mtime: note.mtime, hash: note.hash } satisfies VaultEvent);
    return note;
  }

  private addFile(rel: string): void {
    this.files.set(rel.toLowerCase(), rel);
    addTo(this.filesByBase, (rel.split('/').pop() ?? rel).toLowerCase(), rel);
  }

  private removeFile(rel: string): void {
    this.files.delete(rel.toLowerCase());
    this.filesByBase.get((rel.split('/').pop() ?? rel).toLowerCase())?.delete(rel);
  }

  private remove(rel: string, invalidate = true): boolean {
    const n = this.notes.get(rel);
    if (!n) return false;
    this.notes.delete(rel);
    this.byBase.get(n.baseLower)?.delete(n);
    for (const t of n.outlinks) this.inbound.get(baseKey(t.endsWith('.md') ? t : `${t}.md`))?.delete(rel);
    if (invalidate) this.recent = null;
    return true;
  }
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(value);
}

/** "Design/System/Button.md" → "button" */
function baseKey(rel: string): string {
  const base = rel.split('/').pop() ?? rel;
  return base.replace(/\.md$/i, '').toLowerCase();
}

async function* walk(root: string, rel = ''): AsyncGenerator<string> {
  let entries;
  try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    if (IGNORED_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(root, r);
    else if (e.isFile() && (e.name.toLowerCase().endsWith('.md') || isImage(e.name))) yield r;
  }
}

function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

export function normalize(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function assertInside(root: string, rel: string): void {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Path escapes the vault'), { code: 'FORBIDDEN' });
  }
  if (rel.split('/').some((p) => IGNORED_DIRS.has(p))) {
    throw Object.assign(new Error('Path is inside a protected folder'), { code: 'FORBIDDEN' });
  }
}
