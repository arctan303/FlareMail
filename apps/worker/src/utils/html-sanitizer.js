import { parseHTML } from 'linkedom';
import { downgradeOverBudgetTables, isBoundedLink } from '../../../shared/content-budgets.mjs';

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

function isSafeAttachmentKey(value) {
	try {
		const key = decodeURIComponent(value);
		return key.startsWith('attachments/') && key.length > 'attachments/'.length
			&& !key.includes('..') && !/[\\\u0000-\u001f\u007f]/.test(key);
	} catch {
		return false;
	}
}

function isInternalImageSource(value) {
	if (value.startsWith('cid:')) return !/[\u0000-\u0020\u007f]/.test(value) && value.length > 4;
	const path = value.startsWith('{{domain}}') ? value.slice('{{domain}}'.length) : value;
	if (!(path.startsWith('attachments/') || path.startsWith('/api/attachment/attachments/'))) return false;
	if (/[\\\u0000-\u001f\u007f]/.test(path)) return false;
	try {
		const url = new URL(path, 'https://mail.invalid/api/attachment/');
		return url.pathname.startsWith('/api/attachment/attachments/')
			&& isSafeAttachmentKey(url.pathname.slice('/api/attachment/'.length));
	} catch {
		return false;
	}
}

function removeComments(document) {
	const pending = [document];
	while (pending.length) {
		const node = pending.pop();
		for (const child of Array.from(node.childNodes || [])) {
			if (child.nodeType === 8) child.remove();
			else pending.push(child);
		}
	}
}

function normalizeAttributes(element, tag) {
	const attributes = new Map();
	for (const attribute of Array.from(element.attributes)) {
		const name = attribute.name.toLowerCase();
		const previous = attributes.get(name);
		attributes.set(name, { value: attribute.value, ambiguous: !!previous });
		element.removeAttribute(attribute.name);
	}
	for (const [name, attribute] of attributes) {
		if (!attribute.ambiguous && !name.startsWith('on')
			&& (GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[tag]?.has(name))) {
			element.setAttribute(name, attribute.value);
		}
	}
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
	removeComments(document);
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

		normalizeAttributes(element, tag);

		if (element.hasAttribute('style')) {
			const style = sanitizeStyle(element.getAttribute('style'));
			if (style) element.setAttribute('style', style);
			else element.removeAttribute('style');
		}

		if (tag === 'A') {
			const rawHref = element.getAttribute('href');
			const href = isBoundedLink(rawHref)
				? safeExternalUrl(rawHref, new Set(['http:', 'https:', 'mailto:']))
				: null;
			if (href && isBoundedLink(href)) {
				element.setAttribute('href', href);
				element.setAttribute('target', '_blank');
				element.setAttribute('rel', 'noopener noreferrer');
			} else {
				element.removeAttribute('href');
			}
		}

		if (tag === 'IMG') sanitizeImageSource(element, blockRemoteImages);
	}
	downgradeOverBudgetTables(document);

	// LinkeDOM's HTML attribute serializer does not escape ampersands. Keep
	// literal entity-looking values stable when the browser parses this output.
	for (const element of document.querySelectorAll('*')) {
		for (const attribute of Array.from(element.attributes)) {
			attribute.value = attribute.value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
		}
	}
	return document.toString();
}

export default sanitizeEmailHtml;
