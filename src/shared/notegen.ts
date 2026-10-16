/**
 * Generates the markdown Obspec writes into Obsidian when a design is pushed.
 * Pure functions — shared by the UI (which does the writing) and tests.
 */
import { obsidianUrl, type DesignSnapshot, type Note } from './protocol';

export const DESIGN_HEADING = 'Design';

/**
 * The note's "Design" section. Only blocks Figma Specs understands (headings, lists,
 * quotes, code, dividers) — no tables — so the same .md reads cleanly as a Spec.
 */
export function snapshotToMarkdown(s: DesignSnapshot): string {
  const lines: string[] = [];
  const row = (k: string, v: string) => lines.push(`- **${k}:** ${v}`);
  row('Node', `${s.name} · ${s.nodeId}`);
  row('Page', s.page);
  row('Size', `${s.width} × ${s.height}`);
  for (const [k, v] of s.properties) if (k !== 'Type' && k !== 'Size') row(k, v);
  if (s.texts.length) row('Label', s.texts[0].replace(/\n+/g, ' '));
  if (s.url) row('Link', s.url);
  if (s.component) {
    row('Component', s.component.name);
    const vp = s.component.variantProps;
    if (vp && Object.keys(vp).length) for (const [k, v] of Object.entries(vp)) row(k, v);
  }
  if (s.texts.length > 1) { lines.push('', '**Copy**'); for (const t of s.texts) lines.push(`- ${t.replace(/\n+/g, ' ')}`); }
  if (s.children.length) { lines.push('', '**Layers**'); for (const c of s.children) lines.push(`- ${c}`); }
  lines.push('', `_Captured from page “${s.page}” · ${formatStamp(s.capturedAt)}_`);
  return lines.join('\n');
}

/**
 * A note as a Spec-ready markdown file: drop it on the Figma canvas and Figma turns it
 * into a native Spec. Frontmatter is folded into a quote line; wikilinks and embeds
 * become plain text so nothing dangles outside the vault.
 */
export function toSpecMarkdown(note: Note, vaultName: string): string {
  let body = note.body.replace(/\r/g, '');
  body = body.replace(new RegExp(`^\\s*#\\s+${escapeRe(note.title)}\\s*\\n?`), '');
  body = body
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, t: string) => `(image: ${t.trim()})`)
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, '$1')
    .replace(/==(.+?)==/g, '**$1**');
  const meta: string[] = [`From Obsidian · ${note.path}`];
  if (note.tags.length) meta.push(note.tags.map((t) => `#${t}`).join(' '));
  if (vaultName) meta.push(`[Open in Obsidian](${obsidianUrl(vaultName, note.path)})`);
  return `# ${note.title}\n\n> ${meta.join(' · ')}\n\n${body.trim()}\n\n---\n\n_Synced by Obspec · ${formatStamp(Date.now())}_\n`;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function pushFrontmatter(s: DesignSnapshot, fileName: string): Record<string, unknown> {
  return {
    type: 'figma-spec',
    figma_file: fileName,
    figma_page: s.page,
    figma_node: s.nodeId,
    figma_url: s.url ?? null,
    figma_updated: new Date(s.capturedAt).toISOString(),
  };
}

/** Full content for a brand-new note created by "Send to Obsidian". */
export function newNoteContent(s: DesignSnapshot, fileName: string): string {
  const fm = { ...pushFrontmatter(s, fileName), tags: ['figma'] };
  const fmText = ['---', ...Object.entries(fm).map(([k, v]) => Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v === null ? '' : yaml(v)}`), '---'].join('\n');
  return `${fmText}\n# ${s.name}\n\n## ${DESIGN_HEADING}\n\n${snapshotToMarkdown(s)}\n\n## Notes\n\n_Write here — Obspec shows this note whenever the layer is selected in Figma._\n`;
}

function yaml(v: unknown): string {
  const str = String(v);
  return /[:#\[\]{}&*!|>'"%@`,?]|^\s|\s$/.test(str) ? JSON.stringify(str) : str;
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|#^\[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return cleaned || 'Untitled layer';
}

export function joinVaultPath(folder: string, file: string): string {
  const f = folder.replace(/^\/+|\/+$/g, '');
  return f ? `${f}/${file}` : file;
}

export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}
