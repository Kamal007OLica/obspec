/**
 * Grep-style vault search with light ranking.
 *
 * Query grammar (deliberately small):
 *   word word        all words must match (title, path, tags or body)
 *   "exact phrase"   phrase must appear verbatim
 *   tag:design       note must carry the tag (prefix match on nested tags)
 *   path:Product/    note path must contain the fragment
 *   -word            note must NOT contain the word
 */
import type { SearchMatch, SearchResult } from '../../src/shared/protocol';
import type { IndexedNote } from './vault';

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  tags: string[];
  paths: string[];
  excludes: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], phrases: [], tags: [], paths: [], excludes: [] };
  const re = /"([^"]+)"|(\S+)/g;
  for (const m of q.toLowerCase().matchAll(re)) {
    if (m[1]) { out.phrases.push(m[1].trim()); continue; }
    const tok = m[2];
    if (tok.startsWith('tag:') && tok.length > 4) out.tags.push(tok.slice(4).replace(/^#/, ''));
    else if (tok.startsWith('path:') && tok.length > 5) out.paths.push(tok.slice(5));
    else if (tok.startsWith('-') && tok.length > 1) out.excludes.push(tok.slice(1));
    else if (tok.startsWith('#') && tok.length > 1) out.tags.push(tok.slice(1));
    else out.terms.push(tok);
  }
  return out;
}

export function search(notes: Iterable<IndexedNote>, rawQuery: string, limit = 50): { results: SearchResult[]; total: number } {
  const q = parseQuery(rawQuery);
  const needles = [...q.terms, ...q.phrases];
  const hasFilters = q.tags.length || q.paths.length || q.excludes.length;
  if (!needles.length && !hasFilters) return { results: [], total: 0 };

  const scored: Array<{ note: IndexedNote; result: SearchResult }> = [];
  for (const n of notes) {
    if (q.tags.length && !q.tags.every((t) => n.tags.some((nt) => nt.toLowerCase() === t || nt.toLowerCase().startsWith(t + '/')))) continue;
    if (q.paths.length && !q.paths.every((p) => n.pathLower.includes(p))) continue;
    if (q.excludes.some((x) => n.titleLower.includes(x) || n.bodyLower.includes(x))) continue;

    let score = 0;
    const matchedIn = new Set<SearchResult['matchedIn'][number]>();
    let ok = true;
    for (const needle of needles) {
      let hit = false;
      if (n.titleLower === needle) { score += 100; hit = true; matchedIn.add('title'); }
      else if (n.titleLower.startsWith(needle)) { score += 60; hit = true; matchedIn.add('title'); }
      else if (n.titleLower.includes(needle)) { score += 40; hit = true; matchedIn.add('title'); }
      if (n.tags.some((t) => t.toLowerCase() === needle)) { score += 35; hit = true; matchedIn.add('tag'); }
      if (n.pathLower.includes(needle)) { score += 15; hit = true; matchedIn.add('path'); }
      const count = countOccurrences(n.bodyLower, needle);
      if (count > 0) { score += Math.min(25, 8 + Math.log2(count) * 4); hit = true; matchedIn.add('body'); }
      if (!hit) { ok = false; break; }
    }
    if (!ok) continue;
    if (!needles.length) score = 1; // filter-only query
    // Small recency nudge so equally-scored notes surface the freshest first.
    score += Math.max(0, 5 - (Date.now() - n.mtime) / (1000 * 60 * 60 * 24 * 30));
    // Shorter titles rank slightly higher on ties (specific over generic).
    score -= Math.min(5, n.title.length / 20);

    scored.push({ note: n, result: { path: n.path, title: n.title, folder: n.folder, tags: n.tags, mtime: n.mtime, score, matchedIn: [...matchedIn], snippets: [] } });
  }
  scored.sort((a, b) => b.result.score - a.result.score || a.result.title.localeCompare(b.result.title));
  // Snippets are the expensive part (line splitting per note): build them only for what we return.
  const top = scored.slice(0, limit);
  for (const { note, result } of top) result.snippets = makeSnippets(note.body, note.bodyLower, needles);
  return { results: top.map((t) => t.result), total: scored.length };
}

function countOccurrences(hay: string, needle: string): number {
  let i = 0, c = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { c++; i += needle.length; if (c >= 20) break; } // score saturates at ~20 hits
  return c;
}

/** Up to `max` line-based snippets with highlight ranges. Lines matching more terms win; ties go to earlier lines. */
export function makeSnippets(body: string, _bodyLower: string, needles: string[], max = 2): SearchMatch[] {
  if (!needles.length) return [firstLineSnippet(body)];
  const lines = body.split('\n');
  const scored: Array<{ score: number; li: number; text: string; ranges: Array<[number, number]> }> = [];
  for (let li = 0; li < lines.length; li++) {
    if (/^---\s*$/.test(lines[li])) continue;
    const text = cleanLine(lines[li]);
    const lower = text.toLowerCase();
    const ranges: Array<[number, number]> = [];
    let distinct = 0;
    for (const needle of needles) {
      let i = 0, hit = false;
      while ((i = lower.indexOf(needle, i)) !== -1) { ranges.push([i, i + needle.length]); i += needle.length; hit = true; if (ranges.length > 20) break; }
      if (hit) distinct++;
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = mergeRanges(ranges);
    scored.push({ score: distinct * 1000 + merged.reduce((n, [s, e]) => n + (e - s), 0), li, text, ranges: merged });
  }
  scored.sort((a, b) => b.score - a.score || a.li - b.li);
  const picked = scored.slice(0, max);
  return picked.length ? picked.map((p) => clip(p.text, p.ranges, p.li + 1)) : [firstLineSnippet(body)];
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function firstLineSnippet(body: string): SearchMatch {
  const line = body.split('\n').map(cleanLine).find((l) => l.trim().length > 0) ?? '';
  return { text: line.slice(0, 140), ranges: [], line: 1 };
}

/** Strip markdown noise that reads badly in a one-line snippet. */
function cleanLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/^>\s?/, '')
    .trim();
}

function clip(text: string, ranges: Array<[number, number]>, line: number, width = 150): SearchMatch {
  if (text.length <= width) return { text, ranges, line };
  const first = ranges[0]?.[0] ?? 0;
  const start = Math.max(0, Math.min(first - 40, text.length - width));
  const end = Math.min(text.length, start + width);
  const prefix = start > 0 ? '…' : '';
  const clipped = prefix + text.slice(start, end) + (end < text.length ? '…' : '');
  const shift = start - prefix.length;
  return {
    text: clipped,
    ranges: ranges.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s - shift, e - shift] as [number, number]),
    line,
  };
}
