export { DOC_GROUPS, DOC_ITEMS } from './doc-catalog.js';
const sources=import.meta.glob('../../docs/*/*.md',{eager:true,query:'?raw',import:'default'});
export function getDoc(lang,slug){return sources['../../docs/'+lang+'/'+slug+'.md']||'';}
