/**
 * Minimal, dependency-free markdown helpers for Obsidian notes:
 * frontmatter (a pragmatic YAML subset), tags, wikilinks, headings, sections.
 */

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Byte offset in the raw content where the body begins. */
  bodyOffset: number;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): ParsedNote {
  const m = FM_RE.exec(content);
  if (!m) return { frontmatter: {}, body: content, bodyOffset: 0 };
  return { frontmatter: parseYamlSubset(m[1]), body: content.slice(m[0].length), bodyOffset: m[0].length };
}

/**
 * Parses the subset of YAML Obsidian actually writes: scalars, inline arrays,
 * block lists, and one level of nesting. Unknown shapes fall back to strings.
 */
export function parseYamlSubset(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(line);
    if (!kv) { i++; continue; }
    const key = kv[1].trim();
    const rest = kv[2].trim();
    if (rest === '' || rest === '|' || rest === '>') {
      // block list or nested map or block scalar
      const items: string[] = [];
      const nested: Record<string, unknown> = {};
      const blockLines: string[] = [];
      let j = i + 1;
      let mode: 'list' | 'map' | 'block' | null = rest === '|' || rest === '>' ? 'block' : null;
      while (j < lines.length && (/^\s+\S/.test(lines[j]) || lines[j].trim() === '')) {
        const l = lines[j];
        if (l.trim() === '') { if (mode === 'block') blockLines.push(''); j++; continue; }
        if (mode === 'block') { blockLines.push(l.replace(/^\s{2}/, '')); j++; continue; }
        const li = /^\s*-\s*(.*)$/.exec(l);
        if (li && mode !== 'map') { mode = 'list'; items.push(li[1].trim()); j++; continue; }
        const nk = /^\s+([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(l);
        if (nk && mode !== 'list') { mode = 'map'; nested[nk[1].trim()] = scalar(nk[2].trim()); j++; continue; }
        break;
      }
      if (mode === 'list') out[key] = items.map(scalar);
      else if (mode === 'map') out[key] = nested;
      else if (mode === 'block') out[key] = blockLines.join(rest === '>' ? ' ' : '\n').trim();
      else out[key] = null;
      i = j;
      continue;
    }
    out[key] = scalar(rest);
    i++;
  }
  return out;
}

function scalar(v: string): unknown {
  if (v === '') return null;
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => scalar(s.trim()));
  }
  if (/^(["']).*\1$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function stringifyFrontmatter(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm).filter((k) => fm[k] !== undefined);
  if (keys.length === 0) return '';
  const lines: string[] = ['---'];
  for (const k of keys) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${k}: []`); continue; }
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlScalar(item)}`);
    } else if (v && typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) lines.push(`  ${nk}: ${yamlScalar(nv)}`);
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // Quote when YAML would misread it.
  if (s === '' || /[:#\[\]{}&*!|>'"%@`,?]|^\s|\s$|^(true|false|null|~)$|^-?\d/.test(s)) return JSON.stringify(s);
  return s;
}

/** Replace (or append) the frontmatter block in a raw note. */
export function withFrontmatter(content: string, fm: Record<string, unknown>): string {
  const { body } = parseFrontmatter(content);
  return stringifyFrontmatter(fm) + body;
}

const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\-/]+[A-Za-z0-9_])/g;
const WIKILINK_RE = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g; // `![[…]]` embeds are not links
const CODE_FENCE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

export function extractTags(body: string, frontmatter: Record<string, unknown>): string[] {
  const set = new Set<string>();
  const fmTags = frontmatter.tags ?? frontmatter.tag;
  const addFm = (t: unknown) => {
    if (typeof t === 'string') t.split(/[,\s]+/).forEach((x) => x && set.add(x.replace(/^#/, '')));
  };
  if (Array.isArray(fmTags)) fmTags.forEach(addFm);
  else addFm(fmTags);
  const stripped = body.replace(CODE_FENCE_RE, ' ');
  for (const m of stripped.matchAll(TAG_RE)) set.add(m[2]);
  return [...set].sort();
}

export function extractWikilinks(body: string): string[] {
  const set = new Set<string>();
  const stripped = body.replace(CODE_FENCE_RE, ' ');
  for (const m of stripped.matchAll(WIKILINK_RE)) set.add(m[1].trim());
  return [...set];
}

export function firstHeading(body: string): string | undefined {
  const m = /^#\s+(.+?)\s*$/m.exec(body);
  return m?.[1];
}

/** Replace the content under an H2 `heading` (until the next H1/H2), or append it. */
export function replaceSection(body: string, heading: string, markdown: string): string {
  const lines = body.split('\n');
  const h = `## ${heading}`;
  const start = lines.findIndex((l) => l.trim() === h);
  const block = [h, '', markdown.trim(), ''];
  if (start === -1) {
    const trimmed = body.replace(/\s+$/, '');
    return (trimmed ? trimmed + '\n\n' : '') + block.join('\n');
  }
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n');
}

export function countWords(body: string): number {
  return (body.match(/\S+/g) ?? []).length;
}
