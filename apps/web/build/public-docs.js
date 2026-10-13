import fs from 'node:fs';
import path from 'node:path';
import { DOC_GROUPS, DOC_ITEMS } from '../src/playground/doc-catalog.js';
import { renderMarkdown } from '../src/playground/markdown.js';
import { DOC_LANGUAGES, docMetadata, escapeHtml, publicOrigin, previewMetadata, withMetadata } from '../src/playground/seo.js';

const fallbackStyle = `<style data-public-doc-fallback>
.public-doc-fallback{box-sizing:border-box;height:100dvh;overflow-y:auto;max-width:850px;margin:0 auto;padding:32px 24px 64px;font:16px/1.75 system-ui,sans-serif;color:var(--el-text-color-primary,#1f2937)}
.public-doc-fallback nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px}.public-doc-fallback a{color:#2563eb;text-underline-offset:3px}
.public-doc-fallback h1{font-size:2rem;line-height:1.3}.public-doc-fallback h2{margin-top:2rem}.public-doc-fallback pre{overflow:auto;padding:16px;background:var(--el-fill-color-light,#f3f4f6);border-radius:8px}
.public-doc-fallback table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.public-doc-fallback td,.public-doc-fallback th{padding:8px;border:1px solid #d1d5db}
.public-doc-fallback code{overflow-wrap:anywhere}.public-doc-fallback [data-copy-code]{display:none}.public-doc-fallback footer{margin-top:48px;border-top:1px solid #d1d5db;padding-top:20px}
</style>`;

export function generatePublicDocs({shell, origin, readDocument}) {
    origin = publicOrigin(origin);
    const output = new Map();
    const metadataList = [];
    for (const lang of DOC_LANGUAGES) {
        for (const item of DOC_ITEMS) {
            const rendered = renderMarkdown(readDocument(lang, item.slug), lang);
            const metadata = docMetadata({lang, slug:item.slug, rendered, origin});
            metadataList.push(metadata);
            const other = lang === 'en' ? 'zh' : 'en';
            const navigation = DOC_GROUPS.map(group => '<section><h2>' + escapeHtml(group[lang]) + '</h2><nav>' + group.items.map(doc => '<a href="/docs/' + lang + '/' + doc.slug + '">' + escapeHtml(doc[lang]) + '</a>').join('') + '</nav></section>').join('');
            const fallback = '<main class="public-doc-fallback"><nav><a href="/inbox">' + (lang === 'en' ? 'Try FlareMail' : '在线体验') + '</a><a href="/docs/' + other + '/' + item.slug + '" lang="' + (other === 'en' ? 'en' : 'zh-CN') + '">' + (other === 'en' ? 'English' : '简体中文') + '</a></nav><article>' + rendered.html + '</article><footer>' + navigation + '</footer></main>';
            let html = withMetadata(shell, metadata).replace('</head>', () => fallbackStyle + '\n</head>');
            html = html.replace(/<div id="loading-first"[\s\S]*?(?=<div id="app")/, '');
            if (!html.includes('<div id="app"></div>')) throw new Error('Public document shell is missing the app mount');
            html = html.replace('<div id="app"></div>', () => '<div id="app">' + fallback + '</div>');
            // Pages serves /name.html at the existing /name route without adding a trailing slash.
            output.set('docs/' + lang + '/' + item.slug + '.html', html);
        }
    }
    const sitemap = metadataList.map(metadata => '<url><loc>' + escapeHtml(metadata.canonical) + '</loc>' + metadata.alternates.map(alternate => '<xhtml:link rel="alternate" hreflang="' + alternate.lang + '" href="' + escapeHtml(alternate.url) + '"/>').join('') + '</url>').join('\n');
    output.set('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + sitemap + '\n</urlset>\n');
    output.set('robots.txt', 'User-agent: *\nAllow: /docs/\nAllow: /assets/\nAllow: /mail-pwa-512.png\nAllow: /sitemap.xml\nDisallow: /\n\nSitemap: ' + origin + '/sitemap.xml\n');
    return output;
}

export function publicDocsPlugin({origin}) {
    return {
        name: 'public-docs',
        transformIndexHtml: {order:'post', handler:html => withMetadata(html, previewMetadata('en', origin))},
        writeBundle(options, bundle) {
            const shell = bundle['index.html'];
            if (!options.dir || shell?.type !== 'asset' || typeof shell.source !== 'string') throw new Error('Public document build requires the generated index.html');
            const output = generatePublicDocs({shell:shell.source, origin, readDocument:(lang, slug) => fs.readFileSync(new URL('../docs/' + lang + '/' + slug + '.md', import.meta.url), 'utf8')});
            for (const [fileName, content] of output) {
                const destination = path.join(options.dir, fileName);
                fs.mkdirSync(path.dirname(destination), {recursive:true});
                fs.writeFileSync(destination, content);
            }
        },
    };
}
