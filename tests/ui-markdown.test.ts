import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inline, renderMarkdown } from '../src/ui/markdown';

const resolveImage = (t: string) => `http://localhost:27123/file?path=${encodeURIComponent(t)}`;

test('image embeds become <img> and survive the autolink pass', () => {
  const html = inline('Look ![[Pasted image 1.png|300]] and https://example.com', { resolveImage });
  assert.match(html, /<img class="embed" src="http:\/\/localhost:27123\/file\?path=Pasted%20image%201\.png" alt="Pasted image 1\.png" loading="lazy" width="300">/);
  assert.match(html, /<a href="https:\/\/example\.com"/);
  assert.doesNotMatch(html, /src="<a/);
});

test('unresolvable embeds fall back to a caption; code spans are untouched', () => {
  const html = inline('![[missing.png]] and `**not bold**`');
  assert.match(html, /🖼 missing\.png/);
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
});

test('block rendering keeps an image-only line as a paragraph with the image', () => {
  const html = renderMarkdown('# T\n\n![[a.png]]\n\n- item', { resolveImage });
  assert.match(html, /<p><img class="embed" src="[^"]+a\.png"/);
  assert.match(html, /<li>item<\/li>/);
});
