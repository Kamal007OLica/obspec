/**
 * Obspec plugin UI. Vanilla TS, one state object, string-rendered views with
 * event delegation. Network lives here; document access lives in code.ts.
 */
import './app.css';
import { BridgeClient, BridgeClientError } from './bridge';
import { icons, nodeIcon } from './icons';
import { esc, highlight, highlightTerms, renderMarkdown } from './markdown';
import { DESIGN_HEADING, joinVaultPath, newNoteContent, pushFrontmatter, relativeTime, safeFileName, snapshotToMarkdown, toSpecMarkdown } from '../shared/notegen';
import {
  cardStatusOf, computeSyncState, DEFAULT_SETTINGS, obsidianSearchUrl, obsidianUrl,
  type CardStatus, type DesignSnapshot, type LinkedNodeSummary, type Note, type NoteListItem, type PluginToUi, type SearchResult, type SelectionSummary, type Settings, type SyncState, type UiToPlugin, type VaultEvent, type VaultInfo,
} from '../shared/protocol';

type Tab = 'search' | 'selection' | 'linked' | 'settings';

interface Toast { id: number; text: string; kind: 'info' | 'error' | 'success' }

interface State {
  settings: Settings; fileKey?: string; fileName: string; editorType: string;
  online: boolean; vault?: VaultInfo; healthError?: string;
  tab: Tab;
  query: string; results: SearchResult[]; total: number; tookMs: number; searching: boolean; active: number; recent: NoteListItem[];
  pickFor?: { nodeId: string; name: string };
  note?: Note; noteLoading: boolean; noteUpdatedAt?: number;
  selection: SelectionSummary; selectionNoteHash?: string | null; // null = missing
  linked: LinkedNodeSummary[]; noteHashes: Map<string, string | undefined>;
  busy: Set<string>; toasts: Toast[];
}

const state: State = {
  settings: { ...DEFAULT_SETTINGS }, fileName: '', editorType: 'figma',
  online: false, tab: 'search',
  query: '', results: [], total: 0, tookMs: 0, searching: false, active: 0, recent: [],
  noteLoading: false,
  selection: { count: 0 }, linked: [], noteHashes: new Map(),
  busy: new Set(), toasts: [],
};

const bridge = new BridgeClient(DEFAULT_SETTINGS.bridgeUrl);
const send = (m: UiToPlugin) => parent.postMessage({ pluginMessage: m }, '*');

// ───────────────────────────── DOM scaffold ───────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="top" id="top"></header>
  <main class="view">
    <section id="view-search" class="view" hidden>
      <div class="searchbar">
        <div class="field">${icons.search}<input id="q" type="search" placeholder="Search your vault…" autocomplete="off" spellcheck="false" aria-label="Search notes" /><span class="kbd">↑↓ ⏎</span></div>
        <div class="hints" id="hints"></div>
      </div>
      <div id="pickbar"></div>
      <div class="scroll" id="search-results" role="listbox"></div>
    </section>
    <section id="view-note" class="view" hidden></section>
    <section id="view-selection" class="view" hidden></section>
    <section id="view-linked" class="view" hidden></section>
    <section id="view-settings" class="view" hidden></section>
  </main>
  <div class="toasts" id="toasts" aria-live="polite"></div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('q');

// ───────────────────────────── Render ─────────────────────────────────────
function render(): void {
  renderTop();
  const showNote = state.tab === 'search' && (state.note || state.noteLoading);
  $('view-search').hidden = state.tab !== 'search' || !!showNote;
  $('view-note').hidden = !showNote;
  $('view-selection').hidden = state.tab !== 'selection';
  $('view-linked').hidden = state.tab !== 'linked';
  $('view-settings').hidden = state.tab !== 'settings';
  if (state.tab === 'search') { showNote ? renderNote() : renderSearch(); }
  if (state.tab === 'selection') renderSelection();
  if (state.tab === 'linked') renderLinked();
  renderToasts();
}

function renderTop(): void {
  const conn = !state.online ? 'off' : 'on';
  const label = state.online ? (state.vault?.name ?? 'Connected') : 'Bridge offline';
  const tabs: Array<[Tab, string, number?]> = [['search', 'Search'], ['selection', 'Selection'], ['linked', 'Linked', state.linked.length]];
  $('top').innerHTML = `
    <div class="brand">${icons.logo}<span class="wordmark">Obspec</span><span class="ver">v1.0</span>
      <button class="conn ${conn}" data-act="tab" data-arg="settings" title="${esc(state.online ? state.vault?.path ?? '' : state.healthError ?? 'Start the Obspec Bridge')}"><i class="dot"></i><span>${esc(label)}</span></button>
      <button class="icon-btn" data-act="tab" data-arg="settings" aria-label="Settings" title="Settings">${icons.gear}</button>
    </div>
    <nav class="tabs" role="tablist">${tabs.map(([t, l, n]) => `<button class="tab" role="tab" aria-selected="${state.tab === t}" data-act="tab" data-arg="${t}">${l}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</nav>`;
}

function renderSearch(): void {
  if (input.value !== state.query) input.value = state.query;
  $('hints').innerHTML = ['tag:', 'path:', '"phrase"', '-exclude'].map((h) => `<button class="hint${state.query.includes(h.replace(/"phrase"/, '"')) ? ' active' : ''}" data-act="hint" data-arg="${esc(h)}" title="Add ${esc(h)} to your query">${esc(h)}</button>`).join('');
  $('pickbar').innerHTML = state.pickFor ? `<div class="card" style="margin-top:0"><div class="card-head"><span class="ty">${icons.link}</span><div class="grow"><div class="name">Pick a note to link</div><div class="sub">${esc(state.pickFor.name)}</div></div><button class="icon-btn" data-act="cancel-pick" aria-label="Cancel">${icons.close}</button></div></div>` : '';

  const box = $('search-results');
  if (!state.online) { box.innerHTML = setupCard(); return; }
  if (!state.query.trim()) {
    box.innerHTML = state.recent.length
      ? `<div class="section-label">Recently edited</div><ul class="results">${state.recent.map((n, i) => resultRow({ path: n.path, title: n.title, folder: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '', tags: n.tags, mtime: n.mtime, score: 0, matchedIn: [], snippets: [] }, i, [])).join('')}</ul>`
      : emptyState(icons.empty, 'Your vault is empty', 'Create a note in Obsidian and it shows up here instantly.');
    return;
  }
  if (state.searching && !state.results.length) { box.innerHTML = `<div class="skeleton"><div style="width:60%"></div><div style="width:90%"></div><div style="width:40%"></div><div style="width:75%"></div></div>`; return; }
  if (!state.results.length) { box.innerHTML = emptyState(icons.empty, `Nothing for “${esc(state.query)}”`, 'Try fewer words, or filter with tag: and path:.'); return; }
  const terms = state.query.toLowerCase().match(/"([^"]+)"|(\S+)/g)?.map((t) => t.replace(/"/g, '')) ?? [];
  box.innerHTML = `<div class="section-label">Results<span class="count">${state.total} note${state.total === 1 ? '' : 's'} · ${state.tookMs} ms</span><button class="link-btn" data-act="search-obsidian" title="Run this search in Obsidian so the matches light up in your vault">${icons.external} in Obsidian</button></div>
    <ul class="results">${state.results.map((r, i) => resultRow(r, i, terms)).join('')}</ul>`;
  box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function resultRow(r: SearchResult, i: number, terms: string[]): string {
  const linkedCount = state.linked.filter((l) => l.link.path === r.path).length;
  const snip = r.snippets[0];
  return `<li><button class="result" role="option" aria-selected="${i === state.active}" data-act="open" data-arg="${esc(r.path)}" data-i="${i}">
    <div class="r-head"><span class="r-title">${highlightTerms(r.title, terms)}</span><span class="r-path">${esc(r.folder || '/')}</span></div>
    ${snip ? `<div class="r-snip">${snip.ranges.length ? `<span class="ln">L${snip.line}</span>` : ''}${highlight(snip.text, snip.ranges)}</div>` : ''}
    <div class="r-foot">${r.tags.slice(0, 4).map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}${linkedCount ? `<span class="chip linked">${icons.link} ${linkedCount} on canvas</span>` : ''}${r.matchedIn.length ? `<span class="where">${r.matchedIn.join(' · ')}</span>` : `<span class="where">${relativeTime(r.mtime)}</span>`}</div>
  </button></li>`;
}

function setupCard(): string {
  return `<div class="setup">
    <h4>Connect your vault</h4>
    <p>Obspec reads your notes through a tiny local server — nothing leaves your machine. Run it once in a terminal:</p>
    <pre>npx obspec-bridge --vault "~/path/to/your vault"</pre>
    <ol><li>Keep that terminal open.</li><li>Obspec connects to <code>${esc(state.settings.bridgeUrl)}</code> automatically.</li></ol>
    <div class="row" style="display:flex;gap:6px"><button class="btn primary sm" data-act="retry">${icons.refresh} Retry</button><button class="btn ghost sm" data-act="tab" data-arg="settings">Change address</button></div>
    ${state.healthError ? `<p style="margin-top:8px;color:var(--danger)">${esc(state.healthError)}</p>` : ''}
  </div>`;
}

function emptyState(icon: string, title: string, text: string, action = ''): string {
  return `<div class="empty"><div class="art">${icon}</div><h4>${title}</h4><p>${text}</p>${action}</div>`;
}

function renderNote(): void {
  const v = $('view-note');
  const n = state.note;
  if (!n) { v.innerHTML = `<div class="note-head"><button class="back" data-act="back">${icons.back} Back</button></div><div class="skeleton"><div style="width:50%;height:14px"></div><div style="width:95%"></div><div style="width:85%"></div><div style="width:70%"></div></div>`; return; }
  const linkedHere = state.linked.filter((l) => l.link.path === n.path);
  const known = new Set<string>();
  for (const o of n.outlinks) known.add(o.title.toLowerCase());
  const resolves = (t: string) => known.has(t.toLowerCase()) || n.outlinks.some((o) => o.path.toLowerCase() === (t.endsWith('.md') ? t : t + '.md').toLowerCase());
  const canLink = state.selection.count === 1;
  v.innerHTML = `
    <div class="note-head"><button class="back" data-act="back">${icons.back} Back</button><span class="crumb">${esc(n.folder || 'Vault root')}</span>
      <button class="icon-btn" data-act="open-obsidian" data-arg="${esc(n.path)}" title="Open in Obsidian" aria-label="Open in Obsidian">${icons.external}</button></div>
    <div class="scroll">
      <h2 class="note-title">${esc(n.title)}</h2>
      <div class="note-meta">${n.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}${n.tags.length ? '<span class="sep">·</span>' : ''}<span>${n.words} words</span><span class="sep">·</span><span title="${new Date(n.mtime).toLocaleString()}">edited ${relativeTime(n.mtime)}</span>${state.noteUpdatedAt ? `<span class="sep">·</span><span style="color:var(--success)">updated live</span>` : ''}
        ${linkedHere.length ? `<span class="sep">·</span><button class="chip linked" data-act="tab" data-arg="linked">${icons.link} ${linkedHere.length} on canvas</button>` : ''}</div>
      <div class="note-body"><div class="md">${renderMarkdown(stripLeadingTitle(n.body, n.title), { resolves }) || '<p style="color:var(--text-3)">Empty note.</p>'}</div></div>
      ${n.outlinks.length || n.backlinks.length ? `<div class="links">
        ${n.outlinks.length ? `<h5>Links to</h5><div class="linkrow">${n.outlinks.map((l) => `<button data-act="open" data-arg="${esc(l.path)}">${esc(l.title)}</button>`).join('')}</div>` : ''}
        ${n.backlinks.length ? `<h5>Linked from</h5><div class="linkrow">${n.backlinks.map((l) => `<button data-act="open" data-arg="${esc(l.path)}">${esc(l.title)}</button>`).join('')}</div>` : ''}
      </div>` : ''}
    </div>
    <div class="actionbar">
      <button class="btn primary" data-act="insert" ${busy('insert') ? 'disabled' : ''}>${busy('insert') ? '<i class="spin"></i>' : icons.card} Insert spec card</button>
      <button class="btn secondary" data-act="link" ${!canLink || busy('link') ? 'disabled' : ''} title="${canLink ? `Link “${esc(state.selection.node!.name)}” to this note` : 'Select exactly one layer in Figma first'}">${icons.link} Link selection</button>
      <span class="spacer"></span>
      <button class="icon-btn" data-act="download-spec" title="Save as .md for Figma Specs — drop the file on the canvas to make a native Spec" aria-label="Save as Figma Spec markdown">${icons.download}</button>
    </div>`;
}

const syncStateFor = computeSyncState;

const SYNC_LABEL: Record<SyncState, string> = { 'in-sync': 'In sync', 'note-changed': 'Note changed', 'design-changed': 'Design changed', 'both-changed': 'Both changed', missing: 'Note missing', unknown: 'Checking…' };

function renderSelection(): void {
  const v = $('view-selection');
  const s = state.selection;
  if (!s.node) { v.innerHTML = emptyState(icons.select, 'Nothing selected', 'Select a frame, component or any layer on the canvas to link it to a note or send it to Obsidian.'); return; }
  const n = s.node;
  const link = n.link;
  const sync = syncStateFor(link, link ? (state.selectionNoteHash !== undefined ? state.selectionNoteHash : state.noteHashes.has(link.path) ? (state.noteHashes.get(link.path) ?? null) : undefined) : undefined, n.designHash);
  const noteTitle = link ? link.path.split('/').pop()!.replace(/\.md$/, '') : '';
  v.innerHTML = `<div class="scroll">
    <div class="card">
      <div class="card-head"><span class="ty">${nodeIcon(n.type)}</span><div class="grow"><div class="name">${esc(n.name)}</div><div class="sub">${pretty(n.type)}${n.width ? ` · ${n.width} × ${n.height}` : ''} · ${esc(n.pageName)}${s.count > 1 ? ` · +${s.count - 1} more selected` : ''}</div></div></div>
      <div class="card-body">
        ${link ? `
          <div class="card-row"><span class="lbl">Note</span><button class="val" style="text-align:left;color:var(--accent);font-weight:600" data-act="open" data-arg="${esc(link.path)}" title="${esc(link.path)}">${esc(noteTitle)}</button><button class="icon-btn" data-act="open-obsidian" data-arg="${esc(link.path)}" title="Open in Obsidian">${icons.external}</button></div>
          <div class="card-row"><span class="lbl">Status</span><span class="val"><span class="pill ${sync}">${SYNC_LABEL[sync]}</span></span><span style="color:var(--text-3);font-size:10px">synced ${relativeTime(link.syncedAt)}</span></div>
          <div class="card-actions">
            ${sync === 'missing' ? '' : `<button class="btn ${sync === 'note-changed' || sync === 'both-changed' ? 'primary' : 'secondary'}" data-act="pull" data-arg="${n.id}" ${busy('pull') ? 'disabled' : ''} title="${link.kind === 'spec-card' ? 'Rebuild this spec card from the note' : 'Mark the note as read and refresh the link'}">${busy('pull') ? '<i class="spin"></i>' : icons.pull} Pull from Obsidian</button>`}
            ${link.kind === 'linked' || sync === 'missing' ? `<button class="btn ${sync === 'design-changed' || sync === 'missing' ? 'primary' : 'secondary'}" data-act="push" data-arg="${n.id}" ${busy('push') ? 'disabled' : ''} title="Write this layer's properties and copy into the note">${busy('push') ? '<i class="spin"></i>' : icons.push} Send to Obsidian</button>` : ''}
            <button class="btn danger" data-act="unlink" data-arg="${n.id}" title="Remove the link (keeps the note)">${icons.unlink}</button>
          </div>`
        : `
          <div class="card-row"><span class="lbl">Note</span><span class="val" style="color:var(--text-3)">Not linked to any note</span></div>
          <div class="card-actions">
            <button class="btn primary" data-act="push" data-arg="${n.id}" ${busy('push') || !state.online ? 'disabled' : ''} title="Create a note in ${esc(state.settings.pushFolder || 'the vault root')}">${busy('push') ? '<i class="spin"></i>' : icons.push} Send to Obsidian</button>
            <button class="btn secondary" data-act="pick" data-arg="${n.id}" ${!state.online ? 'disabled' : ''}>${icons.link} Link to a note…</button>
          </div>`}
      </div>
    </div>
    ${link ? `<p style="margin:10px 14px;color:var(--text-3);line-height:1.5">${link.kind === 'spec-card' ? 'This is a spec card. Pulling rebuilds it from the note; edit the note in Obsidian, not the card.' : 'Linked layer. Pull marks the latest note as seen; Send writes the layer’s properties and copy into the note’s <b>Design</b> section.'}</p>` : `<p style="margin:10px 14px;color:var(--text-3);line-height:1.5">Sending creates <b>${esc(joinVaultPath(state.settings.pushFolder, safeFileName(n.name) + '.md'))}</b> with the layer’s size, fills, copy and a link back to Figma.</p>`}
  </div>`;
}

function renderLinked(): void {
  const v = $('view-linked');
  if (!state.linked.length) { v.innerHTML = emptyState(icons.link, 'No linked layers yet', 'Insert a spec card from Search, or select a layer and link it to a note. Linked layers show up here with their sync status.', `<button class="btn secondary sm" data-act="tab" data-arg="search">${icons.search} Search notes</button>`); return; }
  const pages = new Map<string, LinkedNodeSummary[]>();
  for (const l of state.linked) { const arr = pages.get(l.pageName) ?? []; arr.push(l); pages.set(l.pageName, arr); }
  v.innerHTML = `<div class="scroll">${[...pages.entries()].map(([page, items]) => `<div class="section-label">${icons.page} ${esc(page)}<span class="count">${items.length}</span></div><ul class="linked-list">${items.map((l) => {
    const hash = state.noteHashes.get(l.link.path);
    const sync = syncStateFor(l.link, state.noteHashes.has(l.link.path) ? (hash ?? null) : undefined, l.designHash);
    return `<li class="linked-item" data-act="select-node" data-arg="${l.nodeId}" data-page="${l.pageId}" tabindex="0">
      <span class="ty">${l.link.kind === 'spec-card' ? icons.card : nodeIcon(l.nodeType)}</span>
      <div class="min"><div class="t">${esc(l.nodeName)}</div><div class="s">${icons.note}<span style="overflow:hidden;text-overflow:ellipsis">${esc(l.link.path)}</span></div></div>
      <span class="pill ${sync}" title="synced ${relativeTime(l.link.syncedAt)}">${SYNC_LABEL[sync]}</span>
    </li>`; }).join('')}</ul>`).join('')}
    <p style="margin:4px 14px 14px;color:var(--text-3)">Click a row to select it on the canvas. Pull or send from the Selection tab.</p></div>`;
}

function renderSettings(): void {
  const s = state.settings;
  $('view-settings').innerHTML = `<div class="scroll"><form class="form" id="settings-form">
    <label for="s-url">Bridge address</label><input id="s-url" name="bridgeUrl" value="${esc(s.bridgeUrl)}" placeholder="http://localhost:27123" />
    <div class="help">Where the Obspec Bridge is listening. Start it with <code>npx obspec-bridge --vault &lt;path&gt;</code>. Figma only lets this plugin reach <code>http://localhost:27123</code>, so keep that host and port unless you also edit the manifest.</div>
    <label for="s-token">Token <span style="font-weight:400;color:var(--text-3)">(optional)</span></label><input id="s-token" name="token" value="${esc(s.token)}" placeholder="Only if you started the bridge with --token" />
    <label for="s-folder">Folder for sent designs</label><input id="s-folder" name="pushFolder" value="${esc(s.pushFolder)}" placeholder="Figma" />
    <div class="help">Notes created by “Send to Obsidian” go here, relative to the vault root.</div>
    <label for="s-width">Spec card width</label><input id="s-width" name="cardWidth" type="number" min="240" max="1200" value="${s.cardWidth}" />
    <div id="s-status" class="status ${state.online ? 'ok' : 'err'}">${state.online ? `${icons.check} Connected to <b>${esc(state.vault?.name ?? '')}</b> · ${state.vault?.notes ?? 0} notes` : `${icons.wifiOff} ${esc(state.healthError ?? 'Not connected')}`}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Save &amp; reconnect</button><button class="btn ghost" type="button" data-act="tab" data-arg="search">Done</button>
      <span style="margin-left:auto;color:var(--text-3);font-size:10px">${esc(state.fileName)}${state.fileKey ? '' : ' · no file key'}</span></div>
  </form></div>`;
}

function renderToasts(): void {
  $('toasts').innerHTML = state.toasts.map((t) => `<div class="toast ${t.kind}">${esc(t.text)}<button data-act="dismiss" data-arg="${t.id}" aria-label="Dismiss">✕</button></div>`).join('');
}

// ───────────────────────────── Actions ────────────────────────────────────
let toastSeq = 0;
function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200): void {
  const id = ++toastSeq;
  state.toasts.push({ id, text, kind });
  renderToasts();
  window.setTimeout(() => { state.toasts = state.toasts.filter((t) => t.id !== id); renderToasts(); }, ms);
}
const busy = (k: string) => state.busy.has(k);
async function withBusy<T>(k: string, fn: () => Promise<T>): Promise<T | undefined> {
  state.busy.add(k); render();
  try { return await fn(); }
  catch (e) { toast(errMsg(e), 'error'); return undefined; }
  finally { state.busy.delete(k); render(); }
}
function errMsg(e: unknown): string {
  if (e instanceof BridgeClientError) return e.code === 'NETWORK' ? 'Can’t reach the Obspec Bridge — is it running?' : e.message;
  return (e as Error)?.message || String(e);
}

async function checkHealth(): Promise<void> {
  try {
    const h = await bridge.health();
    state.vault = h.vault; state.online = true; state.healthError = undefined;
    if (state.settings.vaultName !== h.vault.name) { state.settings.vaultName = h.vault.name; send({ type: 'save-settings', settings: state.settings }); }
    void loadRecent();
    void refreshHashes();
  } catch (e) {
    state.online = false; state.healthError = errMsg(e);
  }
  render();
}

async function loadRecent(): Promise<void> {
  try { state.recent = (await bridge.list(12)).notes; if (!state.query) render(); } catch { /* offline */ }
}

let searchAbort: AbortController | undefined;
let searchTimer: number | undefined;
function scheduleSearch(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void runSearch(), 110);
}
async function runSearch(): Promise<void> {
  searchAbort?.abort();
  const q = state.query.trim();
  if (!q) { state.results = []; state.total = 0; state.searching = false; render(); return; }
  const ctl = new AbortController(); searchAbort = ctl;
  state.searching = true; render();
  try {
    const r = await bridge.search(q, 50, ctl.signal);
    if (ctl.signal.aborted) return;
    state.results = r.results; state.total = r.total; state.tookMs = r.tookMs; state.active = 0;
  } catch (e) {
    if ((e as BridgeClientError).code === 'ABORTED') return;
    toast(errMsg(e), 'error');
  } finally { if (!ctl.signal.aborted) { state.searching = false; render(); } }
}

async function openNote(path: string): Promise<void> {
  state.tab = 'search'; state.noteLoading = true; state.note = undefined; state.noteUpdatedAt = undefined; render();
  try {
    state.note = await bridge.note(path);
    $('view-note').querySelector('.scroll')?.scrollTo(0, 0);
  } catch (e) { toast(errMsg(e), 'error'); }
  state.noteLoading = false; render();
}

function closeNote(): void { state.note = undefined; state.noteLoading = false; render(); input.focus(); }

async function pickNote(path: string): Promise<void> {
  const target = state.pickFor!;
  await withBusy('link', async () => {
    const note = await bridge.note(path);
    send({ type: 'select-node', nodeId: target.nodeId });
    send({ type: 'link-selection', note });
  });
  state.pickFor = undefined; state.tab = 'selection'; render();
}

async function pull(nodeId: string): Promise<void> {
  const link = state.selection.node?.id === nodeId ? state.selection.node.link : state.linked.find((l) => l.nodeId === nodeId)?.link;
  if (!link) return toast('Layer is not linked', 'error');
  await withBusy('pull', async () => {
    const note = await bridge.note(link.path);
    send({ type: 'pull', nodeId, note, vaultName: state.settings.vaultName });
  });
}

let pendingPush: string | undefined;
function push(nodeId: string): void {
  if (!state.online) return toast('Connect the bridge first', 'error');
  pendingPush = nodeId; state.busy.add('push'); render();
  send({ type: 'snapshot', nodeId });
}

async function completePush(snap: DesignSnapshot): Promise<void> {
  const nodeId = pendingPush; pendingPush = undefined;
  if (!nodeId) return;
  try {
    const existing = state.selection.node?.id === nodeId ? state.selection.node.link : state.linked.find((l) => l.nodeId === nodeId)?.link;
    const fm = pushFrontmatter(snap, state.fileName);
    const section = { heading: DESIGN_HEADING, markdown: snapshotToMarkdown(snap) };
    let path = existing?.path ?? joinVaultPath(state.settings.pushFolder, `${safeFileName(snap.name)}.md`);
    let res;
    let exists = true;
    try { await bridge.note(path); } catch (e) { if ((e as BridgeClientError).code === 'NOT_FOUND') exists = false; else throw e; }
    if (exists) res = await bridge.patch({ path, frontmatter: fm, section });
    else res = await bridge.write({ path, content: newNoteContent(snap, state.fileName) });
    path = res.note.path;
    send({ type: 'mark-pushed', nodeId, path, note: res.note, designHash: snap.hash });
    toast(res.created ? `Created ${path}` : `Updated ${path}`, 'success');
  } catch (e) { toast(errMsg(e), 'error'); }
  state.busy.delete('push'); render();
}

/** Keep the chip on each spec-card frame truthful. Only sends when the state actually changes. */
const sentCardStatus = new Map<string, CardStatus>();
function syncCardChips(): void {
  for (const l of state.linked) {
    if (l.link.kind !== 'spec-card') continue;
    const hash = state.noteHashes.has(l.link.path) ? (state.noteHashes.get(l.link.path) ?? null) : undefined;
    const status = cardStatusOf(computeSyncState(l.link, hash, undefined));
    if (!status || sentCardStatus.get(l.nodeId) === status) continue;
    sentCardStatus.set(l.nodeId, status);
    send({ type: 'card-status', nodeId: l.nodeId, status });
  }
}

function downloadSpec(note: Note): void {
  const md = toSpecMarkdown(note, state.settings.vaultName);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = `${safeFileName(note.title)}.md`;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Saved ${a.download} — drop it on the canvas to make a Figma Spec`, 'success', 5000);
}

async function refreshHashes(): Promise<void> {
  if (!state.online) return;
  const paths = state.linked.map((l) => l.link.path);
  if (state.selection.node?.link) paths.push(state.selection.node.link.path);
  if (!paths.length) { state.noteHashes = new Map(); return; }
  try {
    state.noteHashes = await bridge.hashes(paths);
    const sel = state.selection.node?.link;
    state.selectionNoteHash = sel ? (state.noteHashes.get(sel.path) ?? null) : undefined;
    syncCardChips();
  } catch { /* keep stale */ }
  render();
}

function saveSettings(form: HTMLFormElement): void {
  const fd = new FormData(form);
  state.settings = {
    ...state.settings,
    bridgeUrl: String(fd.get('bridgeUrl') || DEFAULT_SETTINGS.bridgeUrl).trim().replace(/\/+$/, ''),
    token: String(fd.get('token') || '').trim(),
    pushFolder: String(fd.get('pushFolder') ?? '').trim().replace(/^\/+|\/+$/g, ''),
    cardWidth: Math.min(1200, Math.max(240, Number(fd.get('cardWidth')) || DEFAULT_SETTINGS.cardWidth)),
  };
  send({ type: 'save-settings', settings: state.settings });
  bridge.configure(state.settings.bridgeUrl, state.settings.token);
  toast('Settings saved');
  void checkHealth().then(() => renderSettings());
}

// ───────────────────────────── Events ─────────────────────────────────────
app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const arg = el.dataset.arg ?? '';
  switch (el.dataset.act) {
    case 'tab': state.tab = arg as Tab; if (arg !== 'search') state.pickFor = state.pickFor; if (arg === 'settings') renderSettings(); render(); if (arg === 'search' && !state.note) input.focus(); break;
    case 'open': state.active = Number(el.dataset.i ?? state.active); if (state.pickFor) void pickNote(arg); else void openNote(arg); break;
    case 'back': closeNote(); break;
    case 'hint': { const h = arg === '"phrase"' ? '"' : arg; state.query = (state.query ? state.query.replace(/\s*$/, ' ') : '') + h; input.value = state.query; input.focus(); scheduleSearch(); render(); break; }
    case 'retry': void checkHealth(); break;
    case 'open-obsidian': send({ type: 'open-url', url: obsidianUrl(state.settings.vaultName, arg) }); break;
    case 'search-obsidian': send({ type: 'open-url', url: obsidianSearchUrl(state.settings.vaultName, state.query.trim()) }); break;
    case 'download-spec': if (state.note) downloadSpec(state.note); break;
    case 'insert': if (state.note) void withBusy('insert', async () => { send({ type: 'insert-spec-card', note: state.note!, vaultName: state.settings.vaultName, width: state.settings.cardWidth }); }); break;
    case 'link': if (state.note) void withBusy('link', async () => { send({ type: 'link-selection', note: state.note! }); }); break;
    case 'pick': state.pickFor = { nodeId: arg, name: state.selection.node?.name ?? 'layer' }; state.tab = 'search'; state.note = undefined; render(); input.focus(); break;
    case 'cancel-pick': state.pickFor = undefined; render(); break;
    case 'pull': void pull(arg); break;
    case 'push': push(arg); break;
    case 'unlink': send({ type: 'unlink', nodeId: arg }); break;
    case 'select-node': send({ type: 'select-node', nodeId: arg, pageId: el.dataset.page }); state.tab = 'selection'; render(); break;
    case 'dismiss': state.toasts = state.toasts.filter((t) => t.id !== Number(arg)); renderToasts(); break;
  }
});
app.addEventListener('click', (e) => {
  const w = (e.target as HTMLElement).closest<HTMLElement>('[data-wiki]');
  if (!w || !state.note) return;
  const target = w.dataset.wiki!;
  const hit = state.note.outlinks.find((o) => o.title.toLowerCase() === target.toLowerCase() || o.path.toLowerCase() === (target.endsWith('.md') ? target : target + '.md').toLowerCase());
  if (hit && !w.classList.contains('broken')) void openNote(hit.path);
  else { state.note = undefined; state.query = target; input.value = target; state.tab = 'search'; scheduleSearch(); render(); }
});
app.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!a) return;
  e.preventDefault();
  if (a.getAttribute('href') !== '#') send({ type: 'open-url', url: a.href });
});
app.addEventListener('submit', (e) => { const f = e.target as HTMLFormElement; if (f.id === 'settings-form') { e.preventDefault(); saveSettings(f); } });
app.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('.linked-item') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e.target as HTMLElement).click(); }
});

input.addEventListener('input', () => { state.query = input.value; state.active = 0; scheduleSearch(); });
input.addEventListener('keydown', (e) => {
  const list = state.query.trim() ? state.results : state.recent;
  if (e.key === 'ArrowDown') { e.preventDefault(); state.active = Math.min(list.length - 1, state.active + 1); renderSearch(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); state.active = Math.max(0, state.active - 1); renderSearch(); }
  else if (e.key === 'Enter') { const item = list[state.active]; if (item) { state.pickFor ? void pickNote(item.path) : void openNote(item.path); } }
  else if (e.key === 'Escape') { if (state.query) { state.query = ''; input.value = ''; void runSearch(); } else if (state.pickFor) { state.pickFor = undefined; render(); } }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.note) { closeNote(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.tab = 'search'; state.note = undefined; render(); input.focus(); input.select(); }
});

// ───────────────────────────── Sandbox messages ──────────────────────────
window.addEventListener('message', (e) => {
  const m = e.data?.pluginMessage as PluginToUi | undefined;
  if (!m) return;
  switch (m.type) {
    case 'init':
      state.settings = { ...DEFAULT_SETTINGS, ...m.settings }; state.fileKey = m.fileKey; state.fileName = m.fileName; state.editorType = m.editorType;
      bridge.configure(state.settings.bridgeUrl, state.settings.token);
      void checkHealth();
      if (m.command === 'link' || m.command === 'push') state.tab = 'selection';
      render(); input.focus();
      break;
    case 'settings': state.settings = { ...DEFAULT_SETTINGS, ...m.settings }; break;
    case 'selection':
      state.selection = m.selection; state.selectionNoteHash = undefined;
      if (m.selection.node?.link && state.online) void refreshHashes();
      render();
      break;
    case 'linked': state.linked = m.nodes; void refreshHashes(); render(); break;
    case 'snapshot': void completePush(m.snapshot); break;
    case 'linked-ok': toast('Linked', 'success'); if (state.note && !state.pickFor) { state.tab = 'selection'; state.note = undefined; render(); } break;
    case 'pulled': toast('Pulled latest note', 'success'); sentCardStatus.set(m.nodeId, 'in-sync'); break;
    case 'spec-card-inserted': sentCardStatus.set(m.nodeId, 'in-sync'); toast('Spec card inserted', 'success'); break;
    case 'error': toast(m.message, 'error'); state.busy.clear(); pendingPush = undefined; render(); break;
  }
});

bridge.onStatus((online) => { if (online !== state.online) { state.online = online; if (online) void checkHealth(); else render(); } });
bridge.onEvent((ev: VaultEvent) => {
  if (ev.type === 'hello') { if (!state.online || state.vault?.notes !== ev.vault.notes) void checkHealth(); return; }
  if (ev.type === 'deleted') state.noteHashes.set(ev.path, undefined);
  else state.noteHashes.set(ev.path, ev.hash);
  if (state.selection.node?.link?.path === ev.path) state.selectionNoteHash = ev.type === 'deleted' ? null : ev.hash;
  syncCardChips();
  if (state.note?.path === ev.path) {
    if (ev.type === 'deleted') { toast('This note was deleted in Obsidian', 'error'); closeNote(); }
    else void bridge.note(ev.path).then((n) => { state.note = n; state.noteUpdatedAt = Date.now(); render(); }).catch(() => {});
  }
  if (state.query.trim()) scheduleSearch(); else void loadRecent();
  render();
});

/** Obsidian notes often start with an H1 equal to the filename; the header already shows it. */
function stripLeadingTitle(body: string, title: string): string {
  const re = new RegExp(`^\\s*#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n?`);
  return body.replace(re, '');
}
function pretty(t: string): string { return t.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()); }

render();
send({ type: 'ui-ready' });
