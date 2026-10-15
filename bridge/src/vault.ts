/**
 * Vault indexer. Reads every .md in the vault into memory, keeps the index
 * fresh with fs.watch (recursive on macOS/Windows, polled fallback elsewhere),
 * and emits change events to subscribers.
 */
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fnv1a, folderFromPath, titleFromPath, type Note, type NoteLink, type VaultEvent, type VaultInfo } from '../../src/shared/protocol';
import { countWords, extractTags, extractWikilinks, firstHeading, parseFrontmatter } from './markdown';

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
  tags: string[];
  outlinks: string[]; // raw wikilink targets
  mtime: number;
  hash: string;
  words: number;
}

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

export class Vault extends EventEmitter {
  readonly root: string;
  readonly name: string;
  private notes = new Map<string, IndexedNote>();
  private watcher?: FSWatcher;
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

  async index(): Promise<void> {
    this.notes.clear();
    for await (const rel of walk(this.root)) await this.load(rel, false);
    this.indexedAt = Date.now();
  }

  startWatching(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename).split(path.sep).join('/');
        if (!rel.endsWith('.md') || rel.split('/').some((p) => IGNORED_DIRS.has(p))) return;
        // Debounce bursts (editors write several times per save).
        clearTimeout(this.pending.get(rel));
        this.pending.set(rel, setTimeout(() => { this.pending.delete(rel); void this.refresh(rel); }, 80));
      });
    } catch (err) {
      console.warn('[obspec] fs.watch unavailable, falling back to 2s polling:', (err as Error).message);
      setInterval(() => void this.poll(), 2000).unref();
    }
  }

  stop(): void { this.watcher?.close(); }

  get(rel: string): IndexedNote | undefined { return this.notes.get(normalize(rel)); }

  /** Resolve a wikilink target the way Obsidian does: exact path, then by basename anywhere. */
  resolveLink(target: string): IndexedNote | undefined {
    const t = normalize(target.endsWith('.md') ? target : `${target}.md`);
    const exact = this.notes.get(t);
    if (exact) return exact;
    const base = t.split('/').pop()!.toLowerCase();
    for (const n of this.notes.values()) if (n.pathLower.split('/').pop() === base) return n;
    return undefined;
  }

  toNote(n: IndexedNote): Note {
    const outlinks: NoteLink[] = [];
    for (const target of n.outlinks) {
      const r = this.resolveLink(target);
      outlinks.push(r ? { path: r.path, title: r.title } : { path: target, title: target });
    }
    const backlinks: NoteLink[] = [];
    for (const other of this.notes.values()) {
      if (other.path === n.path) continue;
      if (other.outlinks.some((t) => this.resolveLink(t)?.path === n.path)) backlinks.push({ path: other.path, title: other.title });
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

  private async refresh(rel: string): Promise<void> {
    const abs = path.join(this.root, rel);
    try {
      await fs.access(abs);
    } catch {
      if (this.notes.delete(rel)) this.emit('event', { type: 'deleted', path: rel } satisfies VaultEvent);
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
    for await (const rel of walk(this.root)) { seen.add(rel); await this.refresh(rel); }
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
      bodyLower: body.toLowerCase(), titleLower: title.toLowerCase(), pathLower: rel.toLowerCase(),
      tags: extractTags(body, frontmatter), outlinks: extractWikilinks(body),
      mtime: Math.round(stat.mtimeMs), hash: fnv1a(content), words: countWords(body),
    };
    void firstHeading; // (title from H1 is intentionally not used: Obsidian titles are filenames)
    this.notes.set(rel, note);
    if (emit) this.emit('event', { type: eventType, path: rel, mtime: note.mtime, hash: note.hash } satisfies VaultEvent);
    return note;
  }
}

async function* walk(root: string, rel = ''): AsyncGenerator<string> {
  let entries;
  try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    if (IGNORED_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(root, r);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) yield r;
  }
}

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
