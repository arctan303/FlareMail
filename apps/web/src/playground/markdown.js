import {Marked, Lexer} from 'marked';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const repo='https://github.com/arctan303/FlareMail/blob/main/';

const CALLOUT_ICONS = {
    note: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    tip: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.677.933.204.37.375.853.375 1.51v.5a.75.75 0 0 0 .75.75h2a.75.75 0 0 0 .75-.75v-.5c0-.657.171-1.14.375-1.51.207-.377.454-.669.677-.933l.214-.253c.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM5.5 13a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Z"/></svg>',
    important: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.75a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-1.5 0v-4.5ZM8 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    warning: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 1.5 0ZM8 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    caution: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97Z"/></svg>'
};
const CALLOUT_TITLES = {
    zh: { note: '说明', tip: '提示', important: '重要', warning: '注意', caution: '警告' },
    en: { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }
};

// Tokenize source once, then escape each token. Generated spans must never be
// fed back through a replacement that mistakes their attributes for code.
function highlightTokens(raw, pattern, classify) {
    let html = '', offset = 0;
    for (const match of raw.matchAll(pattern)) {
        html += escape(raw.slice(offset, match.index));
        const style = classify(match[0], raw.slice(match.index + match[0].length));
        html += style ? `<span class="hl-${style}">${escape(match[0])}</span>` : escape(match[0]);
        offset = match.index + match[0].length;
    }
    return html + escape(raw.slice(offset));
}

function highlightSyntax(raw, lang) {
    if (lang === 'json') {
        return highlightTokens(raw, /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
            (token, rest) => token.startsWith('"') ? (/^\s*:/.test(rest) ? 'key' : 'string') : 'number');
    }
    if (['sh', 'bash', 'shell', 'zsh'].includes(lang)) {
        return highlightTokens(raw, /"(?:\\.|[^"\\])*"|'[^']*'|#[^\n]*|\$\{[A-Za-z0-9_]+\}|\$[A-Za-z0-9_]+|(?<!\S)--?[a-zA-Z0-9][a-zA-Z0-9-]*|\b(?:pnpm|npm|npx|node|git|curl|wrangler|docker|cd|mkdir|echo|cat|tar|gzip|rm|cp|mv|export)\b/g,
            token => /^["']/.test(token) ? 'string' : token.startsWith('#') ? 'comment' : token.startsWith('$') ? 'var' : token.startsWith('-') ? 'flag' : 'cmd');
    }
    if (['js', 'javascript', 'ts', 'typescript'].includes(lang)) {
        return highlightTokens(raw, /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|export|from|const|let|var|function|return|if|else|async|await|try|catch|new|class|default)\b|\b(?:true|false|null|undefined)\b|-?\b\d+(?:\.\d+)?/g,
            token => token.startsWith('/') ? 'comment' : /^["'`]/.test(token) ? 'string' : /^(?:-?\d|true$|false$|null$|undefined$)/.test(token) ? 'number' : 'cmd');
    }
    if (lang === 'http') {
        return raw.split('\n').map(line => {
            const match = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)(\s+)(\S+)|^([A-Za-z0-9-]+:)(\s*)(.*)|^(HTTP\/\d(?:\.\d)?)(\s+)(\d{3})(\s*)(.*)$/);
            if (!match) return escape(line);
            if (match[1]) return `<span class="hl-method">${escape(match[1])}</span>${escape(match[2])}<span class="hl-url">${escape(match[3])}</span>${escape(line.slice(match[0].length))}`;
            if (match[4]) return `<span class="hl-key">${escape(match[4])}</span>${escape(match[5])}<span class="hl-string">${escape(match[6])}</span>`;
            return `<span class="hl-cmd">${escape(match[7])}</span>${escape(match[8])}<span class="hl-number">${escape(match[9])}</span>${escape(match[10] + match[11])}`;
        }).join('\n');
    }
    return escape(raw);
}

export function renderMarkdown(source,lang='zh'){
    const headings=[];
    const renderer={
        heading({tokens,depth,text}){
            const id='section-'+headings.length;
            headings.push({id,depth,text:text.replace(/[*`]/g,'')});
            const inner = this.parser.parseInline(tokens);
            if (depth > 1) {
                return '<h'+depth+' id="'+id+'" class="docs-heading"><a class="docs-anchor" href="#'+id+'" aria-label="'+(lang==='en'?'Link to this section':'跳转到此章节')+'">#</a>'+inner+'</h'+depth+'>';
            }
            return '<h'+depth+' id="'+id+'">'+inner+'</h'+depth+'>';
        },
        blockquote({tokens}){
            const first = tokens[0];
            const match = first?.type === 'paragraph' && first.text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\n]*))?(?:\n|$)/i);
            if (match) {
                const type = match[1].toLowerCase();
                const customTitle = match[2]?.trim();
                const remaining = first.text.slice(match[0].length);
                const rest = this.parser.parse([...new Marked({gfm:true}).lexer(remaining), ...tokens.slice(1)]);
                const title = customTitle
                    ? this.parser.parseInline(Lexer.lexInline(customTitle))
                    : escape(CALLOUT_TITLES[lang]?.[type] || CALLOUT_TITLES.en[type] || type.toUpperCase());
                const icon = CALLOUT_ICONS[type] || CALLOUT_ICONS.note;
                return `<div class="docs-callout docs-callout-${type}"><div class="docs-callout-header"><span class="docs-callout-icon">${icon}</span><strong class="docs-callout-title">${title}</strong></div><div class="docs-callout-body">${rest}</div></div>`;
            }
            return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;
        },
        code({text,lang:syntax}){
            const langName = (syntax || 'text').toLowerCase();
            const highlighted = highlightSyntax(text, langName);
            return '<div class="docs-code"><div class="docs-code-heading"><span class="docs-code-lang">'+escape(syntax||'text')+'</span><button type="button" data-copy-code>'+ (lang==='en'?'Copy':'复制')+'</button></div><pre><code>'+highlighted+'</code></pre></div>';
        },
        html({text}){return escape(text);},
        image({text}){return '<span>'+escape(text)+'</span>';},
        link({href,tokens}){
            if(href==='LICENSE')href='/license.txt';
            else if(href==='THIRD-PARTY-NOTICES.md')href='/third-party-notices.txt';
            else if(href==='SECURITY.md')href=repo+href;
            else if(!/^(?:https?:|mailto:|#|\/)/i.test(href))href=repo+href.replace(/^(?:\.\.\/|\.\/)+/,'');
            let safe='#';
            try{const url=new URL(href,'https://sample.invalid');if(['https:','http:','mailto:'].includes(url.protocol))safe=href;}catch{}
            const external=/^https?:/i.test(safe);
            return '<a href="'+escape(safe)+'"'+(external?' target="_blank" rel="noopener noreferrer"':'')+'>'+this.parser.parseInline(tokens)+'</a>';
        },
    };
    return {html:new Marked({renderer,gfm:true}).parse(source),headings};
}
