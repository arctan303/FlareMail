import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { sanitizeEmailHtml } from '../src/utils/html-sanitizer';
import { CONTENT_LIMITS, tableWithinBudget } from '../../shared/content-budgets.mjs';

const urlAt = length => 'https://example.test/' + 'x'.repeat(length - 'https://example.test/'.length);
const row = (cells = 1, text = 'Cell') => `<tr>${`<td>${text}</td>`.repeat(cells)}</tr>`;
const table = body => `<table>${body}</table>`;
const cleanDocument = html => parseHTML(sanitizeEmailHtml(html)).document;

describe('mail content budgets before URL and table expansion', () => {
  it('keeps exactly 8192-character links and removes only the click above the limit', () => {
    for (const length of [CONTENT_LIMITS.hrefLength, CONTENT_LIMITS.hrefLength + 1]) {
      const clean = cleanDocument(`<a href="  ${urlAt(length)}  "><b>Readable link</b></a>`);
      const anchor = clean.querySelector('a');
      expect(anchor.hasAttribute('href')).toBe(length === CONTENT_LIMITS.hrefLength);
      expect(anchor.textContent).toBe('Readable link');
      expect(anchor.querySelector('b')).not.toBeNull();
    }
  });

  it('checks normalized URLs and the decoded attribute once without decoding URI or entity layers again', () => {
    const prefix = 'https://example.test/';
    const encodedBoundary = prefix + '&#120;'.repeat(CONTENT_LIMITS.hrefLength - prefix.length);
    expect(cleanDocument(`<a href="${encodedBoundary}">Decoded</a>`).querySelector('a').getAttribute('href')).toBe(urlAt(8192));
    const unicode = prefix + 'é'.repeat(1400);
    expect(unicode.length).toBeLessThan(8192);
    expect(new URL(unicode).toString().length).toBeGreaterThan(8192);
    expect(cleanDocument(`<a href="${unicode}">Unicode text</a>`).querySelector('a').hasAttribute('href')).toBe(false);
    const literal = `${prefix}?literal=%2526amp%253B&amp;amp;`;
    expect(cleanDocument(`<a href="${literal}">Literal</a>`).querySelector('a').getAttribute('href')).toBe(`${prefix}?literal=%2526amp%253B&amp;`);
  });

  it('leaves safe links and image privacy policies intact without adding an image URL limit', () => {
    const source = `<a href="mailto:reader@example.test">Mail</a><a href="https://example.test/path">Web</a><a href="//example.test/path">Protocol relative</a><a href="javascript:alert(1)">Unsafe</a><img src="${urlAt(8193)}">`;
    const clean = cleanDocument(source);
    expect(clean.querySelectorAll('a[href]').length).toBe(2);
    expect(clean.querySelector('img').hasAttribute('src')).toBe(false);
    expect(clean.querySelector('img').getAttribute('data-remote-src').length).toBe(8193);
    const allowed = parseHTML(sanitizeEmailHtml(source, { blockRemoteImages: false })).document;
    expect(allowed.querySelector('img').getAttribute('src').length).toBe(8193);
  });

  it('accepts exactly 10000 expanded cells and downgrades 10001 while preserving the text', () => {
    for (const cells of [10000, 10001]) {
      const clean = cleanDocument(table(row(cells, 'x')));
      expect(clean.querySelector('table') !== null).toBe(cells === 10000);
      expect((clean.body.textContent.match(/x/g) || []).length).toBe(cells);
    }
    expect(cleanDocument(table(row(100).repeat(100))).querySelector('table')).not.toBeNull();
  });

  it.each(['td', 'th'])('bounds %s row and column spans, including trailing virtual rows', tag => {
    const atLimit = table(`<tr><${tag} colspan="100" rowspan="100">Spanned</${tag}></tr>`);
    expect(cleanDocument(atLimit).querySelector(tag)).not.toBeNull();
    for (const attribute of ['colspan', 'rowspan']) {
      const clean = cleanDocument(table(`<tr><${tag} ${attribute}="101">Spanned</${tag}></tr>`));
      expect(clean.querySelector('table')).toBeNull();
      expect(clean.body.textContent).toContain('Spanned');
    }
  });

  it('bounds sparse rectangular grids as well as occupied cell area', () => {
    const grid = `<tr><td colspan="99" rowspan="100">Tall</td></tr><tr><td>Edge</td></tr>`;
    expect(cleanDocument(table(grid)).querySelector('table')).not.toBeNull();
    expect(cleanDocument(table(grid + '<tr><td colspan="2">Beyond</td></tr>')).querySelector('table')).toBeNull();
    expect(cleanDocument(table(row(100) + '<tr></tr>'.repeat(99))).querySelector('table')).not.toBeNull();
    expect(cleanDocument(table(row(100) + '<tr></tr>'.repeat(100))).querySelector('table')).toBeNull();
  });

  it('includes declared column expansion without imposing a 100-column COL span limit', () => {
    expect(cleanDocument(table('<colgroup><col span="101"></colgroup>' + row())).querySelector('table')).not.toBeNull();
    expect(cleanDocument(table('<col span="10000">' + row())).querySelector('table')).not.toBeNull();
    expect(cleanDocument(table('<col span="10001">' + row())).querySelector('table')).toBeNull();
    expect(cleanDocument(table('<col span="10000">' + row().repeat(2))).querySelector('table')).toBeNull();
    expect(cleanDocument(table('<col span="5000"><col span="5001">' + row())).querySelector('table')).toBeNull();
  });

  it('handles parseInt-compatible malformed and unbounded span values before allocation', () => {
    for (const span of ['100suffix', '+100suffix', '0100', '1e999', '-101', 'Infinity', 'not-a-number']) {
      expect(cleanDocument(table(`<tr><td colspan="${span}">Kept</td></tr>`)).querySelector('table'), span).not.toBeNull();
    }
    for (const span of ['101suffix', '+101suffix', '0101', '9'.repeat(400)]) {
      expect(cleanDocument(table(`<tr><td colspan="${span}">Kept</td></tr>`)).querySelector('table'), span).toBeNull();
      expect(cleanDocument(table(`<col span="${span === '9'.repeat(400) ? span : '10001suffix'}">${row()}`)).querySelector('table')).toBeNull();
    }
  });

  it('uses rowspan zero as the remaining rows in its own row group', () => {
    const first = '<tr><td rowspan="0">Group</td><td>First</td></tr>';
    const rest = row(1, 'Next');
    const clean = cleanDocument(table(`<tbody>${first}${rest.repeat(99)}</tbody><tbody>${row().repeat(101)}</tbody>`));
    expect(clean.querySelector('table')).not.toBeNull();
    expect(clean.querySelector('td').getAttribute('rowspan')).toBe('0');
    expect(cleanDocument(table(`<tbody>${first}${rest.repeat(100)}</tbody>`)).querySelector('table')).toBeNull();
    expect(cleanDocument(table(`<tbody>${row().repeat(101)}${first}</tbody>`)).querySelector('table')).not.toBeNull();
  });

  it('budgets nested tables separately and safely flattens caption, rows, cells and nested text after cleaning', () => {
    const nested = table(row(10000, 'n'));
    expect(cleanDocument(table(`<tr><td>Outer${nested}</td></tr>`)).querySelectorAll('table').length).toBe(2);
    const parent = cleanDocument(table(`<tr><td>Outer${table(row(10001, 'n'))}</td></tr>`));
    expect(parent.querySelectorAll('table').length).toBe(1);
    const malicious = table('<caption>Caption &lt;img src=x&gt;</caption><tr><td colspan="101">One<a href="https://example.test">Link</a><script>Forbidden</script><img src="https://tracker.test/x" alt="Alternative">' + table(row(1, 'Nested')) + 'Tail</td><td>Two<br>End</td></tr>');
    const clean = cleanDocument(malicious);
    expect(clean.querySelector('table')).toBeNull();
    expect(clean.querySelector('a, img, script')).toBeNull();
    expect(clean.querySelector('pre').getAttribute('style')).toMatch(/white-space:\s*pre-wrap/);
    expect(clean.body.textContent).toContain('Caption <img src=x>\n');
    expect(clean.body.textContent).toContain('OneLinkAlternative\nNested\n');
    expect(clean.body.textContent).toContain('Tail\tTwo\nEnd\n');
    expect(clean.body.textContent).not.toContain('Forbidden');
  });

  it('supports the same budget contract through a minimal non-DOM adapter', () => {
    const adapter = { name: node => node.name, children: node => node.children || [], attribute: (node, key) => node.attrs?.[key] };
    const ast = { name: 'table', children: [{ name: 'tr', children: [{ name: 'td', attrs: { colspan: '100', rowspan: '100' } }] }] };
    expect(tableWithinBudget(ast, adapter)).toBe(true);
    ast.children[0].children[0].attrs.rowspan = '101';
    expect(tableWithinBudget(ast, adapter)).toBe(false);
  });
});
