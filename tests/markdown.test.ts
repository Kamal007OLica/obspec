import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, stringifyFrontmatter, withFrontmatter, extractTags, extractWikilinks, replaceSection } from '../bridge/src/markdown';

test('frontmatter: scalars, inline arrays, block lists, nested maps round-trip', () => {
  const raw = `---\ntitle: "Hello: world"\ntags: [a, b]\nstatus: draft\ncount: 3\nlist:\n  - one\n  - two\nmeta:\n  owner: Mei\n  ok: true\n---\n# Body\n`;
  const { frontmatter, body } = parseFrontmatter(raw);
  assert.equal(frontmatter.title, 'Hello: world');
  assert.deepEqual(frontmatter.tags, ['a', 'b']);
  assert.equal(frontmatter.count, 3);
  assert.deepEqual(frontmatter.list, ['one', 'two']);
  assert.deepEqual(frontmatter.meta, { owner: 'Mei', ok: true });
  assert.equal(body, '# Body\n');
  const again = parseFrontmatter(stringifyFrontmatter(frontmatter));
  assert.deepEqual(again.frontmatter, frontmatter);
});

test('withFrontmatter replaces or adds the block', () => {
  assert.equal(withFrontmatter('# Hi\n', { a: 1 }), '---\na: 1\n---\n# Hi\n');
  assert.equal(withFrontmatter('---\na: 1\n---\n# Hi\n', { b: 'x' }), '---\nb: x\n---\n# Hi\n');
});

test('tags come from frontmatter and body, not code', () => {
  const tags = extractTags('Hello #design and #design/system\n`#notatag`\n```\n#also-not\n```', { tags: ['spec', '#checkout'] });
  assert.deepEqual(tags, ['checkout', 'design', 'design/system', 'spec']);
});

test('wikilinks ignore aliases and anchors', () => {
  assert.deepEqual(extractWikilinks('See [[Button|the button]] and [[Tokens#Colors]] and [[Button]]'), ['Button', 'Tokens']);
});

test('replaceSection replaces an existing H2 block and appends when missing', () => {
  const body = '# T\n\nintro\n\n## Design\n\nold\n\n## Notes\n\nkeep\n';
  const out = replaceSection(body, 'Design', 'new');
  assert.match(out, /## Design\n\nnew\n/);
  assert.doesNotMatch(out, /old/);
  assert.match(out, /## Notes\n\nkeep/);
  const appended = replaceSection('# T\n\nintro\n', 'Design', 'x');
  assert.equal(appended, '# T\n\nintro\n\n## Design\n\nx\n');
});
