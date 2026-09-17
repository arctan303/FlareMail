import {sanitizeEmailHtml as sanitizeOriginal} from '../utils/html-sanitizer.js';
import {playground} from './http.js';

// Keep the production sanitizer's rules. Only owned, local image objects can render here.
export function sanitizeEmailHtml(html,options={}){
  const source=new DOMParser().parseFromString(html||'','text/html');
  const local=new Map();
  for(const image of source.querySelectorAll('img')){
    const src=image.getAttribute('src')||'';
    if(playground.ownsObjectUrl(src)||/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(src)){
      const placeholder='/api/attachment/__pages_inline_'+local.size;
      local.set(placeholder,src);image.setAttribute('src',placeholder);
    }
  }
  const result=sanitizeOriginal(source.body.innerHTML,{...options,allowRemoteImages:false});
  const clean=new DOMParser().parseFromString(result.html,'text/html');
  for(const image of clean.querySelectorAll('img[src]')){
    const src=image.getAttribute('src');
    const url=local.get(src)||(src.startsWith('/api/attachment/')?playground.attachmentUrl(src):'');
    if(url)image.setAttribute('src',url);else image.removeAttribute('src');
  }
  return {...result,html:clean.body.innerHTML};
}
