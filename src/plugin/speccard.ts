/// <reference types="@figma/plugin-typings" />
/**
 * Spec card: a note rendered onto the canvas as an auto-layout frame.
 * Rebuilt in place on "pull" so the node id (and its link) survive.
 */
import { obsidianUrl, type CardStatus, type Note } from '../shared/protocol';

export interface CardOptions { vaultName: string; width?: number }

const FONT_REG: FontName = { family: 'Inter', style: 'Regular' };
const FONT_MED: FontName = { family: 'Inter', style: 'Medium' };
const FONT_SEMI: FontName = { family: 'Inter', style: 'Semi Bold' };

const C = {
  bg: rgb('#FFFFFF'), border: rgb('#E7E5EE'), text: rgb('#1C1B22'), muted: rgb('#6F6D7A'),
  accent: rgb('#6E56CF'), accentSoft: rgb('#EEEBFB'), code: rgb('#F4F3F8'), divider: rgb('#EEEDF3'),
};

const STATUS: Record<CardStatus, { label: string; fg: RGB; bg: RGB }> = {
  'in-sync': { label: 'In sync', fg: rgb('#1F8A4C'), bg: rgb('#E5F6EC') },
  'note-changed': { label: 'Note changed', fg: rgb('#B45309'), bg: rgb('#FDF1E0') },
  missing: { label: 'Note missing', fg: rgb('#C62A2A'), bg: rgb('#FDECEC') },
};

export async function buildSpecCard(note: Note, opts: CardOptions): Promise<FrameNode> {
  await loadFonts();
  const card = figma.createFrame();
  card.name = `Spec · ${note.title}`;
  const vp = figma.viewport.center;
  card.x = Math.round(vp.x - (opts.width ?? 400) / 2);
  card.y = Math.round(vp.y - 160);
  await fillCard(card, note, opts);
  return card;
}

export async function updateSpecCard(card: FrameNode, note: Note, opts: CardOptions): Promise<void> {
  await loadFonts();
  card.name = `Spec · ${note.title}`;
  for (const child of [...card.children]) child.remove();
  await fillCard(card, note, opts);
}

async function fillCard(card: FrameNode, note: Note, opts: CardOptions): Promise<void> {
  const width = opts.width ?? 400;
  card.layoutMode = 'VERTICAL';
  card.primaryAxisSizingMode = 'AUTO';
  card.counterAxisSizingMode = 'FIXED';
  card.resize(width, 100);
  card.paddingTop = card.paddingBottom = 24;
  card.paddingLeft = card.paddingRight = 24;
  card.itemSpacing = 12;
  card.cornerRadius = 14;
  card.fills = [solid(C.bg)];
  card.strokes = [solid(C.border)];
  card.strokeWeight = 1;
  card.effects = [{ type: 'DROP_SHADOW', color: { r: 0.11, g: 0.1, b: 0.2, a: 0.08 }, offset: { x: 0, y: 6 }, radius: 18, spread: -4, visible: true, blendMode: 'NORMAL' }];
  card.clipsContent = false;

  // Header: ● OBSIDIAN · folder ................ [● In sync]
  const header = row(card, 'header', 8);
  header.layoutAlign = 'STRETCH'; header.primaryAxisAlignItems = 'SPACE_BETWEEN'; header.counterAxisAlignItems = 'CENTER';
  const eyebrow = row(header, 'eyebrow', 8);
  const dot = figma.createEllipse(); dot.name = 'dot'; dot.resize(8, 8); dot.fills = [solid(C.accent)]; eyebrow.appendChild(dot);
  eyebrow.counterAxisAlignItems = 'CENTER';
  text(eyebrow, 'source', ['OBSIDIAN', note.folder ? `  ·  ${note.folder}` : ''].join(''), { font: FONT_MED, size: 10, color: C.muted, spacing: 1.2 });
  statusChip(header, 'in-sync');

  // Title
  text(card, 'title', note.title, { font: FONT_SEMI, size: 20, color: C.text, lineHeight: 26, fill: true });

  // Tags
  if (note.tags.length) {
    const tags = row(card, 'tags', 6);
    tags.layoutWrap = 'WRAP';
    tags.counterAxisSpacing = 6;
    for (const t of note.tags.slice(0, 8)) chip(tags, `#${t}`);
  }

  divider(card);

  // Body (markdown → lightweight blocks)
  const blocks = toBlocks(note.body, 60, note.title);
  const body = figma.createFrame(); body.name = 'body'; body.layoutMode = 'VERTICAL'; body.itemSpacing = 8; body.fills = [];
  body.primaryAxisSizingMode = 'AUTO'; body.counterAxisSizingMode = 'AUTO'; body.layoutAlign = 'STRETCH';
  card.appendChild(body);
  for (const b of blocks) {
    if (b.kind === 'h') text(body, 'heading', b.text, { font: FONT_SEMI, size: b.level <= 2 ? 14 : 13, color: C.text, lineHeight: 20, fill: true });
    else if (b.kind === 'code') {
      const box = figma.createFrame(); box.name = 'code'; box.layoutMode = 'VERTICAL'; box.fills = [solid(C.code)]; box.cornerRadius = 8;
      box.paddingTop = box.paddingBottom = 10; box.paddingLeft = box.paddingRight = 12; box.layoutAlign = 'STRETCH'; box.primaryAxisSizingMode = 'AUTO'; box.counterAxisSizingMode = 'AUTO';
      body.appendChild(box);
      text(box, 'code-text', b.text, { font: FONT_REG, size: 11, color: C.text, lineHeight: 16, fill: true, mono: true });
    } else if (b.kind === 'quote') {
      const q = row(body, 'quote', 10); q.layoutAlign = 'STRETCH';
      const bar = figma.createRectangle(); bar.name = 'bar'; bar.resize(3, 10); bar.cornerRadius = 2; bar.fills = [solid(C.accent)]; bar.layoutAlign = 'STRETCH'; q.appendChild(bar);
      text(q, 'quote-text', b.text, { font: FONT_REG, size: 13, color: C.muted, lineHeight: 20, fill: true, italic: false });
    } else text(body, b.kind === 'li' ? 'item' : 'paragraph', b.text, { font: FONT_REG, size: 13, color: C.text, lineHeight: 20, fill: true });
  }
  if (!blocks.length) text(body, 'paragraph', '(empty note)', { font: FONT_REG, size: 13, color: C.muted, lineHeight: 20, fill: true });

  divider(card);

  // Footer: open link + meta
  const footer = row(card, 'footer', 8); footer.layoutAlign = 'STRETCH'; footer.primaryAxisAlignItems = 'SPACE_BETWEEN'; footer.counterAxisAlignItems = 'CENTER';
  const link = text(footer, 'open', 'Open in Obsidian ↗', { font: FONT_MED, size: 11, color: C.accent });
  try { link.hyperlink = { type: 'URL', value: obsidianUrl(opts.vaultName, note.path) }; } catch { /* some hosts reject custom schemes */ }
  text(footer, 'meta', `${note.path}  ·  ${note.words} words`, { font: FONT_REG, size: 10, color: C.muted });
}

/** Status lives on the frame itself, so it reads at a glance without opening the plugin. */
function statusChip(parent: FrameNode, status: CardStatus): FrameNode {
  const st = STATUS[status];
  const chip = figma.createFrame();
  chip.name = 'status'; chip.layoutMode = 'HORIZONTAL'; chip.itemSpacing = 5; chip.cornerRadius = 999;
  chip.paddingTop = chip.paddingBottom = 3; chip.paddingLeft = 7; chip.paddingRight = 8;
  chip.primaryAxisSizingMode = 'AUTO'; chip.counterAxisSizingMode = 'AUTO'; chip.counterAxisAlignItems = 'CENTER';
  chip.fills = [solid(st.bg)];
  parent.appendChild(chip);
  const d = figma.createEllipse(); d.name = 'status-dot'; d.resize(6, 6); d.fills = [solid(st.fg)]; chip.appendChild(d);
  text(chip, 'status-label', st.label, { font: FONT_MED, size: 10, color: st.fg });
  return chip;
}

/** Flip the chip in place (no rebuild), e.g. when the note changes on disk. */
export async function setCardStatus(card: FrameNode, status: CardStatus): Promise<void> {
  const header = card.findChild((n) => n.name === 'header' && n.type === 'FRAME') as FrameNode | null;
  if (!header) return;
  let chip = header.findChild((n) => n.name === 'status' && n.type === 'FRAME') as FrameNode | null;
  await loadFonts();
  if (!chip) { statusChip(header, status); return; }
  const st = STATUS[status];
  chip.fills = [solid(st.bg)];
  const d = chip.findChild((n) => n.name === 'status-dot') as EllipseNode | null;
  if (d) d.fills = [solid(st.fg)];
  const label = chip.findChild((n) => n.name === 'status-label') as TextNode | null;
  if (label) { label.characters = st.label; label.fills = [solid(st.fg)]; }
}

// ───────────────────────────── helpers ───────────────────────────────────

async function loadFonts(): Promise<void> {
  await Promise.all([FONT_REG, FONT_MED, FONT_SEMI].map((f) => figma.loadFontAsync(f)));
}

interface TextOpts { font: FontName; size: number; color: RGB; lineHeight?: number; fill?: boolean; spacing?: number; mono?: boolean; italic?: boolean }

function text(parent: FrameNode, name: string, chars: string, o: TextOpts): TextNode {
  const t = figma.createText();
  t.name = name;
  t.fontName = o.font;
  t.characters = chars.length > 6000 ? chars.slice(0, 6000) + '…' : chars;
  t.fontSize = o.size;
  t.fills = [solid(o.color)];
  if (o.lineHeight) t.lineHeight = { value: o.lineHeight, unit: 'PIXELS' };
  if (o.spacing) t.letterSpacing = { value: o.spacing, unit: 'PIXELS' };
  parent.appendChild(t);
  if (o.fill) { t.layoutAlign = 'STRETCH'; t.textAutoResize = 'HEIGHT'; } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  return t;
}

function row(parent: FrameNode, name: string, gap: number): FrameNode {
  const f = figma.createFrame();
  f.name = name; f.layoutMode = 'HORIZONTAL'; f.itemSpacing = gap; f.fills = [];
  f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
  parent.appendChild(f);
  return f;
}

function chip(parent: FrameNode, label: string): void {
  const c = figma.createFrame();
  c.name = 'tag'; c.layoutMode = 'HORIZONTAL'; c.fills = [solid(C.accentSoft)]; c.cornerRadius = 999;
  c.paddingTop = c.paddingBottom = 3; c.paddingLeft = c.paddingRight = 8;
  c.primaryAxisSizingMode = 'AUTO'; c.counterAxisSizingMode = 'AUTO';
  parent.appendChild(c);
  text(c, 'label', label, { font: FONT_MED, size: 10, color: C.accent });
}

function divider(parent: FrameNode): void {
  const d = figma.createRectangle();
  d.name = 'divider'; d.resize(10, 1); d.fills = [solid(C.divider)]; d.layoutAlign = 'STRETCH';
  parent.appendChild(d);
}

type Block = { kind: 'h'; level: number; text: string } | { kind: 'p' | 'li' | 'quote' | 'code'; text: string };

/** Markdown → blocks. Deliberately lossy: the card is a readable mirror, not a renderer. */
export function toBlocks(md: string, maxBlocks = 60, dropTitle?: string): Block[] {
  const out: Block[] = [];
  // Obsidian notes often open with an H1 equal to the filename — don't repeat it under the card title.
  if (dropTitle) md = md.replace(new RegExp(`^\\s*#\\s+${dropTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`), '');
  const lines = md.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: inline(para.join(' ')) }); para = []; } };
  for (let i = 0; i < lines.length && out.length < maxBlocks; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      out.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(l);
    if (h) { flush(); out.push({ kind: 'h', level: h[1].length, text: inline(h[2]) }); continue; }
    const li = /^\s*(?:[-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(l);
    if (li) { flush(); const box = li[1] === undefined ? '•' : li[1] === ' ' ? '☐' : '☑'; out.push({ kind: 'li', text: `${box}  ${inline(li[2])}` }); continue; }
    const q = /^>\s?(.*)$/.exec(l);
    if (q) { flush(); const prev = out[out.length - 1]; if (prev && prev.kind === 'quote') prev.text += ' ' + inline(q[1]); else out.push({ kind: 'quote', text: inline(q[1]) }); continue; }
    if (/^\s*$/.test(l)) { flush(); continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(l)) { flush(); continue; }
    if (/^\|.*\|\s*$/.test(l)) { flush(); if (!/^\|\s*-+/.test(l)) out.push({ kind: 'li', text: l.split('|').map((c) => c.trim()).filter(Boolean).join('   ') }); continue; }
    para.push(l.trim());
  }
  flush();
  return out;
}

function inline(s: string): string {
  return s
    .replace(/!\[\[([^\]]+)\]\]/g, '[image: $1]')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[image: $1]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[\s(])#([A-Za-z0-9_\-/]+)/g, '$1#$2')
    .trim();
}

function rgb(hexStr: string): RGB {
  const n = parseInt(hexStr.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function solid(color: RGB): SolidPaint { return { type: 'SOLID', color }; }
