/**
 * Generates the markdown Obspec writes into Obsidian when a design is pushed.
 * Pure functions — shared by the UI (which does the writing) and tests.
 */
import type { DesignSnapshot } from './protocol';

export const DESIGN_HEADING = 'Design';

export function snapshotToMarkdown(s: DesignSnapshot): string {
  const lines: string[] = [];
  lines.push('| Property | Value |', '| --- | --- |');
  for (const [k, v] of s.properties) lines.push(`| ${k} | ${v.replace(/\|/g, '\\|')} |`);
  if (s.component) {
    lines.push('', `**Component:** ${s.component.name}`);
    const vp = s.component.variantProps;
    if (vp && Object.keys(vp).length) lines.push(...Object.entries(vp).map(([k, v]) => `- ${k}: ${v}`));
  }
  if (s.texts.length) { lines.push('', '**Copy**'); for (const t of s.texts) lines.push(`- ${t.replace(/\n+/g, ' ')}`); }
  if (s.children.length) { lines.push('', '**Layers**'); for (const c of s.children) lines.push(`- ${c}`); }
  lines.push('', `_Captured from page “${s.page}” · ${formatStamp(s.capturedAt)}_`);
  return lines.join('\n');
}

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
