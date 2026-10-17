/// <reference types="@figma/plugin-typings" />
/**
 * Obspec — Figma sandbox entry. Owns everything that touches the document:
 * selection, plugin data (note links), spec-card creation and design snapshots.
 * The UI (ui.ts) owns everything that touches the network.
 */
import { DEFAULT_SETTINGS, FILE_KEY, LINK_KEY, type LinkedNodeSummary, type Note, type NoteLinkRecord, type PluginToUi, type SelectionSummary, type Settings, type UiToPlugin } from '../shared/protocol';
import { buildSpecCard, setCardStatus, updateSpecCard } from './speccard';
import { designHashOf, snapshotNode } from './snapshot';

const UI_SIZE = { width: 500, height: 780 };
const UI_MIN = { width: 360, height: 480 };
const UI_MAX = { width: 1400, height: 1600 };
const clampSize = (w: number, h: number) => ({ width: Math.round(Math.min(UI_MAX.width, Math.max(UI_MIN.width, w))), height: Math.round(Math.min(UI_MAX.height, Math.max(UI_MIN.height, h))) });
const SETTINGS_KEY = 'obspec:settings:v1';

figma.showUI(__html__, { ...UI_SIZE, themeColors: true, title: 'Obspec' });

const post = (msg: PluginToUi) => figma.ui.postMessage(msg);

// ───────────────────────────── Settings ───────────────────────────────────
async function loadSettings(): Promise<Settings> {
  const saved = (await figma.clientStorage.getAsync(SETTINGS_KEY)) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

// ───────────────────────────── Links ──────────────────────────────────────
function readLink(node: BaseNode): NoteLinkRecord | undefined {
  const raw = node.getPluginData(LINK_KEY);
  if (!raw) return undefined;
  try { const l = JSON.parse(raw) as NoteLinkRecord; return l && l.v === 1 ? l : undefined; } catch { return undefined; }
}

function writeLink(node: BaseNode, link: NoteLinkRecord | null): void {
  if (!link) {
    node.setPluginData(LINK_KEY, '');
    if ('setRelaunchData' in node) (node as SceneNode).setRelaunchData({});
    return;
  }
  node.setPluginData(LINK_KEY, JSON.stringify(link));
  if ('setRelaunchData' in node) (node as SceneNode).setRelaunchData({ open: link.path, pull: 'Refresh from the linked note' });
}

function fileKey(): string | undefined {
  return figma.fileKey ?? figma.root.getPluginData(FILE_KEY) ?? undefined;
}

async function selectionSummary(): Promise<SelectionSummary> {
  const sel = figma.currentPage.selection;
  if (sel.length === 0) return { count: 0 };
  const n = sel[0];
  const link = readLink(n);
  return {
    count: sel.length,
    node: {
      id: n.id, name: n.name, type: n.type, pageName: figma.currentPage.name,
      width: 'width' in n ? Math.round(n.width) : undefined,
      height: 'height' in n ? Math.round(n.height) : undefined,
      link, designHash: designHashOf(n),
    },
  };
}

async function linkedNodes(): Promise<LinkedNodeSummary[]> {
  await figma.loadAllPagesAsync();
  const out: LinkedNodeSummary[] = [];
  for (const page of figma.root.children) {
    const nodes = page.findAllWithCriteria({ pluginData: { keys: [LINK_KEY] } });
    for (const n of nodes) {
      const link = readLink(n);
      if (!link) continue;
      out.push({ nodeId: n.id, nodeName: n.name, nodeType: n.type, pageId: page.id, pageName: page.name, link, designHash: designHashOf(n) });
    }
  }
  out.sort((a, b) => b.link.syncedAt - a.link.syncedAt);
  return out;
}

async function pushSelection() { post({ type: 'selection', selection: await selectionSummary() }); }
async function pushLinked() { post({ type: 'linked', nodes: await linkedNodes() }); }

figma.on('selectionchange', () => void pushSelection());
// dynamic-page files: documentchange can only be registered once every page is loaded.
void figma.loadAllPagesAsync().then(() => {
  figma.on('documentchange', (ev) => {
    // Only re-list links when plugin data or node tree changed — keeps big files snappy.
    if (ev.documentChanges.some((c) => c.type === 'DELETE' || c.type === 'CREATE' || (c.type === 'PROPERTY_CHANGE' && c.properties.includes('pluginData')))) void pushLinked();
  });
}).catch((err) => console.warn('[obspec] documentchange unavailable:', err));

// ───────────────────────────── Drag & drop from the UI ────────────────────
// The UI posts a `pluginDrop` message when a result is released over the canvas; Figma turns
// that into this event with canvas coordinates and the node under the cursor.
figma.on('drop', (event) => {
  const meta = (event.dropMetadata ?? {}) as { path?: string };
  if (!meta.path) return false;
  const n = event.node;
  const canHold = n && n.type !== 'PAGE' && n.type !== 'DOCUMENT' && (n.type === 'FRAME' || n.type === 'SECTION' || n.type === 'GROUP' || n.type === 'COMPONENT') && !('locked' in n && n.locked);
  post({ type: 'drop', path: meta.path, x: event.absoluteX, y: event.absoluteY, parentId: canHold ? n.id : undefined });
  return false;
});

/** Put a freshly built card at an absolute canvas point, inside `parentId` when it can hold children. */
async function placeAt(card: FrameNode, at: { x: number; y: number }, parentId?: string): Promise<void> {
  const parent = parentId ? await figma.getNodeByIdAsync(parentId) : null;
  if (parent && !parent.removed && 'appendChild' in parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT' && parent.type !== 'INSTANCE') {
    const p = parent as FrameNode;
    p.appendChild(card);
    if (!('layoutMode' in p) || p.layoutMode === 'NONE') {
      const t = p.absoluteTransform;
      card.x = Math.round(at.x - t[0][2]);
      card.y = Math.round(at.y - t[1][2]);
    }
    return;
  }
  card.x = Math.round(at.x);
  card.y = Math.round(at.y);
}

// ───────────────────────────── Message loop ───────────────────────────────
figma.ui.onmessage = async (msg: UiToPlugin) => {
  try {
    switch (msg.type) {
      case 'ui-ready': {
        const s = await loadSettings();
        if (s.windowWidth && s.windowHeight) { const sz = clampSize(s.windowWidth, s.windowHeight); figma.ui.resize(sz.width, sz.height); }
        post({ type: 'init', settings: s, fileKey: fileKey(), fileName: figma.root.name, editorType: figma.editorType, command: figma.command || undefined });
        await pushSelection();
        await pushLinked();
        return;
      }
      case 'get-settings': return post({ type: 'settings', settings: await loadSettings() });
      case 'save-settings': {
        await figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings);
        return post({ type: 'settings', settings: msg.settings });
      }
      case 'get-selection': return pushSelection();
      case 'get-linked': return pushLinked();

      case 'insert-spec-card': {
        const card = await buildSpecCard(msg.note, { vaultName: msg.vaultName, width: msg.width, images: msg.images });
        if (msg.at) await placeAt(card, msg.at, msg.parentId);
        writeLink(card, { v: 1, path: msg.note.path, noteHash: msg.note.hash, noteMtime: msg.note.mtime, kind: 'spec-card', linkedAt: Date.now(), syncedAt: Date.now() });
        figma.currentPage.selection = [card];
        figma.viewport.scrollAndZoomIntoView([card]);
        figma.notify(`Inserted “${msg.note.title}”`);
        post({ type: 'spec-card-inserted', nodeId: card.id });
        return pushLinked();
      }
      case 'link-selection': {
        const sel = figma.currentPage.selection;
        if (sel.length !== 1) throw new Error('Select exactly one layer to link');
        const n = sel[0];
        const kind = readLink(n)?.kind === 'spec-card' || n.name.startsWith('Spec · ') ? 'spec-card' : 'linked';
        writeLink(n, { v: 1, path: msg.note.path, noteHash: msg.note.hash, noteMtime: msg.note.mtime, designHash: designHashOf(n), kind, linkedAt: Date.now(), syncedAt: Date.now() });
        figma.notify(`Linked “${n.name}” → ${msg.note.title}`);
        post({ type: 'linked-ok', nodeId: n.id });
        await pushSelection();
        return pushLinked();
      }
      case 'unlink': {
        const n = await figma.getNodeByIdAsync(msg.nodeId);
        if (n) { writeLink(n, null); figma.notify('Unlinked'); }
        await pushSelection();
        return pushLinked();
      }
      case 'pull': {
        const n = await figma.getNodeByIdAsync(msg.nodeId);
        if (!n || n.removed) throw new Error('Layer no longer exists');
        const link = readLink(n);
        if (!link) throw new Error('Layer is not linked');
        if (link.kind === 'spec-card' && n.type === 'FRAME') await updateSpecCard(n, msg.note, { vaultName: msg.vaultName, images: msg.images });
        writeLink(n, { ...link, noteHash: msg.note.hash, noteMtime: msg.note.mtime, designHash: designHashOf(n as SceneNode), syncedAt: Date.now() });
        figma.notify(`Pulled “${msg.note.title}”`);
        post({ type: 'pulled', nodeId: n.id });
        await pushSelection();
        return pushLinked();
      }
      case 'card-status': {
        const n = await figma.getNodeByIdAsync(msg.nodeId);
        if (n && !n.removed && n.type === 'FRAME') await setCardStatus(n, msg.status);
        return;
      }
      case 'snapshot': {
        const n = await figma.getNodeByIdAsync(msg.nodeId);
        if (!n || n.removed) throw new Error('Layer no longer exists');
        return post({ type: 'snapshot', snapshot: snapshotNode(n as SceneNode, fileKey()) });
      }
      case 'mark-pushed': {
        const n = await figma.getNodeByIdAsync(msg.nodeId);
        if (!n) throw new Error('Layer no longer exists');
        const prev = readLink(n);
        writeLink(n, { v: 1, kind: prev?.kind ?? 'linked', linkedAt: prev?.linkedAt ?? Date.now(), path: msg.path, noteHash: msg.note.hash, noteMtime: msg.note.mtime, designHash: msg.designHash, syncedAt: Date.now() });
        figma.notify(`Sent “${n.name}” to Obsidian`);
        await pushSelection();
        return pushLinked();
      }
      case 'select-node': {
        const n = await figma.getNodeByIdAsync(msg.nodeId);
        if (!n || n.removed) throw new Error('Layer no longer exists');
        if (msg.pageId && figma.currentPage.id !== msg.pageId) {
          const page = await figma.getNodeByIdAsync(msg.pageId);
          if (page && page.type === 'PAGE') await figma.setCurrentPageAsync(page);
        }
        figma.currentPage.selection = [n as SceneNode];
        figma.viewport.scrollAndZoomIntoView([n as SceneNode]);
        return;
      }
      case 'open-url': return figma.openExternal(msg.url);
      case 'notify': return void figma.notify(msg.message, { error: msg.error });
      case 'resize': {
        const sz = clampSize(msg.width, msg.height);
        figma.ui.resize(sz.width, sz.height);
        if (msg.persist) { const s = await loadSettings(); await figma.clientStorage.setAsync(SETTINGS_KEY, { ...s, windowWidth: sz.width, windowHeight: sz.height }); }
        return;
      }
      case 'close': return figma.closePlugin();
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
