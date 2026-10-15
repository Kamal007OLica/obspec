/// <reference types="@figma/plugin-typings" />
/**
 * Turns a design node into a plain, diff-friendly description that can live in
 * a markdown note. The same fingerprint feeds sync-state detection.
 */
import { figmaNodeUrl, fnv1a, type DesignSnapshot } from '../shared/protocol';

const MAX_TEXTS = 40;
const MAX_CHILDREN = 30;

export function snapshotNode(node: SceneNode, fileKey?: string): DesignSnapshot {
  const properties = collectProperties(node);
  const texts = collectTexts(node);
  const children = 'children' in node ? node.children.slice(0, MAX_CHILDREN).map((c) => c.name) : [];
  const component = componentInfo(node);
  const page = pageOf(node);
  const core = { name: node.name, type: node.type, width: round('width' in node ? node.width : 0), height: round('height' in node ? node.height : 0), properties, texts, children, component };
  return {
    nodeId: node.id, page, ...core,
    url: figmaNodeUrl(fileKey, node.id),
    capturedAt: Date.now(),
    hash: fnv1a(JSON.stringify(core)),
  };
}

/** Cheap fingerprint used for drift detection; identical to snapshot.hash. */
export function designHashOf(node: SceneNode): string {
  return snapshotNode(node).hash;
}

function collectProperties(node: SceneNode): Array<[string, string]> {
  const p: Array<[string, string]> = [];
  p.push(['Type', pretty(node.type)]);
  if ('width' in node) p.push(['Size', `${round(node.width)} × ${round(node.height)}`]);
  if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    p.push(['Auto layout', node.layoutMode === 'HORIZONTAL' ? 'Horizontal' : 'Vertical']);
    p.push(['Padding', `${round(node.paddingTop)} ${round(node.paddingRight)} ${round(node.paddingBottom)} ${round(node.paddingLeft)}`]);
    p.push(['Gap', String(round(node.itemSpacing))]);
  }
  if ('fills' in node && Array.isArray(node.fills)) {
    const solid = (node.fills as Paint[]).filter((f): f is SolidPaint => f.type === 'SOLID' && f.visible !== false);
    if (solid.length) p.push(['Fill', solid.map((f) => hex(f.color, f.opacity)).join(', ')]);
  }
  if ('strokes' in node && Array.isArray(node.strokes)) {
    const solid = (node.strokes as Paint[]).filter((f): f is SolidPaint => f.type === 'SOLID' && f.visible !== false);
    if (solid.length) p.push(['Stroke', `${solid.map((f) => hex(f.color, f.opacity)).join(', ')} · ${typeof node.strokeWeight === 'number' ? round(node.strokeWeight) : 'mixed'}px`]);
  }
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) p.push(['Radius', String(round(node.cornerRadius))]);
  if ('opacity' in node && node.opacity !== 1) p.push(['Opacity', `${Math.round(node.opacity * 100)}%`]);
  if (node.type === 'TEXT') {
    const fn = node.fontName;
    if (fn !== figma.mixed) p.push(['Font', `${fn.family} ${fn.style}`]);
    if (node.fontSize !== figma.mixed) p.push(['Font size', String(round(node.fontSize))]);
  }
  if ('effects' in node && node.effects.length) p.push(['Effects', node.effects.filter((e) => e.visible !== false).map((e) => pretty(e.type)).join(', ')]);
  return p;
}

function collectTexts(node: SceneNode): string[] {
  if (node.type === 'TEXT') return [node.characters];
  if (!('findAllWithCriteria' in node)) return [];
  return node.findAllWithCriteria({ types: ['TEXT'] }).slice(0, MAX_TEXTS).map((t) => t.characters.trim()).filter(Boolean);
}

function componentInfo(node: SceneNode): DesignSnapshot['component'] {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return { name: node.name, key: node.key };
  if (node.type === 'INSTANCE') {
    const props: Record<string, string> = {};
    try {
      for (const [k, v] of Object.entries(node.componentProperties)) props[k.replace(/#.*$/, '')] = String(v.value);
    } catch { /* instances of remote components can throw on access */ }
    return { name: node.name, variantProps: props };
  }
  return undefined;
}

function pageOf(node: BaseNode): string {
  let n: BaseNode | null = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return n?.name ?? '';
}

function hex(c: RGB, opacity = 1): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(c.r)}${h(c.g)}${h(c.b)}` + (opacity < 1 ? ` ${Math.round(opacity * 100)}%` : '');
}

function round(n: number): number { return Math.round(n * 100) / 100; }
function pretty(s: string): string { return s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()); }
