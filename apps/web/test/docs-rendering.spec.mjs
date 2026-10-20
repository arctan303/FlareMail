import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderMarkdown } from '../src/playground/markdown.js';
import { buildDocSearchIndex, highlightMatch, searchDocs } from '../src/playground/docs-search.js';
import { DOC_ITEMS } from '../src/playground/doc-catalog.js';

const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity]));
function codeOutput(source, language) {
  const html = renderMarkdown('```' + language + '\n' + source + '\n```').html;
  const code = html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1];
  const plain = decode(code.replace(/<\/?span(?: class="hl-[a-z]+")?>/g, ''));
  return { html, code, plain };
}

test('syntax highlighting preserves copied source and never reprocesses generated span markup', () => {
  const samples = {
    json: '{"true-key": "123 false \\\"quoted\\\"", "count": -12, "ok": true}',
    bash: 'curl --header "Authorization: Bearer $TOKEN" \'https://example.org/#section\'\n# node --flag "$HOME"\necho "<img src=x onerror=alert(1)>"',
    javascript: 'const url = "https://example.org/123"; // export true 123\nconst html = \'<span class="hl-cmd">git</span>\';',
    http: 'POST /mail?q=<script> HTTP/1.1\nX-Test: "A & B"\nHTTP/1.1 202 Accepted',
    text: '<script>alert("x")</script> & <img src=x onerror=alert(1)>'
  };
  for (const [language, source] of Object.entries(samples)) {
    const { html, code, plain } = codeOutput(source, language);
    assert.equal(plain, source, language + ' copy text');
    assert.equal((code.match(/<span class="hl-[a-z]+">/g) || []).length, (code.match(/<\/span>/g) || []).length, language + ' balanced spans');
    assert.doesNotMatch(html, /<script>|<img\b|class="<span/);
  }
  assert.match(codeOutput('const url = "https://example.org/123";', 'javascript').code, /hl-string/);
});

test('callouts retain paragraphs, lists, inline titles and escaped literal HTML without double escaping', () => {
  const { html } = renderMarkdown('> [!WARNING] A &amp; **B** <admin>\n> First **paragraph**.\n>\n> - item\n> - next\n\n> An ordinary quote.');
  assert.match(html, /docs-callout-warning/);
  assert.match(html, /docs-callout-title">A &amp; <strong>B<\/strong> &lt;admin&gt;<\/strong>/);
  assert.doesNotMatch(html, /&amp;amp;|<admin>/);
  assert.match(html, /<p>First <strong>paragraph<\/strong>\.<\/p>/);
  assert.match(html, /<li>item<\/li>/);
  assert.match(html, /<blockquote><p>An ordinary quote\.<\/p>/);
  const empty = renderMarkdown('> [!NOTE]').html;
  assert.match(empty, /docs-callout-title">说明<\/strong>/);
  assert.doesNotMatch(empty, /<p>\s*<\/div>/);
});

test('search targets real rendered headings at every depth and ignores code-fence heading syntax', () => {
  const source = '# One\n\nfirstword\n\n## Two\n\n~~~sh\n## fake-heading\n~~~\n\n#### Four\n\ndeepword\n\nSecond title\n============\n\nsecondword\n\n> ### Quote\n> quotedword\n\n- list\n  ##### Five\n\n###### Six\n\nsixword';
  const items = [{ slug: 'test', en: 'Sample', group: { en: 'Group' } }];
  const index = buildDocSearchIndex(items, () => source, 'en');
  const { html, headings } = renderMarkdown(source, 'en');
  assert.deepEqual(index[0].sections.slice(1).map(section => section.headingId), headings.map(heading => heading.id));
  for (const [query, title] of [['firstword', 'One'], ['fake-heading', 'Two'], ['deepword', 'Four'], ['secondword', 'Second title'], ['quotedword', 'Quote'], ['Five', 'Five'], ['sixword', 'Six']]) {
    const result = searchDocs(index, query)[0];
    const target = headings.find(heading => heading.text === title);
    assert.equal(result.headingId, target.id, query);
    assert.ok(html.includes('id="' + result.headingId + '"'));
  }
  assert.equal(searchDocs(index, 'fake-heading')[0].headingText, 'Two');
  assert.equal(headings.some(heading => heading.text === 'fake-heading'), false);
});

test('search highlights raw matches before escaping so HTML and entities remain inert and intact', () => {
  assert.equal(highlightMatch('A & B <img src=x onerror="alert(1)">', '&'), 'A <mark>&amp;</mark> B &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(highlightMatch('A & B', 'amp'), 'A &amp; B');
  assert.equal(highlightMatch('a.b [x] $1', '[x]'), 'a.b <mark>[x]</mark> $1');
  assert.equal(highlightMatch('<script>x</script>', '<script>'), '<mark>&lt;script&gt;</mark>x&lt;/script&gt;');
});

test('late exact document matches rank ahead of early body matches and bilingual real section IDs remain valid', () => {
  const items = Array.from({ length: 30 }, (_item, index) => ({ slug: String(index), en: index === 29 ? 'Needle' : 'Topic ' + index, group: { en: 'Group' } }));
  const index = buildDocSearchIndex(items, () => '# Heading\n\nneedle body', 'en');
  assert.equal(searchDocs(index, 'needle')[0].slug, '29');
  assert.equal(searchDocs(index, 'needle').length, 15);
  for (const lang of ['zh', 'en']) {
    const documents = new Map(DOC_ITEMS.map(item => [item.slug, fs.readFileSync(new URL('../docs/' + lang + '/' + item.slug + '.md', import.meta.url), 'utf8')]));
    const actual = buildDocSearchIndex(DOC_ITEMS, (_lang, slug) => documents.get(slug), lang);
    for (const document of actual) {
      const headings = renderMarkdown(documents.get(document.slug), lang).headings;
      assert.deepEqual(document.sections.slice(1).map(section => section.headingId), headings.map(heading => heading.id), lang + '/' + document.slug);
    }
  }
});
