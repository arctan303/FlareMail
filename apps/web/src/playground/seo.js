export const DEFAULT_PUBLIC_ORIGIN = 'https://flaremail.arcinks.com';
export const DOC_LANGUAGES = ['zh', 'en'];
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function publicOrigin(value = DEFAULT_PUBLIC_ORIGIN) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('VITE_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or fragment.');
    }
    return url.origin;
}

export function htmlText(html) {
    return String(html).replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|#39|#x27|#96);/g, (_, entity) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",'#x27':"'",'#96':'`'}[entity])).replace(/\s+/g, ' ').trim();
}

export function previewMetadata(lang = 'en', origin = DEFAULT_PUBLIC_ORIGIN) {
    origin = publicOrigin(origin);
    return {
        title: 'FlareMail',
        description: lang === 'zh' ? '无需 VPS 的个人域名邮箱，部署在自己的 Cloudflare 账号，支持 CLI 与助手接入。' : 'Personal domain email in your Cloudflare account. No VPS required, with CLI and agent access.',
        lang, htmlLang: lang === 'zh' ? 'zh-CN' : 'en',
        robots: 'noindex, follow', url: origin + '/inbox', origin, alternates: [],
    };
}

export function docMetadata({lang, slug, rendered, origin = DEFAULT_PUBLIC_ORIGIN}) {
    if (!DOC_LANGUAGES.includes(lang) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid public document route');
    const metadata = previewMetadata(lang, origin);
    const heading = rendered.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    const paragraph = rendered.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1];
    if (!heading || !paragraph) throw new Error('Public documents require a heading and introduction: ' + slug);
    const description = Array.from(htmlText(paragraph));
    return {
        ...metadata,
        title: htmlText(heading) + (lang === 'zh' ? ' · FlareMail 文档' : ' · FlareMail Docs'),
        description: description.length > 180 ? description.slice(0, 177).join('') + '…' : description.join(''),
        robots: 'index, follow', canonical: metadata.origin + '/docs/' + lang + '/' + slug,
        url: metadata.origin + '/docs/' + lang + '/' + slug,
        alternates: [
            {lang:'zh-Hans',url:metadata.origin + '/docs/zh/' + slug},
            {lang:'en',url:metadata.origin + '/docs/en/' + slug},
            {lang:'x-default',url:metadata.origin + '/docs/en/' + slug},
        ],
    };
}

function metadataElements(metadata) {
    const meta = (name, content) => ['meta', {name, content}];
    const og = (property, content) => ['meta', {property, content}];
    const elements = [
        meta('description', metadata.description), meta('robots', metadata.robots),
        og('og:type', 'website'), og('og:site_name', 'FlareMail'), og('og:title', metadata.title),
        og('og:description', metadata.description), og('og:url', metadata.url),
        og('og:locale', metadata.lang === 'zh' ? 'zh_CN' : 'en_US'),
        og('og:locale:alternate', metadata.lang === 'zh' ? 'en_US' : 'zh_CN'),
        og('og:image', metadata.origin + '/mail-pwa-512.png'), og('og:image:type', 'image/png'),
        og('og:image:width', '512'), og('og:image:height', '512'), og('og:image:alt', 'FlareMail'),
        meta('twitter:card', 'summary'), meta('twitter:title', metadata.title),
        meta('twitter:description', metadata.description), meta('twitter:image', metadata.origin + '/mail-pwa-512.png'),
        meta('twitter:image:alt', 'FlareMail'),
    ];
    if (metadata.canonical) elements.push(['link', {rel:'canonical', href:metadata.canonical}]);
    for (const alternate of metadata.alternates) elements.push(['link', {rel:'alternate', hreflang:alternate.lang, href:alternate.url}]);
    return elements;
}

export function metadataHead(metadata) {
    return '<title>' + escapeHtml(metadata.title) + '</title>\n' + metadataElements(metadata).map(([tag, attrs]) => '<' + tag + ' data-pages-seo ' + Object.entries(attrs).map(([key,value]) => key + '="' + escapeHtml(value) + '"').join(' ') + '>').join('\n');
}

export function withMetadata(html, metadata) {
    return html
        .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
        .replace(/<(?:meta|link)\b[^>]*\bdata-pages-seo\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*\bname=["'](?:description|robots)["'][^>]*>/gi, '')
        .replace(/<html\b[^>]*>/i, '<html lang="' + metadata.htmlLang + '">')
        .replace('</head>', () => metadataHead(metadata) + '\n</head>');
}

export function applyMetadata(metadata, document) {
    document.title = metadata.title;
    document.documentElement.lang = metadata.htmlLang;
    document.head.querySelectorAll('[data-pages-seo], meta[name="description"], meta[name="robots"]').forEach(node => node.remove());
    for (const [tag, attrs] of metadataElements(metadata)) {
        const node = document.createElement(tag);
        node.setAttribute('data-pages-seo', '');
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
        document.head.appendChild(node);
    }
}

export const PUBLIC_ORIGIN = publicOrigin(import.meta.env?.VITE_PUBLIC_SITE_URL || DEFAULT_PUBLIC_ORIGIN);
