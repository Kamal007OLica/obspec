import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNoteContent, safeFileName, joinVaultPath, snapshotToMarkdown } from '../src/shared/notegen';
import { parseFrontmatter } from '../bridge/src/markdown';
import type { DesignSnapshot } from '../src/shared/protocol';

const snap: DesignSnapshot = { nodeId: '2:2', name: 'Button / Primary', type: 'COMPONENT', page: 'Components', width: 160, height: 36, properties: [['Type', 'Component'], ['Fill', '#6E56CF']], texts: ['Continue'], children: ['Label'], component: { name: 'Button / Primary' }, url: 'https://www.figma.com/design/KEY?node-id=2-2', capturedAt: 0, hash: 'abc' };

test('new note has parseable frontmatter and both sections', () => {
  const content = newNoteContent(snap, 'My File');
  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.type, 'figma-spec');
  assert.equal(frontmatter.figma_node, '2:2');
  assert.deepEqual(frontmatter.tags, ['figma']);
  assert.match(body, /^# Button \/ Primary/);
  assert.match(body, /## Design/);
  assert.match(body, /## Notes/);
});

test('markdown table escapes pipes and lists copy', () => {
  const md = snapshotToMarkdown({ ...snap, properties: [['Fill', 'a|b']] });
  assert.match(md, /\| Fill \| a\\\|b \|/);
  assert.match(md, /- Continue/);
});

test('file names are vault-safe', () => {
  assert.equal(safeFileName('Button / Primary: v2?'), 'Button Primary v2');
  assert.equal(safeFileName('   '), 'Untitled layer');
  assert.equal(joinVaultPath('Figma/', 'x.md'), 'Figma/x.md');
  assert.equal(joinVaultPath('', 'x.md'), 'x.md');
});
