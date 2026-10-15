import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, search, makeSnippets } from '../bridge/src/search';
import type { IndexedNote } from '../bridge/src/vault';
import { fnv1a } from '../src/shared/protocol';

function note(path: string, body: string, tags: string[] = []): IndexedNote {
  const title = path.split('/').pop()!.replace(/\.md$/, '');
  return { path, title, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', frontmatter: {}, content: body, body,
    bodyLower: body.toLowerCase(), titleLower: title.toLowerCase(), pathLower: path.toLowerCase(), tags, outlinks: [], mtime: Date.now(), hash: fnv1a(body), words: body.split(/\s+/).length };
}
const notes = [
  note('Product/Specs/Checkout Redesign.md', '# Checkout\nApple Pay first. Cut abandonment.\nSee [[Payment Methods]]', ['spec', 'checkout']),
  note('Product/Specs/Payment Methods.md', 'Apple Pay on iOS, Google Pay on Android.', ['spec', 'payments']),
  note('Design/System/Button.md', 'Primary, secondary, ghost, danger.', ['component']),
  note('Research/Interviews.md', 'Payment trust: want Apple Pay. Checkout friction.', ['research']),
];

test('parseQuery splits terms, phrases, filters', () => {
  const q = parseQuery('apple "google pay" tag:spec path:Product -danger #payments');
  assert.deepEqual(q.terms, ['apple']);
  assert.deepEqual(q.phrases, ['google pay']);
  assert.deepEqual(q.tags, ['spec', 'payments']);
  assert.deepEqual(q.paths, ['product']);
  assert.deepEqual(q.excludes, ['danger']);
});

test('title matches rank above body matches', () => {
  const { results } = search(notes, 'payment');
  assert.equal(results[0].title, 'Payment Methods');
  assert.ok(results[0].matchedIn.includes('title'));
});

test('all terms must match; filters narrow', () => {
  assert.equal(search(notes, 'apple checkout').results.length, 2);
  assert.equal(search(notes, 'apple tag:research').results.length, 1);
  assert.equal(search(notes, 'apple path:System').results.length, 0);
  assert.equal(search(notes, 'apple -ios').results.map((r) => r.title).includes('Payment Methods'), false);
  assert.equal(search(notes, 'tag:spec').total, 2);
});

test('phrase must appear verbatim', () => {
  assert.equal(search(notes, '"google pay"').results.length, 1);
  assert.equal(search(notes, '"pay google"').results.length, 0);
});

test('empty query returns nothing', () => {
  assert.deepEqual(search(notes, '   ').results, []);
});

test('snippets carry correct highlight ranges on cleaned lines', () => {
  const body = '# Heading\n- [ ] Enable Apple Pay before cards\nUnrelated line';
  const [s] = makeSnippets(body, body.toLowerCase(), ['apple pay']);
  assert.equal(s.line, 2);
  assert.equal(s.text, 'Enable Apple Pay before cards');
  assert.deepEqual(s.ranges, [[7, 16]]);
  assert.equal(s.text.slice(7, 16), 'Apple Pay');
});

test('long lines are clipped around the first hit and ranges shift', () => {
  const long = 'x'.repeat(300) + ' needle ' + 'y'.repeat(300);
  const [s] = makeSnippets(long, long.toLowerCase(), ['needle']);
  assert.ok(s.text.length <= 152);
  const [a, b] = s.ranges[0];
  assert.equal(s.text.slice(a, b), 'needle');
});
