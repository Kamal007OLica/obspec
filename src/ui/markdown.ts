/**
 * Small, safe markdown → HTML renderer tuned for Obsidian notes.
 * Everything is HTML-escaped first; only our own tags are emitted.
 */

export interface RenderOptions {
  /** Known note paths/titles to decide whether a wikilink resolves. */
  resolves?: (target: string) => boolean;
  /** Turn a local image reference (file name or vault path) into a fetchable URL. */
  resolveImage?: (target: string) => string | undefined;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), opts)}</p>`); para = []; } };

  while (i < lines.length) {
    const l = lines[i];
    // fenced code
    const fence = /^```(\w+)?\s*$/.exec(l);
    if (fence) {
      flush();
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="lang-${esc(fence[1])}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) { flush(); const lvl = Math.min(4, h[1].length); out.push(`<h${lvl}>${inline(h[2], opts)}</h${lvl}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(l)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), opts)}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        i++;
        // continuation lines (indented)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
        if (task) items.push(`<li class="task${task[1] === ' ' ? '' : ' done'}"><span class="box"></span><span>${inline(task[2], opts)}</span></li>`);
        else items.push(`<li>${inline(item, opts)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*$/.test(l)) { flush(); i++; continue; }
    para.push(l.trim());
    i++;
  }
  flush();
  return out.join('');
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function inline(src: string, opts: RenderOptions = {}): string {
  // Protect code spans first.
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t: string, size: string | undefined) => {
    const url = opts.resolveImage?.(t.trim());
    if (!url) return `<span class="chip neutral">🖼 ${t.trim()}</span>`;
    const w = size && /^\d+/.test(size) ? ` width="${parseInt(size, 10)}"` : '';
    return `<img class="embed" src="${esc(url)}" alt="${esc(t.trim())}" loading="lazy"${w}>`;
  });
  s = s.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target: string, _anchor: string, alias: string) => {
    const ok = opts.resolves ? opts.resolves(target.trim()) : true;
    return `<span class="wiki${ok ? '' : ' broken'}" data-wiki="${esc(target.trim())}" role="link" tabindex="0">${alias ?? target}</span>`;
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt: string, url: string) => {
    const local = !/^(https?:|data:)/i.test(url) ? opts.resolveImage?.(url) : undefined;
    return `<img class="embed" alt="${alt}" src="${local ? esc(local) : safeUrl(url)}" loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g, (m) => `<a href="${safeUrl(m)}" target="_blank" rel="noopener">${m}</a>`);
  s = s.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/==(.+?)==/g, '<span class="hl">$1</span>');
  s = s.replace(/(^|[\s(])#([A-Za-z][A-Za-z0-9_\-/]*)/g, '$1<span class="tag">#$2</span>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return s;
}

function safeUrl(u: string): string {
  const t = u.trim();
  if (/^(https?:|mailto:|obsidian:|figma:)/i.test(t)) return esc(t);
  return '#';
}

/** Wrap matched ranges of a snippet in <mark>. */
export function highlight(text: string, ranges: Array<[number, number]>): string {
  if (!ranges.length) return esc(text);
  let out = ''; let last = 0;
  for (const [s, e] of ranges) {
    if (s < last) continue;
    out += esc(text.slice(last, s)) + '<mark>' + esc(text.slice(s, e)) + '</mark>';
    last = e;
  }
  return out + esc(text.slice(last));
}

/** Highlight whole-word-ish query terms inside a title. */
export function highlightTerms(text: string, terms: string[]): string {
  const clean = terms.map((t) => t.replace(/^(tag:|path:|-|#)/, '')).filter((t) => t.length > 1);
  if (!clean.length) return esc(text);
  const re = new RegExp(`(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}
