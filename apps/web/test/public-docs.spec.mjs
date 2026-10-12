import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generatePublicDocs } from '../build/public-docs.js';
import { DOC_ITEMS } from '../src/playground/doc-catalog.js';
import { DEFAULT_PUBLIC_ORIGIN, docMetadata, previewMetadata, withMetadata, publicOrigin } from '../src/playground/seo.js';
import { renderMarkdown } from '../src/playground/markdown.js';
import { CLI_DOCS_SITE } from '../src/utils/cli-docs.js';

const shell = '<!doctype html><html lang="zh-CN"><head><meta name="description" content="old"><meta name="robots" content="noindex"><title>Old</title><script type="module" src="/assets/app.js"></script></head><body><div id="loading-first"><div>Loading</div></div><div id="app"></div></body></html>';
const readDocument = (lang, slug) => fs.readFileSync(new URL('../docs/' + lang + '/' + slug + '.md', import.meta.url), 'utf8');

test('all registered bilingual documents have readable initial HTML and one set of language-specific metadata', () => {
    const output = generatePublicDocs({shell, origin:DEFAULT_PUBLIC_ORIGIN, readDocument});
    assert.equal(output.size, DOC_ITEMS.length * 2 + 2);
    const titles = new Set();
    for (const lang of ['zh', 'en']) for (const {slug} of DOC_ITEMS) {
        const html = output.get('docs/' + lang + '/' + slug + '.html');
        const expected = docMetadata({lang, slug, rendered:renderMarkdown(readDocument(lang, slug), lang)});
        assert.ok(html.includes('<article>') && html.includes('<h1'), lang + '/' + slug);
        assert.ok(html.includes('href="' + expected.canonical + '"'), slug);
        assert.ok(html.includes('hreflang="zh-Hans"') && html.includes('hreflang="en"'));
        assert.ok(html.includes('<html lang="' + expected.htmlLang + '">'));
        assert.equal((html.match(/<title>/g) || []).length, 1);
        assert.equal((html.match(/name="description"/g) || []).length, 1);
        assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
        assert.ok(html.includes('content="index, follow"'));
        assert.ok(html.includes('property="og:image"') && html.includes('name="twitter:card"'));
        assert.ok(!html.includes('id="loading-first"'));
        assert.ok(html.includes('/assets/app.js'), 'SPA bootstrap is preserved');
        titles.add(expected.title);
    }
    assert.equal(titles.size, DOC_ITEMS.length * 2);
});

test('sitemap and robots expose documents and rendering assets, while leaving experience routes out', () => {
    const origin = 'https://docs.example.org';
    const output = generatePublicDocs({shell, origin, readDocument});
    const sitemap = output.get('sitemap.xml');
    const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]));
    assert.equal(urls.length, DOC_ITEMS.length * 2);
    assert.equal(new Set(urls.map(url => url.href)).size, urls.length);
    assert.ok(urls.every(url => url.origin === origin && /^\/docs\/(zh|en)\//.test(url.pathname) && !url.search && !url.hash));
    assert.ok(!sitemap.includes('/inbox') && !sitemap.includes('?instance=') && !sitemap.includes('pages.dev'));
    assert.match(output.get('robots.txt'), /Allow: \/docs\//);
    assert.match(output.get('robots.txt'), /Allow: \/assets\//);
    assert.match(output.get('robots.txt'), /Disallow: \/\n/);
    assert.ok(output.get('robots.txt').includes('Sitemap: ' + origin + '/sitemap.xml'));
    assert.ok(output.get('docs/en/cli.html').includes('property="og:url" content="' + origin + '/docs/en/cli"'));
    assert.equal(DEFAULT_PUBLIC_ORIGIN, CLI_DOCS_SITE);
});

test('leaving docs removes canonical and language alternatives and restores noindex metadata', () => {
    const document = docMetadata({lang:'zh', slug:'usage', rendered:renderMarkdown(readDocument('zh','usage'))});
    const publicShell = withMetadata(shell, document);
    const inboxShell = withMetadata(publicShell, previewMetadata('en'));
    assert.ok(!inboxShell.includes('rel="canonical"') && !inboxShell.includes('hreflang='));
    assert.ok(inboxShell.includes('content="noindex, follow"'));
    assert.ok(inboxShell.includes('<html lang="en">'));
    assert.equal((inboxShell.match(/<title>/g) || []).length, 1);
    assert.equal((inboxShell.match(/name="description"/g) || []).length, 1);
});

test('metadata escapes document text and preserves literal replacement strings in the article', () => {
    const read = () => '# A & B "title"\n\nA **personal** mailbox, with $& and <script>do-not-run</script>.\n';
    const output = generatePublicDocs({shell, origin:DEFAULT_PUBLIC_ORIGIN, readDocument:read});
    const html = output.get('docs/en/usage.html');
    assert.ok(html.includes('<title>A &amp; B &quot;title&quot; · FlareMail Docs</title>'));
    assert.ok(html.includes('with $&amp; and &lt;script&gt;do-not-run&lt;/script&gt;'));
    assert.equal((html.match(/<script\b/g) || []).length, 1, 'only the original module script remains');
    assert.ok(!html.includes('content="A personal mailbox, with $& and <script>'));
});

test('invalid public origins or incomplete documents fail instead of generating incorrect canonical URLs', () => {
    assert.equal(publicOrigin('https://docs.example.org/'), 'https://docs.example.org');
    for (const value of ['http://docs.example.org', 'https://u:p@docs.example.org', 'https://docs.example.org/docs', 'https://docs.example.org/?instance=secret', 'https://docs.example.org/#hash', 'javascript:alert(1)']) assert.throws(() => publicOrigin(value));
    assert.throws(() => generatePublicDocs({shell, origin:DEFAULT_PUBLIC_ORIGIN, readDocument:() => '# Empty'}), /introduction/);
    assert.throws(() => docMetadata({lang:'fr', slug:'usage', rendered:renderMarkdown('# T\n\nP')}), /route/);
});
