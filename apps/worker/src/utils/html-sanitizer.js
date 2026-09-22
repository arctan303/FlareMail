import { parseHTML } from 'linkedom';

const ALLOWED_TAGS = new Set([
	'HTML', 'HEAD', 'BODY', 'DIV', 'SPAN', 'P', 'BR', 'HR',
	'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'CODE',
	'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'SUB', 'SUP', 'SMALL',
	'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
	'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL',
	'A', 'IMG', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'ADDRESS',
]);

const REMOVE_WITH_CONTENT = new Set([
	'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON',
	'TEXTAREA', 'SELECT', 'OPTION', 'META', 'LINK', 'BASE', 'TEMPLATE', 'NOSCRIPT',
	'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS', 'FRAME', 'FRAMESET',
]);

const GLOBAL_ATTRIBUTES = new Set(['class', 'title', 'lang', 'dir', 'style']);
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
};

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
]);

function sanitizeStyle(style) {
	if (!style) return '';
	const declarations = [];
	for (const declaration of style.split(';')) {
		const separator = declaration.indexOf(':');
		if (separator < 1) continue;
		const property = declaration.slice(0, separator).trim().toLowerCase();
		const value = declaration.slice(separator + 1).trim();
		const unsafeValue = /url\s*\(|expression\s*\(|@import|javascript:|data:|behavior\s*:|-moz-binding|\\/i.test(value);
		if (ALLOWED_STYLE_PROPERTIES.has(property) && value && value.length <= 500 && !unsafeValue) {
			declarations.push(`${property}: ${value}`);
		}
	}
	return declarations.join('; ');
}

function safeExternalUrl(value, protocols) {
	if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
	try {
		const url = new URL(value.trim());
		return protocols.has(url.protocol.toLowerCase()) ? url.toString() : null;
	} catch {
		return null;
	}
}

function isInternalImageSource(value) {
	return value.startsWith('{{domain}}attachments/') ||
		value.startsWith('attachments/') ||
		value.startsWith('/api/attachment/attachments/') ||
		value.startsWith('cid:');
}

function sanitizeImageSource(element, blockRemoteImages) {
	const source = (element.getAttribute('src') || '').trim();
	const remembered = (element.getAttribute('data-remote-src') || '').trim();
	const remoteSource = safeExternalUrl(source, new Set(['http:', 'https:']));
	const rememberedSource = safeExternalUrl(remembered, new Set(['http:', 'https:']));

	if (source && isInternalImageSource(source)) {
		element.setAttribute('src', source);
		element.removeAttribute('data-remote-src');
		return;
	}

	if (remoteSource) {
		if (blockRemoteImages) {
			element.removeAttribute('src');
			element.setAttribute('data-remote-src', remoteSource);
		} else {
			element.setAttribute('src', remoteSource);
			element.removeAttribute('data-remote-src');
		}
		return;
	}
	if (rememberedSource) {
		element.removeAttribute('src');
		element.setAttribute('data-remote-src', rememberedSource);
		return;
	}

	element.removeAttribute('src');
	element.removeAttribute('data-remote-src');
}

export function sanitizeEmailHtml(html, { blockRemoteImages = true } = {}) {
	if (!html || typeof html !== 'string') return '';

	const source = /<html[\s>]/i.test(html)
		? html
		: `<!doctype html><html><body>${html}</body></html>`;
	const { document } = parseHTML(source);
	const elements = Array.from(document.querySelectorAll('*'));

	for (const element of elements) {
		const tag = element.tagName?.toUpperCase();
		if (!tag) continue;

		if (REMOVE_WITH_CONTENT.has(tag)) {
			element.remove();
			continue;
		}

		if (!ALLOWED_TAGS.has(tag)) {
			element.replaceWith(...Array.from(element.childNodes));
			continue;
		}

		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const allowed = GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[tag]?.has(name);
			if (!allowed || name.startsWith('on')) element.removeAttribute(attribute.name);
		}

		if (element.hasAttribute('style')) {
			const style = sanitizeStyle(element.getAttribute('style'));
			if (style) element.setAttribute('style', style);
			else element.removeAttribute('style');
		}

		if (tag === 'A') {
			const href = safeExternalUrl(element.getAttribute('href'), new Set(['http:', 'https:', 'mailto:']));
			if (href) {
				element.setAttribute('href', href);
				element.setAttribute('target', '_blank');
				element.setAttribute('rel', 'noopener noreferrer');
			} else {
				element.removeAttribute('href');
			}
		}

		if (tag === 'IMG') sanitizeImageSource(element, blockRemoteImages);
	}

	return document.toString();
}

export default sanitizeEmailHtml;
