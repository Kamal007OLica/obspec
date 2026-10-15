/**
 * Preview harness: a mock Figma sandbox that speaks the real Obspec protocol
 * to the real plugin UI, plus scripted use-case emulations.
 */
import { DEFAULT_SETTINGS, fnv1a, type DesignSnapshot, type LinkedNodeSummary, type Note, type NoteLinkRecord, type PluginToUi, type SelectionSummary, type Settings, type UiToPlugin, type VaultEvent } from '../src/shared/protocol';
import { toBlocks } from '../src/plugin/speccard';

const BRIDGE = 'http://127.0.0.1:27123';
const FILE_KEY = 'PREVIEWfilekey0001';
const FILE_NAME = 'Checkout — Oct 2026';

// ───────────────────────────── Mock document ──────────────────────────────
interface MockNode {
  id: string; type: string; name: string; width: number; height: number; pageId: string;
  pluginData: Record<string, string>; texts: string[]; children: string[]; fills: string[];
  kind?: 'spec-card'; note?: Note; preview?: Array<['t' | 'b' | 'i', string]>;
}
interface MockPage { id: string; name: string; nodes: MockNode[] }

let pages: MockPage[] = [];
let currentPageId = '0:1';
let selection: string[] = [];
let idSeq = 100;

function seed(): void {
  const mk = (id: string, pageId: string, type: string, name: string, w: number, h: number, texts: string[], children: string[], fills: string[], preview?: MockNode['preview']): MockNode =>
    ({ id, pageId, type, name, width: w, height: h, texts, children, fills, pluginData: {}, preview });
  pages = [
    { id: '0:1', name: 'Checkout', nodes: [
      mk('1:2', '0:1', 'FRAME', 'Checkout / Payment step', 390, 844, ['How would you like to pay?', "You won't be charged until you confirm.", 'Apple Pay', 'Card', 'Continue to payment'], ['Header', 'Payment methods', 'Order summary', 'CTA'], ['#FFFFFF'], [['t', 'How would you like to pay?'], ['i', ' Apple Pay'], ['i', 'Card number'], ['b', 'Continue to payment']]),
      mk('1:3', '0:1', 'FRAME', 'Checkout / Shipping', 390, 844, ['Where should we send it?', 'Address', 'Use saved address'], ['Header', 'Address form', 'CTA'], ['#FFFFFF'], [['t', 'Where should we send it?'], ['i', 'Street address'], ['i', 'City'], ['b', 'Continue']]),
      mk('1:4', '0:1', 'FRAME', 'Checkout / Declined card', 390, 420, ['Your card was declined.', 'Try another card or payment method.'], ['Alert', 'Actions'], ['#FFF5F5'], [['t', 'Your card was declined.'], ['b', 'Try another method']]),
    ] },
    { id: '0:2', name: 'Components', nodes: [
      mk('2:2', '0:2', 'COMPONENT', 'Button / Primary', 160, 36, ['Continue'], ['Label'], ['#6E56CF'], [['b', 'Continue']]),
      mk('2:3', '0:2', 'COMPONENT', 'Input / Default', 320, 36, ['Label', 'Placeholder'], ['Label', 'Field', 'Helper'], ['#FFFFFF'], [['i', 'Placeholder']]),
    ] },
  ];
  currentPageId = '0:1'; selection = []; idSeq = 100;
}
seed();

const page = (id = currentPageId) => pages.find((p) => p.id === id)!;
const findNode = (id: string) => { for (const p of pages) { const n = p.nodes.find((x) => x.id === id); if (n) return n; } return undefined; };
/** Same rule as the real plugin: the drift fingerprint IS the snapshot hash. */
const designHash = (n: MockNode) => snapshot(n).hash;
const readLink = (n: MockNode): NoteLinkRecord | undefined => { try { return n.pluginData['obspec:link'] ? JSON.parse(n.pluginData['obspec:link']) : undefined; } catch { return undefined; } };
const writeLink = (n: MockNode, l: NoteLinkRecord | null) => { if (l) n.pluginData['obspec:link'] = JSON.stringify(l); else delete n.pluginData['obspec:link']; };

function selectionSummary(): SelectionSummary {
  const n = selection.map(findNode).filter(Boolean)[0] as MockNode | undefined;
  if (!n) return { count: 0 };
  return { count: selection.length, node: { id: n.id, name: n.name, type: n.type, width: n.width, height: n.height, pageName: page(n.pageId).name, link: readLink(n), designHash: designHash(n) } };
}
function linkedNodes(): LinkedNodeSummary[] {
  const out: LinkedNodeSummary[] = [];
  for (const p of pages) for (const n of p.nodes) { const link = readLink(n); if (link) out.push({ nodeId: n.id, nodeName: n.name, nodeType: n.type, pageId: p.id, pageName: p.name, link, designHash: designHash(n) }); }
  return out.sort((a, b) => b.link.syncedAt - a.link.syncedAt);
}
function snapshot(n: MockNode): DesignSnapshot {
  const properties: Array<[string, string]> = [['Type', n.type.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())], ['Size', `${n.width} × ${n.height}`], ['Fill', n.fills.join(', ')]];
  if (n.type === 'FRAME') properties.push(['Auto layout', 'Vertical'], ['Padding', '24 20 24 20'], ['Gap', '16']);
  if (n.type === 'COMPONENT') properties.push(['Radius', '8']);
  const core = { name: n.name, type: n.type, width: n.width, height: n.height, properties, texts: n.texts, children: n.children, component: n.type === 'COMPONENT' ? { name: n.name, key: 'mockkey' } : undefined };
  return { nodeId: n.id, page: page(n.pageId).name, ...core, url: `https://www.figma.com/design/${FILE_KEY}?node-id=${n.id.replace(':', '-')}`, capturedAt: Date.now(), hash: fnv1a(JSON.stringify(core)) };
}

// ───────────────────────────── Sandbox ⇄ UI ──────────────────────────────
const iframe = document.getElementById('plugin') as HTMLIFrameElement;
const post = (m: PluginToUi) => iframe.contentWindow?.postMessage({ pluginMessage: m }, '*');
const loadSettings = (): Settings => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('obspec:settings') ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } };
const pushSelection = () => post({ type: 'selection', selection: selectionSummary() });
const pushLinked = () => post({ type: 'linked', nodes: linkedNodes() });
function select(ids: string[], scroll = true): void {
  selection = ids;
  const n = ids[0] ? findNode(ids[0]) : undefined;
  if (n && n.pageId !== currentPageId) currentPageId = n.pageId;
  renderCanvas(); pushSelection();
  if (n) { const link = readLink(n); if (link) showObsidian(link.path); }
  if (scroll) document.getElementById(`node-${ids[0]}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

window.addEventListener('message', (e) => {
  const m = e.data?.pluginMessage as UiToPlugin | undefined;
  if (!m) return;
  log(`ui → sandbox: ${m.type}`, 'ui');
  try {
    switch (m.type) {
      case 'ui-ready': post({ type: 'init', settings: loadSettings(), fileKey: FILE_KEY, fileName: FILE_NAME, editorType: 'figma' }); pushSelection(); pushLinked(); applyTheme(); break;
      case 'get-settings': post({ type: 'settings', settings: loadSettings() }); break;
      case 'save-settings': localStorage.setItem('obspec:settings', JSON.stringify(m.settings)); post({ type: 'settings', settings: m.settings }); break;
      case 'get-selection': pushSelection(); break;
      case 'get-linked': pushLinked(); break;
      case 'insert-spec-card': {
        const id = `${++idSeq}:1`;
        const n: MockNode = { id, pageId: currentPageId, type: 'FRAME', name: `Spec / ${m.note.title}`, width: m.width, height: 0, texts: [m.note.title], children: ['eyebrow', 'title', 'body', 'footer'], fills: ['#FFFFFF'], pluginData: {}, kind: 'spec-card', note: m.note };
        page().nodes.push(n);
        writeLink(n, { v: 1, path: m.note.path, noteHash: m.note.hash, noteMtime: m.note.mtime, kind: 'spec-card', linkedAt: Date.now(), syncedAt: Date.now() });
        select([id]); post({ type: 'spec-card-inserted', nodeId: id }); pushLinked(); notify(`Inserted “${m.note.title}”`); break;
      }
      case 'link-selection': {
        if (selection.length !== 1) throw new Error('Select exactly one layer to link');
        const n = findNode(selection[0])!;
        writeLink(n, { v: 1, path: m.note.path, noteHash: m.note.hash, noteMtime: m.note.mtime, designHash: designHash(n), kind: 'linked', linkedAt: Date.now(), syncedAt: Date.now() });
        renderCanvas(); post({ type: 'linked-ok', nodeId: n.id }); pushSelection(); pushLinked(); showObsidian(m.note.path); notify(`Linked “${n.name}” → ${m.note.title}`); break;
      }
      case 'unlink': { const n = findNode(m.nodeId); if (n) { writeLink(n, null); if (n.kind === 'spec-card') { /* card stays, just unlinked */ } } renderCanvas(); pushSelection(); pushLinked(); notify('Unlinked'); break; }
      case 'pull': {
        const n = findNode(m.nodeId); if (!n) throw new Error('Layer no longer exists');
        const link = readLink(n); if (!link) throw new Error('Layer is not linked');
        if (n.kind === 'spec-card') { n.note = m.note; n.name = `Spec / ${m.note.title}`; n.texts = [m.note.title]; }
        writeLink(n, { ...link, noteHash: m.note.hash, noteMtime: m.note.mtime, designHash: designHash(n), syncedAt: Date.now() });
        renderCanvas(); post({ type: 'pulled', nodeId: n.id }); pushSelection(); pushLinked(); notify(`Pulled “${m.note.title}”`); break;
      }
      case 'snapshot': { const n = findNode(m.nodeId); if (!n) throw new Error('Layer no longer exists'); post({ type: 'snapshot', snapshot: snapshot(n) }); break; }
      case 'mark-pushed': {
        const n = findNode(m.nodeId); if (!n) throw new Error('Layer no longer exists');
        const prev = readLink(n);
        writeLink(n, { v: 1, kind: prev?.kind ?? 'linked', linkedAt: prev?.linkedAt ?? Date.now(), path: m.path, noteHash: m.note.hash, noteMtime: m.note.mtime, designHash: m.designHash, syncedAt: Date.now() });
        renderCanvas(); pushSelection(); pushLinked(); showObsidian(m.path); notify(`Sent “${n.name}” to Obsidian`); break;
      }
      case 'select-node': { const n = findNode(m.nodeId); if (!n) throw new Error('Layer no longer exists'); select([n.id]); break; }
      case 'open-url': log(`openExternal(${m.url})`, 'sandbox'); break;
      case 'notify': notify(m.message); break;
      case 'resize': iframe.width = String(m.width); iframe.height = String(m.height); document.getElementById('win-size')!.textContent = `${m.width} × ${m.height}`; break;
      case 'close': log('closePlugin()', 'sandbox'); break;
    }
  } catch (err) { post({ type: 'error', message: (err as Error).message }); }
});

function notify(msg: string): void { log(`figma.notify: ${msg}`, 'sandbox'); }

// ───────────────────────────── Canvas rendering ──────────────────────────
function renderCanvas(): void {
  document.getElementById('pages')!.innerHTML = pages.map((p) => `<button class="page${p.id === currentPageId ? ' on' : ''}" data-page="${p.id}">${p.name}</button>`).join('');
  const stage = document.getElementById('stage')!;
  stage.innerHTML = page().nodes.map((n) => {
    const link = readLink(n);
    const sel = selection.includes(n.id) ? ' selected' : '';
    if (n.kind === 'spec-card' && n.note) {
      const blocks = toBlocks(n.note.body, 40, n.note.title);
      return `<div class="node spec${sel}" id="node-${n.id}" data-id="${n.id}">${link ? '<span class="badge card">spec card</span>' : ''}
        <div class="eyebrow"><i></i>OBSIDIAN${n.note.folder ? `  ·  ${esc(n.note.folder)}` : ''}</div>
        <div class="title">${esc(n.note.title)}</div>
        ${n.note.tags.length ? `<div class="tags">${n.note.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="div"></div>
        <div class="body">${blocks.map((b) => b.kind === 'h' ? `<div class="h">${esc(b.text)}</div>` : b.kind === 'code' ? `<div class="code">${esc(b.text)}</div>` : b.kind === 'quote' ? `<div class="quote">${esc(b.text)}</div>` : `<div>${esc(b.text)}</div>`).join('')}</div>
        <div class="div"></div>
        <div class="foot"><b>Open in Obsidian ↗</b><span>${esc(n.note.path)} · ${n.note.words} words</span></div></div>`;
    }
    return `<div class="node${sel}" id="node-${n.id}" data-id="${n.id}">${link ? `<span class="badge">linked</span>` : ''}
      <div class="nm"><span class="k">${n.type === 'COMPONENT' ? '◆' : '#'}</span>${esc(n.name)}</div>
      <div class="meta">${n.width} × ${n.height}</div>
      ${n.preview ? `<div class="preview">${n.preview.map(([k, t]) => `<div class="${k}">${esc(t)}</div>`).join('')}</div>` : ''}</div>`;
  }).join('');
}
document.getElementById('stage')!.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
  if (el) select(selection[0] === el.dataset.id ? [] : [el.dataset.id!], false);
  else if (e.target === e.currentTarget) select([]);
});
document.getElementById('pages')!.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
  if (el) { currentPageId = el.dataset.page!; selection = []; renderCanvas(); pushSelection(); }
});
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ───────────────────────────── Obsidian pane + bridge events ─────────────
let obPath = '';
async function showObsidian(path: string): Promise<void> {
  obPath = path;
  document.getElementById('ob-path')!.textContent = path;
  const r = await fetch(`/__obsidian/raw?path=${encodeURIComponent(path)}`);
  document.getElementById('ob-raw')!.textContent = r.ok ? await r.text() : '(note not found)';
}
async function editInObsidian(path: string, append: string): Promise<void> {
  await fetch('/__obsidian/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, append }) });
  log(`Obsidian edited ${path}`, 'vault');
}
document.getElementById('ob-edit')!.addEventListener('click', () => { if (obPath) void editInObsidian(obPath, `- Edited in Obsidian at ${new Date().toLocaleTimeString()} — remember loyalty points\n`); });

const status = document.getElementById('bridge-status')!;
function connectBridge(): void {
  const es = new EventSource(`${BRIDGE}/events`);
  es.addEventListener('vault', (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as VaultEvent;
    status.textContent = `bridge · ${ev.type === 'hello' ? ev.vault.notes + ' notes' : ev.type + ' ' + ev.path}`; status.className = 'status on';
    if (ev.type !== 'hello') { log(`vault ${ev.type}: ${ev.path}`, 'vault'); if (ev.path === obPath) void showObsidian(obPath); }
  });
  es.onerror = () => { status.textContent = 'bridge offline'; status.className = 'status off'; es.close(); setTimeout(connectBridge, 2000); };
}
connectBridge();

// ───────────────────────────── Theme ─────────────────────────────────────
const THEMES = {
  light: { bg: '#ffffff', 'bg-secondary': '#f5f5f5', 'bg-tertiary': '#e6e6e6', 'bg-hover': '#f0f0f0', text: '#1e1e1e', 'text-secondary': 'rgba(0,0,0,.5)', 'text-tertiary': 'rgba(0,0,0,.3)', border: '#e6e6e6', 'border-strong': '#d9d9d9' },
  dark: { bg: '#2c2c2c', 'bg-secondary': '#383838', 'bg-tertiary': '#444444', 'bg-hover': '#383838', text: '#ffffff', 'text-secondary': 'rgba(255,255,255,.7)', 'text-tertiary': 'rgba(255,255,255,.4)', border: '#444444', 'border-strong': '#5a5a5a' },
};
function applyTheme(): void {
  const dark = localStorage.getItem('obspec:preview-theme') === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.getElementById('theme')!.textContent = dark ? 'Light theme' : 'Dark theme';
  const doc = iframe.contentDocument; if (!doc) return;
  doc.documentElement.className = dark ? 'figma-dark' : 'figma-light';
  let style = doc.getElementById('figma-theme-vars'); if (!style) { style = doc.createElement('style'); style.id = 'figma-theme-vars'; doc.head.appendChild(style); }
  style.textContent = `:root{${Object.entries(THEMES[dark ? 'dark' : 'light']).map(([k, v]) => `--figma-color-${k}:${v}`).join(';')}}`;
  iframe.style.background = THEMES[dark ? 'dark' : 'light'].bg;
}
document.getElementById('theme')!.addEventListener('click', () => { localStorage.setItem('obspec:preview-theme', document.documentElement.classList.contains('dark') ? 'light' : 'dark'); applyTheme(); });
document.getElementById('reset')!.addEventListener('click', async () => { await fetch('/__obsidian/reset', { method: 'POST' }); seed(); renderCanvas(); obPath = ''; document.getElementById('ob-raw')!.textContent = 'Vault reset.'; document.getElementById('ob-path')!.textContent = ''; iframe.src = '/ui.html'; log('reset vault + canvas', 'sandbox'); document.querySelectorAll('.sc').forEach((b) => b.classList.remove('done')); });

// ───────────────────────────── Log ───────────────────────────────────────
function log(text: string, cls: 'ui' | 'sandbox' | 'vault' = 'sandbox'): void {
  const ol = document.getElementById('log')!;
  const li = document.createElement('li'); li.className = cls; li.textContent = text; ol.appendChild(li);
  while (ol.children.length > 60) ol.removeChild(ol.firstChild!);
  li.scrollIntoView({ block: 'nearest' });
}

// ───────────────────────────── Scenario runner ───────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = () => iframe.contentDocument!;
async function waitFor<T extends Element>(sel: string, pred: (el: T) => boolean = () => true, timeout = 8000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const el = doc().querySelector<T>(sel); if (el && !(el as unknown as HTMLElement).hidden && pred(el)) return el; await sleep(60); }
  throw new Error(`Timed out waiting for ${sel}`);
}
async function typeInto(sel: string, text: string): Promise<void> {
  const el = await waitFor<HTMLInputElement>(sel);
  el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
  for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(40); }
}
async function click(sel: string, pred?: (el: HTMLElement) => boolean): Promise<void> { const el = await waitFor<HTMLElement>(sel, pred); el.click(); await sleep(250); }
const tab = (t: string) => click(`.tab[data-arg="${t}"]`);
const pill = (state: string) => waitFor('.pill', (el) => el.classList.contains(state), 10000);

interface Scenario { title: string; detail: string; run: () => Promise<void> }
const scenarios: Scenario[] = [
  { title: 'Search the vault, insert a spec card', detail: 'Type a query → open the note → “Insert spec card”. The card lands on the canvas, linked to the note.', run: async () => {
    await tab('search'); await click('#q').catch(() => {});
    await typeInto('#q', 'apple pay');
    await waitFor('.result');
    await sleep(500);
    await click('.result');
    await waitFor('.note-title');
    await sleep(700);
    await click('[data-act="insert"]');
    await waitFor('.toast');
    await sleep(300);
    await tab('linked');
    await sleep(600);
  } },
  { title: 'Link an existing layer to a note', detail: 'Select “Checkout / Payment step” → Selection tab → “Link to a note…” → pick “Payment Methods”.', run: async () => {
    select(['1:2']);
    await tab('selection');
    await click('[data-act="pick"]');
    await typeInto('#q', 'payment methods');
    await waitFor('.result');
    await sleep(400);
    await click('.result');
    await pill('in-sync');
    await sleep(500);
  } },
  { title: 'Edit the note in Obsidian → pull into Figma', detail: 'A line is appended to the linked note on disk. Obspec sees “Note changed” live; “Pull” brings it in.', run: async () => {
    let n = selection[0] ? findNode(selection[0]) : undefined;
    if (!n || !readLink(n)) { const card = pages.flatMap((p) => p.nodes).find((x) => readLink(x)); if (!card) await scenarios[0].run(); n = pages.flatMap((p) => p.nodes).find((x) => readLink(x))!; select([n.id]); }
    await tab('selection');
    const link = readLink(n)!;
    await showObsidian(link.path);
    await sleep(600);
    await editInObsidian(link.path, `\n## From Obsidian\n- [ ] Added at ${new Date().toLocaleTimeString()}: show loyalty points on the summary\n`);
    await pill('note-changed');
    await sleep(900);
    await click('[data-act="pull"]');
    await pill('in-sync');
    await sleep(400);
  } },
  { title: 'Send a design to Obsidian', detail: 'Select the “Button / Primary” component → “Send to Obsidian”. A note is created with size, fill, copy and a Figma link.', run: async () => {
    select(['2:2']);
    await tab('selection');
    await click('[data-act="push"]');
    await pill('in-sync');
    await sleep(600);
  } },
  { title: 'Design changes → status flips → re-send', detail: 'The button label is changed on the canvas. Obspec shows “Design changed”; sending again updates the note’s Design section.', run: async () => {
    let n = selection[0] ? findNode(selection[0]) : undefined;
    if (!n || readLink(n)?.kind !== 'linked' || n.kind === 'spec-card') { await scenarios[3].run(); n = findNode('2:2')!; }
    await tab('selection');
    n.texts = n.texts.map((t) => (t === 'Continue' ? 'Pay now' : t === 'Continue to payment' ? 'Pay now' : t));
    if (n.preview) n.preview = n.preview.map(([k, t]) => [k, t === 'Continue' || t === 'Continue to payment' ? 'Pay now' : t]);
    renderCanvas(); pushSelection(); log(`design edited: label → “Pay now” on ${n.name}`, 'sandbox');
    await pill('design-changed');
    await sleep(900);
    await click('[data-act="push"]');
    await pill('in-sync');
    await sleep(400);
  } },
];
const scBox = document.getElementById('scenarios')!;
scBox.innerHTML = scenarios.map((s, i) => `<button class="sc" data-sc="${i}"><span class="n">${i + 1}</span><span><div>${s.title}</div><div class="d">${s.detail}</div></span></button>`).join('');
let running = false;
scBox.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sc]');
  if (!btn || running) return;
  running = true; btn.classList.add('running'); scBox.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const s = scenarios[Number(btn.dataset.sc)];
  log(`▶ ${s.title}`, 'sandbox');
  try { await s.run(); btn.classList.add('done'); log(`✓ ${s.title}`, 'sandbox'); }
  catch (err) { log(`✗ ${(err as Error).message}`, 'sandbox'); }
  running = false; btn.classList.remove('running'); scBox.querySelectorAll('button').forEach((b) => (b.disabled = false));
});
// Expose for the console / automation.
(window as unknown as { obspec: unknown }).obspec = { runScenario: (i: number) => scenarios[i].run(), select, pages: () => pages, seed, ui: { typeInto, click, waitFor, tab } };

renderCanvas();
iframe.addEventListener('load', applyTheme);
applyTheme();
