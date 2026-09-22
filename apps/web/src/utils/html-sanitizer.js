const ALLOWED_TAGS = new Set([
    'DIV', 'SPAN', 'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL',
    'SUB', 'SUP', 'SMALL', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'TABLE',
    'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL',
    'A', 'IMG', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'ADDRESS',
])

const REMOVE_WITH_CONTENT = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON',
    'TEXTAREA', 'SELECT', 'OPTION', 'META', 'LINK', 'BASE', 'TEMPLATE', 'NOSCRIPT',
    'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS', 'FRAME', 'FRAMESET',
])

const GLOBAL_ATTRIBUTES = new Set(['class', 'title', 'lang', 'dir', 'style'])
const TAG_ATTRIBUTES = {
    BLOCKQUOTE: new Set(['type']),
    A: new Set(['href']),
    IMG: new Set(['src', 'alt', 'width', 'height', 'data-remote-src']),
    TABLE: new Set(['width', 'height', 'border', 'cellpadding', 'cellspacing', 'align', 'bgcolor']),
    TR: new Set(['align', 'valign', 'bgcolor']),
    TH: new Set(['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor']),
    TD: new Set(['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor']),
    COL: new Set(['width', 'span']),
    OL: new Set(['start', 'type']),
    LI: new Set(['value']),
}

const ALLOWED_STYLE_PROPERTIES = new Set([
    'color', 'background-color', 'font-family', 'font-size', 'font-style', 'font-weight',
    'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-indent',
    'text-transform', 'white-space', 'word-break', 'word-wrap', 'overflow-wrap',
    'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-color', 'border-style', 'border-width', 'border-collapse', 'border-spacing',
    'border-radius', 'display', 'vertical-align',
    'float', 'clear', 'table-layout',
])

function isWhiteOrLightColor(colorStr) {
    if (!colorStr) return false;
    const c = colorStr.trim().toLowerCase();
    return ['#fff', '#ffffff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)', 'rgba(255,255,255,1)', 'rgba(255, 255, 255, 1)', '#fcfcfc', '#fafafa', '#f8f9fa'].includes(c);
}

function isDarkColor(colorStr) {
    if (!colorStr) return false;
    const c = colorStr.trim().toLowerCase();
    return ['#000', '#000000', '#111', '#111111', '#222', '#222222', '#333', '#333333', 'black', 'rgb(0,0,0)', 'rgb(0, 0, 0)', '#13181d', '#1f2937', '#0f172a', '#2d3748', 'rgba(0,0,0,1)'].includes(c);
}

function sanitizeStyle(style, isDark = false) {
    if (!style) return ''
    const declarations = []
    for (const declaration of style.split(';')) {
        const separator = declaration.indexOf(':')
        if (separator < 1) continue
        const property = declaration.slice(0, separator).trim().toLowerCase()
        let value = declaration.slice(separator + 1).trim()
        const unsafe = /url\s*\(|expression\s*\(|@import|javascript:|data:|behavior\s*:|-moz-binding|\\/i.test(value)
        if (ALLOWED_STYLE_PROPERTIES.has(property) && value && value.length <= 500 && !unsafe) {
            if (isDark) {
                if ((property === 'background' || property === 'background-color') && isWhiteOrLightColor(value)) {
                    value = 'transparent';
                } else if (property === 'color' && isDarkColor(value)) {
                    value = '#E2E8F0';
                }
            }
            declarations.push(`${property}: ${value}`)
        }
    }
    return declarations.join('; ')
}

function safeUrl(value, protocols) {
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null
    try {
        const url = new URL(value.trim(), window.location.origin)
        if (!protocols.has(url.protocol.toLowerCase())) return null
        return value.trim()
    } catch {
        return null
    }
}

function sanitizeImage(element, allowRemoteImages) {
    const source = (element.getAttribute('src') || '').trim()
    const remembered = (element.getAttribute('data-remote-src') || '').trim()
    if (source.startsWith('/api/attachment/')) {
        element.setAttribute('src', source)
        element.removeAttribute('data-remote-src')
        return
    }

    const remote = safeUrl(source || remembered, new Set(['http:', 'https:']))
    if (remote && new URL(remote, window.location.origin).origin !== window.location.origin) {
        if (allowRemoteImages) {
            element.setAttribute('src', remote)
            element.removeAttribute('data-remote-src')
        } else {
            element.removeAttribute('src')
            element.setAttribute('data-remote-src', remote)
        }
        return
    }

    element.removeAttribute('src')
    element.removeAttribute('data-remote-src')
}

export function sanitizeEmailHtml(html, {allowRemoteImages = false, isDark = false} = {}) {
    const document = new DOMParser().parseFromString(html || '', 'text/html')
    const body = document.body

    for (const element of Array.from(body.querySelectorAll('*'))) {
        const tag = element.tagName.toUpperCase()
        if (REMOVE_WITH_CONTENT.has(tag)) {
            element.remove()
            continue
        }
        if (!ALLOWED_TAGS.has(tag)) {
            element.replaceWith(...Array.from(element.childNodes))
            continue
        }

        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase()
            if (name.startsWith('on') || !(GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[tag]?.has(name))) {
                element.removeAttribute(attribute.name)
            }
        }

        if (element.hasAttribute('style')) {
            const style = sanitizeStyle(element.getAttribute('style'), isDark)
            if (style) element.setAttribute('style', style)
            else element.removeAttribute('style')
        }

        if (isDark && element.hasAttribute('bgcolor')) {
            const bgVal = element.getAttribute('bgcolor')
            if (isWhiteOrLightColor(bgVal)) {
                element.removeAttribute('bgcolor')
            }
        }

        if (tag === 'A') {
            const href = safeUrl(element.getAttribute('href'), new Set(['http:', 'https:', 'mailto:']))
            if (href) {
                element.setAttribute('href', href)
                element.setAttribute('target', '_blank')
                element.setAttribute('rel', 'noopener noreferrer')
            } else {
                element.removeAttribute('href')
            }
        }

        if (tag === 'IMG') sanitizeImage(element, allowRemoteImages)
    }

    const bodyStyle = sanitizeStyle(body.getAttribute('style'), isDark)
    const blockedRemoteImages = body.querySelectorAll('img[data-remote-src]').length
    return {html: body.innerHTML, bodyStyle, blockedRemoteImages}
}
