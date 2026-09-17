import {Marked} from 'marked';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const repo='https://github.com/arctan303/FlareMail/blob/main/';
export function renderMarkdown(source,lang='zh'){
    const headings=[];
    const renderer={
        heading({tokens,depth,text}){
            const id='section-'+headings.length;
            headings.push({id,depth,text:text.replace(/[*`]/g,'')});
            return '<h'+depth+' id="'+id+'">'+this.parser.parseInline(tokens)+'</h'+depth+'>';
        },
        code({text,lang:syntax}){
            return '<div class="docs-code"><div class="docs-code-heading"><span>'+escape(syntax||'text')+'</span><button type="button" data-copy-code>'+ (lang==='en'?'Copy':'复制')+'</button></div><pre><code>'+escape(text)+'</code></pre></div>';
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
