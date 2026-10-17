import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageTargets, isImageName, computeSyncState, cardStatusOf, obsidianSearchUrl, obsidianUrl, fnv1a, PLUGIN_VERSION } from '../src/shared/protocol';
import { makeSnippets } from '../bridge/src/search';

test('imageTargets finds wiki and markdown embeds, skips remote and non-images, dedupes', () => {
  const body = '![[shot.png|300]] text ![alt](diagrams/flow.svg) ![[shot.png]] ![x](https://cdn/x.png) [[Note]] ![[doc.pdf]]';
  assert.deepEqual(imageTargets(body), ['shot.png', 'diagrams/flow.svg']);
  assert.equal(isImageName('a.JPEG'), true);
  assert.equal(isImageName('a.md'), false);
});

test('sync state covers every combination', () => {
  const link = { v: 1 as const, path: 'a.md', noteHash: 'n1', noteMtime: 0, designHash: 'd1', kind: 'linked' as const, linkedAt: 0, syncedAt: 0 };
  assert.equal(computeSyncState(link, 'n1', 'd1'), 'in-sync');
  assert.equal(computeSyncState(link, 'n2', 'd1'), 'note-changed');
  assert.equal(computeSyncState(link, 'n1', 'd2'), 'design-changed');
  assert.equal(computeSyncState(link, 'n2', 'd2'), 'both-changed');
  assert.equal(computeSyncState(link, null, 'd1'), 'missing');
  assert.equal(computeSyncState(link, undefined, 'd1'), 'unknown');
  assert.equal(computeSyncState(undefined, 'n1', 'd1'), 'unknown');
  assert.equal(cardStatusOf('design-changed'), 'in-sync');
  assert.equal(cardStatusOf('both-changed'), 'note-changed');
  assert.equal(cardStatusOf('unknown'), undefined);
});

test('obsidian deep links encode vault and file, drop .md', () => {
  assert.equal(obsidianUrl("Mei's Second Brain", 'Figma/Button Primary.md'), "obsidian://open?vault=Mei's%20Second%20Brain&file=Figma%2FButton%20Primary");
  assert.equal(obsidianSearchUrl('V', 'apple pay tag:spec'), 'obsidian://search?vault=V&query=apple%20pay%20tag%3Aspec');
});

test('fnv1a is stable and version is semver', () => {
  assert.equal(fnv1a('obspec'), fnv1a('obspec'));
  assert.notEqual(fnv1a('a'), fnv1a('b'));
  assert.match(PLUGIN_VERSION, /^\d+\.\d+\.\d+$/);
});

test('snippets strip markdown noise: wikilinks, embeds, bold, highlights', () => {
  const body = '# T\n- **November** — Onboarding v3, [[Empty States|empty]] audit ![[pic.png]] ==now==';
  const [s] = makeSnippets(body, body.toLowerCase(), ['audit']);
  assert.equal(s.text, 'November — Onboarding v3, empty audit pic.png now');
  assert.equal(s.text.slice(s.ranges[0][0], s.ranges[0][1]), 'audit');
});
