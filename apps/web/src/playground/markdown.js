import {Marked} from 'marked';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const repo='https://github.com/arctan303/FlareMail/blob/main/';
function highlightSyntax(raw, lang) {
    const escaped = escape(raw);
    if (!lang || lang === 'text') return escaped;

    if (lang === 'json') {
        return escaped
            .replace(/(&quot;(?:\\.|[^"\\])*&quot;)(\s*:)/g, '<span class="hl-key">$1</span>$2')
            .replace(/(:\s*)(&quot;(?:\\.|[^"\\])*&quot;)/g, '$1<span class="hl-string">$2</span>')
            .replace(/\b(-?\d+(?:\.\d+)?|true|false|null)\b/g, '<span class="hl-number">$1</span>');
    }

    if (lang === 'sh' || lang === 'bash' || lang === 'shell' || lang === 'zsh') {
        return escaped
            .split('\n')
            .map(line => {
                const commentIdx = line.indexOf('#');
                let codePart = line;
                let commentPart = '';
                if (commentIdx !== -1 && !/["'].*#.*["']/.test(line)) {
                    codePart = line.slice(0, commentIdx);
                    commentPart = '<span class="hl-comment">' + line.slice(commentIdx) + '</span>';
                }
                const highlightedCode = codePart
                    .replace(/\b(pnpm|npm|npx|node|git|curl|wrangler|docker|cd|mkdir|echo|cat|tar|gzip|rm|cp|mv|export)\b/g, '<span class="hl-cmd">$1</span>')
                    .replace(/(\s|^)(-[a-zA-Z0-9]+|--[a-zA-Z0-9-]+)/g, '$1<span class="hl-flag">$2</span>')
                    .replace(/(&quot;(?:\\.|[^"\\])*&quot;|&#39;(?:\\.|[^'\\])*&#39;)/g, '<span class="hl-string">$1</span>')
                    .replace(/(\$[A-Za-z0-9_]+|\$\{[A-Za-z0-9_]+\})/g, '<span class="hl-var">$1</span>');
                return highlightedCode + commentPart;
            })
            .join('\n');
    }

    if (lang === 'http') {
        return escaped
            .split('\n')
            .map(line => {
                const methodMatch = line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD)(\s+)(\S+)/);
                if (methodMatch) {
                    return `<span class="hl-method">${methodMatch[1]}</span>${methodMatch[2]}<span class="hl-url">${methodMatch[3]}</span>` + line.slice(methodMatch[0].length);
                }
                const headerMatch = line.match(/^([A-Za-z0-9-]+:)(\s*)(.*)$/);
                if (headerMatch) {
                    return `<span class="hl-key">${headerMatch[1]}</span>${headerMatch[2]}<span class="hl-string">${headerMatch[3]}</span>`;
                }
                const statusMatch = line.match(/^(HTTP\/\d(?:\.\d)?)(\s+)(\d{3})(\s*)(.*)$/);
                if (statusMatch) {
                    return `<span class="hl-cmd">${statusMatch[1]}</span>${statusMatch[2]}<span class="hl-number">${statusMatch[3]}</span>${statusMatch[4]}${statusMatch[5]}`;
                }
                return line;
            })
            .join('\n');
    }

    if (lang === 'js' || lang === 'javascript' || lang === 'ts') {
        return escaped
            .replace(/\b(import|export|from|const|let|var|function|return|if|else|async|await|try|catch|new|class|default)\b/g, '<span class="hl-cmd">$1</span>')
            .replace(/(&quot;(?:\\.|[^"\\])*&quot;|&#39;(?:\\.|[^'\\])*&#39;)/g, '<span class="hl-string">$1</span>')
            .replace(/\b(-?\d+(?:\.\d+)?|true|false|null|undefined)\b/g, '<span class="hl-number">$1</span>')
            .replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>');
    }

    return escaped;
}

export function renderMarkdown(source,lang='zh'){
    const headings=[];
    const renderer={
        heading({tokens,depth,text}){
            const id='section-'+headings.length;
            headings.push({id,depth,text:text.replace(/[*`]/g,'')});
            return '<h'+depth+' id="'+id+'">'+this.parser.parseInline(tokens)+'</h'+depth+'>';
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
