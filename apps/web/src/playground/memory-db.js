// The same small table interface used by the current drafts UI, entirely in memory.
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
export function createMemoryDb(locale='zh') {
    function table(key, initial=[]) {
        const rows = new Map(initial.map(row=>[row[key],copy(row)]));
        let nextId = 100;
        return {
            async get(id){return copy(rows.get(id));},
            async add(value){const row=copy(value);row[key]??=nextId++;rows.set(row[key],row);return row[key];},
            async put(value){return this.add(value);},
            async update(id,value){if(!rows.has(id)){if(key!=='draftId'||!('attachments' in value))return 0;rows.set(id,{[key]:id});}Object.assign(rows.get(id),copy(value));return 1;},
            async delete(id){rows.delete(id);},
            async bulkDelete(values){values.forEach(id=>rows.delete(id));},
            async clear(){rows.clear();},
            async toArray(){return [...rows.values()].map(copy);},
            orderBy(field){
                let descending=false;
                const query={reverse(){descending=true;return query;},async toArray(){
                    return [...rows.values()].sort((a,b)=>descending?b[field]-a[field]:a[field]-b[field]).map(copy);
                }};return query;
            },
        };
    }
    const en=locale==='en';
    const draft = {draftId:1,accountId:1,sendAccountId:1,sendEmail:'alex@example.com',sendName:'Alex',name:'Alex',receiveEmail:['maya@example.net'],subject:en?'A note for Friday':'留给周五的一封信',content:en?'<p>Hi Maya, here are a few ideas for Friday…</p>':'<p>你好 Maya，这是周五讨论前的一些想法……</p>',text:en?'A few ideas for Friday':'周五讨论前的一些想法',attachments:[],sendType:'send',userId:1,createTime:Date.now(),updateTime:Date.now()};
    return {draft:table('draftId',[draft]),att:table('draftId',[{draftId:1,attachments:[]}])};
}
