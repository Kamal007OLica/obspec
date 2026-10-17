import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNoteContent, safeFileName, joinVaultPath, snapshotToMarkdown, toSpecMarkdown } from '../src/shared/notegen';
import { parseFrontmatter } from '../bridge/src/markdown';
import type { DesignSnapshot, Note } from '../src/shared/protocol';

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

test('design section uses only Spec-compatible blocks (no tables) and the rows the site promises', () => {
  const md = snapshotToMarkdown(snap);
  assert.doesNotMatch(md, /\|/);
  for (const row of ['Node', 'Size', 'Fill', 'Label', 'Link']) assert.match(md, new RegExp(`^- \\*\\*${row}:\\*\\* `, 'm'));
  assert.match(md, /\*\*Fill:\*\* `#6E56CF`/); // never a bare #hex — Obsidian would read it as a tag
  assert.match(md, /\*\*Label:\*\* Continue/);
  assert.match(md, /\*\*Link:\*\* https:\/\/www\.figma\.com\/design\/KEY\?node-id=2-2/);
});

test('toSpecMarkdown yields a Spec-ready file: H1, source quote, resolved wikilinks, no embeds', () => {
  const note: Note = { path: 'Specs/Payment Methods.md', title: 'Payment Methods', folder: 'Specs', frontmatter: {}, content: '', tags: ['checkout'],
    body: '# Payment Methods\n\nSee [[Checkout Redesign|the redesign]] and [[Button]].\n![[shot.png]]\n==Never== say invalid.\n', outlinks: [], backlinks: [], mtime: 0, hash: 'x', words: 9 };
  const md = toSpecMarkdown(note, 'My Vault');
  assert.match(md, /^# Payment Methods\n\n> From Obsidian · Specs\/Payment Methods\.md · #checkout · \[Open in Obsidian\]\(obsidian:\/\/open\?vault=My%20Vault&file=Specs%2FPayment%20Methods\)/);
  assert.equal((md.match(/# Payment Methods/g) ?? []).length, 1);
  assert.match(md, /See the redesign and Button\./);
  assert.match(md, /\(image: shot\.png\)/);
  assert.match(md, /\*\*Never\*\* say invalid/);
  assert.doesNotMatch(md, /\[\[/);
});

test('file names are vault-safe', () => {
  assert.equal(safeFileName('Button / Primary: v2?'), 'Button Primary v2');
  assert.equal(safeFileName('   '), 'Untitled layer');
  assert.equal(joinVaultPath('Figma/', 'x.md'), 'Figma/x.md');
  assert.equal(joinVaultPath('', 'x.md'), 'x.md');
});
