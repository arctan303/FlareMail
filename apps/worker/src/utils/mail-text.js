import { parseHTML } from 'linkedom';

const blocks = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TR','BLOCKQUOTE','PRE','SECTION','ARTICLE','TABLE','UL','OL']);

export function htmlMailText(html) {
	if (!html) return '';
	const source = /<body[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`;
	const { document } = parseHTML(source);
	document.querySelectorAll('head,script,style,title,template,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
	const output = [];
	const stack = [{ node: document.body, closing: false }];
	while (stack.length) {
		const { node, closing } = stack.pop();
		if (!node) continue;
		if (node.nodeType === 3) { output.push(node.textContent); continue; }
		if (closing) {
			if (node.tagName === 'A') {
				const href = node.getAttribute('href') || '';
				if (/^(https?:\/\/|mailto:)/i.test(href) && href.length <= 8192 && node.textContent.trim() !== href) output.push(` (${href})`);
			}
			if (blocks.has(node.tagName)) output.push('\n');
			if (node.tagName === 'TD' || node.tagName === 'TH') output.push('\t');
			continue;
		}
		if (blocks.has(node.tagName) || node.tagName === 'BR') output.push('\n');
		if (node.tagName === 'LI') output.push('- ');
		if (node.tagName === 'IMG' && node.getAttribute('alt')) output.push(node.getAttribute('alt'));
		stack.push({ node, closing: true });
		for (let child = node.lastChild; child; child = child.previousSibling) stack.push({ node: child, closing: false });
	}
	return output.join('').replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function readableMailBody(row) {
	// MIME text/plain alternatives can be incomplete or placeholder text. Prefer
	// the readable HTML alternative, while retaining the original text separately.
	const html = htmlMailText(row.content);
	return { body: html || String(row.text || '').trim(), bodySource: html ? 'html' : 'text', text: row.text || '' };
}
