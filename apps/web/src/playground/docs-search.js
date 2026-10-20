import { Marked } from 'marked';
import { renderMarkdown } from './markdown.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function highlightMatch(text, query) {
  const raw = String(text ?? '');
  if (!query) return escapeHtml(raw);
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let html = '', offset = 0;
  for (const match of raw.matchAll(pattern)) {
    html += escapeHtml(raw.slice(offset, match.index)) + '<mark>' + escapeHtml(match[0]) + '</mark>';
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(raw.slice(offset));
}

function inlineText(tokens) {
  return tokens.map(token => token.tokens ? inlineText(token.tokens) : (token.text ?? token.raw ?? '')).join('');
}

// Walk parsed Markdown blocks in rendering order. Code examples and inline
// markup cannot create imaginary headings or shift the real section IDs.
export function buildDocSearchIndex(items, readDocument, lang) {
  return items.map(item => {
    const raw = readDocument(lang, item.slug);
    const headings = renderMarkdown(raw, lang).headings;
    const sections = [{ headingId: '', headingText: '', lines: [] }];
    let section = sections[0], headingIndex = 0;
    function visit(tokens) {
      for (const token of tokens) {
        if (token.type === 'heading') {
          const heading = headings[headingIndex++];
          section = { headingId: heading.id, headingText: inlineText(token.tokens), lines: [] };
          sections.push(section);
        } else if (token.type === 'list') {
          token.items.forEach(item => visit(item.tokens));
        } else if (token.type === 'blockquote') {
          visit(token.tokens);
        } else if (token.type === 'table') {
          section.lines.push(...[token.header, ...token.rows].map(row => row.map(cell => inlineText(cell.tokens)).join(' | ')));
        } else if (['paragraph', 'text', 'code', 'html'].includes(token.type)) {
          const text = token.tokens ? inlineText(token.tokens) : token.text;
          section.lines.push(...String(text ?? '').split('\n').filter(line => line.trim()));
        }
      }
    }
    visit(new Marked({ gfm: true }).lexer(raw));
    return { slug: item.slug, docTitle: item[lang] || item.slug, groupName: item.group[lang] || '', sections };
  });
}

export function searchDocs(index, query, limit = 15) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const { sections, ...doc } of index) {
    if (doc.docTitle.toLowerCase().includes(q)) results.push({ ...doc, key: doc.slug + '-doc', headingId: '', headingText: '', snippet: '', score: 100 });
    for (const section of sections) {
      const { headingId, headingText } = section;
      if (headingText.toLowerCase().includes(q)) {
        results.push({ ...doc, key: doc.slug + '-' + headingId, headingId, headingText, snippet: '', score: 80 });
        continue;
      }
      const line = section.lines.find(line => line.toLowerCase().includes(q));
      if (!line) continue;
      const pos = line.toLowerCase().indexOf(q);
      const start = Math.max(0, pos - 28), end = Math.min(line.length, pos + q.length + 36);
      const snippet = (start ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
      results.push({ ...doc, key: `${doc.slug}-${headingId || 'content'}-content`, headingId, headingText, snippet: highlightMatch(snippet, q), score: 50 });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
