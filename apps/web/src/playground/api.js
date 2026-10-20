import {createSeed} from './seed.js';
import {SCHEMA_PATCH_CATALOG, LATEST_SCHEMA_VERSION} from '../../../worker/src/init/patch-catalog.js';
import {findConversation, groupConversations} from '../../../worker/src/utils/mail-conversation.js';
import {isEmail} from '../utils/verify-utils.js';

const clone = value => structuredClone(value);
const ids = value => (Array.isArray(value)?value:String(value??'').split(',')).map(Number);
const now = () => new Date().toISOString().replace('T',' ').slice(0,19);
export const setupStatus = {setupRequired:false,upgradeRequired:false,upgradeBlocking:false,upgradeSupported:true,currentVersion:LATEST_SCHEMA_VERSION,targetVersion:LATEST_SCHEMA_VERSION};

export function createPlaygroundApi(locale='zh') {
    const state=createSeed(locale), sentRequests=new Map(), assets=new Map(), objects=new Set(), trashSnapshots=new Map();
    const fail=(zh,en,code=400)=>{throw {code,message:locale==='en'?en:zh};};
    const required=(list,key,id)=>list.find(item=>item[key]===Number(id))||fail('示例数据不存在，请刷新后重试。','Sample data not found. Refresh to start again.');
    const myAccounts=(includeDeleted=false)=>state.accounts.filter(a=>a.userId===1&&(includeDeleted||!a.isDel));
    const visibleMail=()=>state.emails.filter(e=>e.userId===1&&!e.isDel&&e.status!==6&&myAccounts().some(a=>a.accountId===e.accountId));
    const trashMail=()=>state.emails.filter(e=>e.userId===1&&e.isDel&&e.status!==6&&myAccounts(true).some(a=>a.accountId===e.accountId));
    const trashExpiry=e=>new Date(Date.parse(e.deletedAt.replace(' ','T')+'Z')+30*86400000).toISOString().replace('T',' ').slice(0,19);
    const retainedTrash=()=>trashMail().filter(e=>e.deletedAt&&Date.parse(e.deletedAt.replace(' ','T')+'Z')>Date.now()-30*86400000);
    const trashRow=e=>({...e,bcc:e.type===1&&e.userId===1?e.bcc:'[]',attachments:(e.attachments||[]).map((att,index)=>({...att,attId:e.emailId+'-'+index,mimeType:att.mimeType||att.contentType})),mailbox:myAccounts(true).find(a=>a.accountId===e.accountId).email,canRestore:!myAccounts(true).find(a=>a.accountId===e.accountId).isDel,expiresAt:e.deletedAt?trashExpiry(e):null});
    const selectTrash=value=>{
        if(!Array.isArray(value)||!value.length||value.length>50||value.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<=0))fail('请选择1至50封邮件。','Select between 1 and 50 messages.');
        return [...new Set(value.map(Number))].map(id=>required(trashMail(),'emailId',id));
    };
    const markDeleted=e=>{if(!e.isDel&&e.status!==6){e.deletedAt=now();e.trashRevision=(e.trashRevision||0)+1;}e.isDel=1;};
    const removeTrash=selected=>{const wanted=new Set(selected.map(e=>e.emailId));state.emails=state.emails.filter(e=>!wanted.has(e.emailId));return {emailIds:[...wanted],deletedCount:wanted.size};};
    function conversationMetadata(){
        const rows=visibleMail();
        if(rows.length>10000)fail('当前用户的有效邮件超过 10000 封，暂时无法使用会话列表及整段操作。','Conversation lists and actions currently support up to 10,000 active messages per user.',413);
        return rows;
    }
    const newestFirst=(a,b)=>b.createTime.localeCompare(a.createTime)||b.emailId-a.emailId;
    function scopeMail(rows,p,starred=false){
        if(starred)return rows.filter(e=>e.isStar&&(!Number(p.accountId)||e.accountId===Number(p.accountId)));
        return rows.filter(e=>e.type===Number(p.type||0)&&(Number(p.allReceive)===1||e.accountId===Number(p.accountId||1)));
    }
    function matchesMail(e,p){
        if(p.filter==='unread'&&e.unread!==0)return false;
        if(p.filter==='has_att'&&!e.attachments.length)return false;
        const term=String(p.keyword||p.q||'').toLowerCase();
        return !term||[e.subject,e.text,e.sendEmail,e.recipient,e.name].some(v=>String(v||'').toLowerCase().includes(term));
    }
    function conversationList(p,starred){
        const visible=conversationMetadata(),byId=new Map(visible.map(e=>[e.emailId,e]));
        const grouped=groupConversations(visible);
        const list=grouped.groups.flatMap(group=>{
            const members=scopeMail(group.map(id=>byId.get(id)),p,starred).sort(newestFirst);
            if(!members.some(e=>matchesMail(e,p)))return [];
            const unreadIds=members.filter(e=>e.type===0&&e.unread===0).map(e=>e.emailId);
            return [{...members[0],conversationId:Math.min(...group),conversationCount:group.length,scopeCount:members.length,memberIds:members.map(e=>e.emailId),unreadIds,unread:unreadIds.length?0:1,isStar:members.some(e=>e.isStar)?1:0}];
        }).sort((a,b)=>Number(p.timeSort)?-newestFirst(a,b):newestFirst(a,b));
        const latestEmail=scopeMail(visible,p,starred).reduce((latest,e)=>!latest||e.emailId>latest.emailId?e:latest,null);
        return {...page(list,p),latestEmail,truncated:grouped.truncated};
    }
    function userInfo(){return {...state.users[0],permKeys:['*'],account:myAccounts()[0],accountList:myAccounts(),accountCount:myAccounts().length,domainList:state.domains.map(d=>'@'+d)};}
    function publicConfig(){return {...state.settings,...setupStatus,domainList:state.domains.map(d=>'@'+d),logoUrl:state.settings.siteLogo||'/mail-logo.svg',faviconUrl:state.settings.siteFavicon||'/favicon.svg',manifestUrl:''};}
    function page(list,p,pageKey='num'){
        const size=Math.max(1,Math.min(100,Number(p.size)||50));
        const offset=p.offset!=null?Math.max(0,Number(p.offset)||0):Math.max(0,(Number(p[pageKey])||1)-1)*size;
        return {list:list.slice(offset,offset+size),total:list.length,latestEmail:list[0]||null};
    }
    function addAccount(email,userId=1){
        email=String(email||'').trim().toLowerCase();
        if(!/^[^\s@]+@[^\s@]+$/.test(email)||!state.domains.includes(email.split('@')[1]))fail('请选择示例域名并填写有效邮箱。','Enter a valid address on a sample domain.');
        if(state.accounts.some(a=>a.email===email))fail('该示例邮箱已存在。','This sample address already exists.');
        const account={...state.accounts[0],accountId:state.nextId++,userId,email,name:email.split('@')[0],sort:0,isDefaultSend:0,allReceive:0,createTime:now()};
        state.accounts.push(account);
        return {...account,accountCount:state.accounts.filter(a=>a.userId===userId).length};
    }
    function objectUrl(blob){const url=URL.createObjectURL(blob);objects.add(url);return url;}
    function attachmentUrl(key){
        key=String(key||'').replace(/^\/api\/attachment\//,'');
        if(assets.has(key))return assets.get(key);
        if(key==='sample/project-brief.txt'){
            const url=objectUrl(new Blob(['FlareMail sample project brief\n\nSchedule: Friday, 10:00\nDeliverables: typography, layout, interaction review\nThis is sample data.\n'],{type:'text/plain'}));assets.set(key,url);return url;
        }
        return '';
    }
    async function preserveInlineImages(content){
        const images=[...String(content).matchAll(/<img\b[^>]*\bsrc=["'](blob:[^"']+)["']/gi)];
        for(const image of images){
            try{const blob=await (await fetch(image[1])).blob();content=content.replaceAll(image[1],objectUrl(blob));}catch{}
        }
        return content;
    }
    function ownsObjectUrl(url){return objects.has(url);}
    async function handle(method,url,data={},params={}){
        method=method.toUpperCase();
        if(!String(url).startsWith('/')||String(url).startsWith('//'))fail('体验模式不连接外部服务。','The experience does not connect to external services.');
        const parsed=new URL(url,'https://sample.invalid');
        const path=parsed.pathname.replace(/^\/api(?=\/)/,'');
        const p={...Object.fromEntries(parsed.searchParams),...params};
        const d=typeof data==='string'?JSON.parse(data||'{}'):(data||{});
        const key=method+' '+path;
        if (method === 'GET' && /^\/my\/webhooks\/\d+(\/deliveries)?$/.test(path)) {
            const accountId = Number(path.split('/')[3]);
            if (!myAccounts().some(a => a.accountId === accountId)) fail('邮箱不存在。', 'Mailbox not found.', 404);
            return path.endsWith('/deliveries') ? { list: [], nextBefore: null }
                : { accountId, url: '', enabled: false, mode: null, allowlist: [], hasSecret: false, revision: 0 };
        }
        if(method!=='GET' && /^\/(setting|admin|my|user|unmatched)\//.test(path) && key!=='PUT /my/locale')
            fail('体验中的设置仅供查看，语言与外观可以切换。','Settings are read-only in the experience. Language and appearance can be changed.');
        switch(key){
        case 'GET /setup/status': return clone(setupStatus);
        case 'GET /login/security': return {oauthEnabled:false,turnstileRequired:false,siteKey:''};
        case 'GET /setting/websiteConfig': return clone(publicConfig());
        case 'GET /my/loginUserInfo': return clone(userInfo());
        case 'GET /mail/identities': return {userId:1,addresses:[...new Set([state.users[0].email,...myAccounts(true).map(account=>account.email)])]};
        case 'POST /login': case 'DELETE /logout': return {};
        case 'GET /account/list': {
            const list=myAccounts().sort((a,b)=>b.sort-a.sort);
            const start=Number(p.accountId)?list.findIndex(a=>a.accountId===Number(p.accountId))+1:0;
            return clone(list.slice(start,start+(Number(p.size)||30)));
        }
        case 'POST /account/add': return clone(addAccount(d.email));
        case 'PUT /account/setName': {
            const a=required(state.accounts,'accountId',d.accountId);a.name=d.name;
            if(a.accountId===1)state.users[0].name=d.name;return {};
        }
        case 'DELETE /account/delete': case 'DELETE /user/deleteAccount': {
            const a=required(myAccounts(),'accountId',p.accountId);
            if(state.users.some(u=>u.email===a.email))fail('主邮箱保留供体验使用。','The primary mailbox is kept for the experience.');
            a.isDel=1;return {};
        }
        case 'PUT /account/setAllReceive': {
            const a=required(state.accounts,'accountId',d.accountId),next=a.allReceive?0:1;myAccounts().forEach(item=>{item.allReceive=0;});a.allReceive=next;return {};
        }
        case 'PUT /account/setForward': required(state.accounts,'accountId',d.accountId).forwardStatus=d.forwardStatus;return {};
        case 'PUT /account/setAsTop': required(state.accounts,'accountId',d.accountId).sort=Math.max(...myAccounts().slice(1).map(a=>a.sort),0)+1;return {};
        case 'PUT /account/setDefaultSend': required(myAccounts(),'accountId',d.accountId);myAccounts(true).forEach(a=>{a.isDefaultSend=a.accountId===Number(d.accountId)?1:0;});return {};
        case 'GET /account/getDefaultSend': return clone(myAccounts().find(a=>a.isDefaultSend)||myAccounts()[0]);
        case 'GET /mail-recovery/list': {
            let list=retainedTrash().map(trashRow).sort((a,b)=>b.emailId-a.emailId);
            const term=String(p.keyword||'').trim().toLowerCase();
            if(term)list=list.filter(e=>[e.subject,e.sendEmail,e.toEmail,e.text].some(v=>String(v||'').toLowerCase().includes(term)));
            return clone({...page(list,p,'page'),page:Number(p.page)||1,size:Number(p.size)||20});
        }
        case 'GET /mail-recovery/detail': return clone(trashRow(required(retainedTrash(),'emailId',p.emailId)));
        case 'POST /mail-recovery/restore': {
            const selected=selectTrash(d.emailIds);
            if(selected.some(e=>!retainedTrash().includes(e)||!trashRow(e).canRestore))fail('请先恢复原邮箱，或刷新过期邮件列表。','Restore the original mailbox first, or refresh expired messages.',409);
            selected.forEach(e=>{e.isDel=0;e.deletedAt=null;});
            return {emailIds:selected.map(e=>e.emailId),restoredCount:selected.length};
        }
        case 'POST /mail-recovery/purge': return removeTrash(selectTrash(d.emailIds));
        case 'POST /mail-recovery/empty-preview': {
            const list=trashMail().sort((a,b)=>a.emailId-b.emailId),items=list.slice(0,10000).map(e=>({id:e.emailId,deletedAt:e.deletedAt,trashRevision:e.trashRevision||0}));
            const token=crypto.randomUUID();trashSnapshots.set(token,{items,expiresAt:Date.now()+300000});
            return {token,count:items.length,total:list.length,limited:list.length>items.length};
        }
        case 'POST /mail-recovery/empty': {
            const snapshot=trashSnapshots.get(d.token),offset=d.offset||0;
            if(!snapshot||snapshot.expiresAt<=Date.now())fail('回收站预览已过期，请重新确认。','Trash snapshot expired; confirm again.',409);
            if(!Number.isSafeInteger(offset)||offset<0||offset%40)fail('无效的清空位置。','Invalid Trash cursor.');
            const items=snapshot.items.slice(offset,offset+40),selected=trashMail().filter(e=>items.some(item=>item.id===e.emailId&&item.trashRevision===(e.trashRevision||0)));
            return {...removeTrash(selected),nextOffset:offset+items.length<snapshot.items.length?offset+40:null};
        }
        case 'GET /mail-recovery/aliases': {
            const list=myAccounts(true).filter(a=>a.isDel&&a.email!==state.users[0].email).map(a=>({...a,domainActive:state.domains.includes(a.email.split('@')[1])}));
            return clone({...page(list,p,'page'),page:Number(p.page)||1,size:Number(p.size)||20});
        }
        case 'POST /mail-recovery/restore-alias': {
            const a=required(myAccounts(true).filter(a=>a.isDel&&a.email!==state.users[0].email),'accountId',d.accountId);
            if(!state.domains.includes(a.email.split('@')[1]))fail('请先启用邮箱域名。','Enable the mailbox domain first.',403);
            a.isDel=0;return {...clone(a),accountCount:myAccounts().length,accountLimit:0};
        }
        case 'GET /email/list': case 'GET /star/list': {
            if(p.view==='conversation')return clone(conversationList(p,path==='/star/list'));
            let list=visibleMail();
            if(path==='/star/list')list=list.filter(e=>e.isStar&&(!p.accountId||e.accountId===Number(p.accountId)));
            else {list=list.filter(e=>e.type===Number(p.type||0));if(!Number(p.allReceive))list=list.filter(e=>e.accountId===Number(p.accountId||1));}
            if(p.filter==='unread')list=list.filter(e=>e.unread===0);
            if(p.filter==='has_att')list=list.filter(e=>e.attachments.length);
            if(p.keyword){const term=String(p.keyword).toLowerCase();list=list.filter(e=>[e.subject,e.text,e.sendEmail,e.recipient,e.name].some(v=>String(v||'').toLowerCase().includes(term)));}
            list.sort((a,b)=>Number(p.timeSort)?a.createTime.localeCompare(b.createTime):b.createTime.localeCompare(a.createTime));
            return clone(page(list,p));
        }
        case 'GET /email/latest': return scopeMail(conversationMetadata(),{...p,type:0},false).filter(e=>e.emailId>Number(p.emailId||0)).sort((a,b)=>b.emailId-a.emailId).slice(0,20);
        case 'GET /email/delivery': return {provider:'unavailable',events:[]};
        case 'GET /email/conversation': {
            const size=p.size===undefined?20:Number(p.size);
            if(!Number.isInteger(size)||size<1||size>50)fail('无效的分页大小。','Invalid page size.');
            const visible=visibleMail();
            const anchor=required(visible,'emailId',p.emailId);
            const sorted=[...visible].sort((a,b)=>b.createTime.localeCompare(a.createTime)||b.emailId-a.emailId);
            const scanLimited=sorted.length>5000;
            const metadata=sorted.slice(0,5000);
            if(!metadata.some(e=>e.emailId===anchor.emailId))metadata.push(anchor);
            const component=findConversation(metadata,anchor.emailId);
            let rows=sorted.filter(e=>component.emailIds.includes(e.emailId));
            if(p.before){
                let cursor;
                try{cursor=JSON.parse(atob(String(p.before).replace(/-/g,'+').replace(/_/g,'/')));}catch{fail('无效的分页位置。','Invalid conversation cursor.');}
                if(typeof cursor?.createTime!=='string'||!Number.isSafeInteger(cursor?.emailId))fail('无效的分页位置。','Invalid conversation cursor.');
                rows=rows.filter(e=>e.createTime<cursor.createTime||(e.createTime===cursor.createTime&&e.emailId<cursor.emailId));
            }
            const selected=rows.slice(0,size),hasMore=rows.length>size,last=selected.at(-1);
            const nextCursor=hasMore?btoa(JSON.stringify({createTime:last.createTime,emailId:last.emailId})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null;
            return clone({anchorEmailId:anchor.emailId,anchor,messages:selected.reverse(),nextCursor,hasMore,scanLimited,truncated:component.truncated,readThroughEmailId:Math.max(...visible.map(e=>e.emailId))});
        }
        case 'PUT /email/conversation/read': {
            const boundary=Number(d.readThroughEmailId);
            if(!Number.isSafeInteger(boundary)||boundary<=0)fail('无效的阅读位置。','Invalid read boundary.');
            const visible=conversationMetadata();required(visible,'emailId',d.emailId);
            const group=groupConversations(visible).groups.find(group=>group.includes(Number(d.emailId)));
            const selected=visible.filter(e=>group.includes(e.emailId)&&e.emailId<=boundary&&e.type===0);
            selected.forEach(e=>{e.unread=1;});
            return {emailIds:selected.map(e=>e.emailId),updatedCount:selected.length};
        }
        case 'PUT /email/conversation/state': {
            if(!Array.isArray(d.emailIds)||!d.emailIds.length||d.emailIds.length>50||!['read','unread','delete','star','unstar'].includes(d.action))fail('无效的会话操作。','Invalid conversation action.');
            const visible=conversationMetadata(),grouped=groupConversations(visible),wanted=new Set();
            for(const id of ids(d.emailIds)){
                required(visible,'emailId',id);
                const group=grouped.groups.find(group=>group.includes(id));group.forEach(member=>wanted.add(member));
            }
            const selected=scopeMail(visible.filter(e=>wanted.has(e.emailId)),d.view||{},Boolean(d.view?.starred));
            for(const e of selected){
                if(d.action==='read')e.unread=1;
                if(d.action==='unread')e.unread=0;
                if(d.action==='delete')markDeleted(e);
                if(d.action==='star')e.isStar=1;
                if(d.action==='unstar')e.isStar=0;
            }
            return {emailIds:selected.map(e=>e.emailId),updatedCount:selected.length};
        }
        case 'DELETE /email/delete': visibleMail().filter(e=>ids(p.emailIds).includes(e.emailId)).forEach(markDeleted);return {};
        case 'PUT /email/read': state.emails.filter(e=>ids(d.emailIds).includes(e.emailId)).forEach(e=>{e.unread=1;});return {};
        case 'PUT /email/unread': state.emails.filter(e=>ids(d.emailIds).includes(e.emailId)).forEach(e=>{e.unread=0;});return {};
        case 'POST /star/add': required(state.emails,'emailId',d.emailId).isStar=1;return {};
        case 'DELETE /star/cancel': required(state.emails,'emailId',p.emailId).isStar=0;return {};
        case 'POST /email/send': {
            const signature=JSON.stringify(d);
            if(d.requestId&&sentRequests.has(d.requestId)){
                const previous=sentRequests.get(d.requestId);
                if(previous.signature!==signature)fail('该请求已用于另一封邮件。','This requestId was already used for a different message.',409);
                return clone(previous.email);
            }
            if(!d.receiveEmail?.length||!d.subject||!d.content)fail('请填写收件人、主题和正文。','Enter recipients, a subject, and a message.');
            const seen=new Set();
            const recipients={};
            for(const field of ['receiveEmail','cc','bcc']){
                const values=d[field]??[];
                if(!Array.isArray(values)||values.length>20)fail('收件人列表格式或人数不正确。','Invalid recipient list or count.');
                recipients[field]=values.flatMap(value=>{
                    if(typeof value!=='string'||value.trim().length>254||!isEmail(value.trim()))fail('邮箱地址格式不正确。','Invalid recipient address.');
                    const address=value.trim().toLowerCase();
                    if(seen.has(address))return [];
                    seen.add(address);return [address];
                });
            }
            if(seen.size>20)fail('收件人、抄送和密送合计最多20人。','To, Cc and Bcc can contain at most 20 recipients.');
            const account=required(myAccounts(),'accountId',d.accountId);
            const attachments=(d.attachments||[]).map(att=>{
                const key='uploads/'+state.nextId+++'/'+att.filename;
                const bytes=Uint8Array.from(atob(att.content),c=>c.charCodeAt(0));
                assets.set(key,objectUrl(new Blob([bytes],{type:att.contentType||'application/octet-stream'})));
                return {filename:att.filename,size:att.size,contentType:att.contentType,key};
            });
            const email={emailId:state.nextId++,userId:1,accountId:account.accountId,type:1,isStar:0,isDel:0,unread:1,status:2,code:'',cc:JSON.stringify(recipients.cc.map(address=>({address}))),bcc:JSON.stringify(recipients.bcc.map(address=>({address}))),subject:d.subject,content:await preserveInlineImages(d.content),text:d.text||'',sendEmail:account.email,name:d.name||account.name,recipient:JSON.stringify(recipients.receiveEmail.map(address=>({address}))),toEmail:recipients.receiveEmail[0],attachments,attList:attachments.map((att,index)=>({...att,attId:state.nextId+'-'+index})),createTime:now(),messageId:'sample-send@example.com',deliveryWarning:locale==='en'?'Simulated send. No email was delivered.':'已模拟发送，未投递真实邮件。'};
            email.messageId=`<sample-send-${email.emailId}@example.com>`;
            if(d.sendType==='reply'){
                const parent=required(state.emails.filter(e=>e.userId===1&&!e.isDel),'emailId',d.emailId);
                email.inReplyTo=parent.messageId||'';
                email.relation=[parent.relation,parent.messageId].filter(Boolean).join(' ');
            }
            state.emails.push(email);state.users[0].sendCount++;
            if(d.requestId)sentRequests.set(d.requestId,{signature,email:[email]});return clone([email]);
        }
        case 'GET /contact/list': return clone({list:state.contacts,total:state.contacts.length});
        case 'GET /contact/groups': return [...new Set(state.contacts.map(c=>c.groupName).filter(Boolean))];
        case 'GET /contact/detail': return clone(required(state.contacts,'contactId',p.contactId));
        case 'GET /contact/timeline': {
            const address=String(p.email||'').trim().toLowerCase(),size=Math.min(100,Math.max(1,Number(p.size)||50)),beforeId=Number(p.beforeId)||Infinity;
            if(!isEmail(address))fail('请输入有效邮箱。','Enter a valid email address.');
            const addresses=value=>{
                let parsed=value;
                if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{parsed=value;}}
                return (Array.isArray(parsed)?parsed:[parsed]).map(item=>String(typeof item==='string'?item:item?.address||item?.email||'').trim().toLowerCase());
            };
            const list=visibleMail().filter(e=>e.emailId<beforeId&&(e.type===0?String(e.sendEmail||'').toLowerCase()===address:[e.recipient,e.cc,e.bcc,e.toEmail].some(field=>addresses(field).includes(address))))
                .map(e=>({...e,direction:e.type===0?'in':'out'})).filter(e=>!p.direction||p.direction==='all'||e.direction===p.direction).sort((a,b)=>b.emailId-a.emailId);
            const selected=list.slice(0,size),hasMore=list.length>size;
            return clone({list:selected,hasMore,nextBeforeId:hasMore?selected.at(-1).emailId:null});
        }
        case 'POST /contact/add': {
            if(state.contacts.some(c=>c.email?.toLowerCase()===d.email?.toLowerCase()))fail('该联系人已存在。','This contact already exists.');
            const c={...d,contactId:state.nextId++,userId:1,createTime:now()};state.contacts.push(c);return clone(c);
        }
        case 'PUT /contact/update': Object.assign(required(state.contacts,'contactId',d.contactId),d);return {};
        case 'DELETE /contact/delete': state.contacts=state.contacts.filter(c=>c.contactId!==Number(d.contactId));return {};
        case 'PUT /my/locale': locale=d.locale;state.users[0].locale=d.locale;return {locale:d.locale};
        case 'PUT /my/forward': Object.assign(state.users[0],d);return {};
        case 'PUT /my/resetPassword': state.users[0].hasCliToken=false;return {};
        case 'POST /my/genCliToken': state.users[0].hasCliToken=true;return {token:'sample-only-'+state.nextId+++'-not-a-real-token'};
        case 'POST /my/revokeCliToken': state.users[0].hasCliToken=false;return {};
        case 'GET /my/reauth/status': case 'GET /setting/confirmation/status': return {...clone(state.confirmation),valid:state.reauthUntil>Date.now()};
        case 'POST /my/reauth/password':
            if(!String(d.password||'').trim())fail('请输入任意非空示例密码。','Enter any non-empty sample password.');
            state.reauthUntil=Date.now()+state.confirmation.windowMinutes*60000;return {...state.confirmation,valid:true};
        case 'GET /setting/confirmation': return clone(state.confirmation);
        case 'PUT /setting/confirmation': state.confirmation={...d,revision:state.confirmation.revision+1};return clone(state.confirmation);
        case 'GET /setting/query': return clone({...state.settings,domainList:state.domains.map(d=>'@'+d)});
        case 'PUT /setting/set': Object.assign(state.settings,d);return clone(publicConfig());
        case 'GET /admin/domains': return {domains:[...state.domains],revision:state.domainsRevision};
        case 'GET /admin/mail-delivery': return {revision:0,secretConfigured:false,webhookUrl:'https://sample.invalid/api/delivery/resend'};
        case 'GET /admin/mail-diagnostics': return {domain:p.domain||state.domains[0],enabled:true,selector:p.selector||'resend',checks:Object.fromEntries(['mx','spf','dmarc','dkim'].map(type=>[type,{status:'unavailable',records:[]}])),provider:'resend',credentialsConfigured:false,cloudflareBound:false,routingVerified:false,checkedAt:now()};
        case 'POST /admin/domains': state.domains=[...new Set([...state.domains,...d.domains])];state.domainsRevision++;return {domains:[...state.domains],revision:state.domainsRevision};
        case 'GET /setting/runtime': return clone(state.runtime);
        case 'PUT /setting/runtime':
            if(d.allowedOrigins)state.runtime.allowedOrigins=d.allowedOrigins;
            for(const field of ['oauth','turnstile'])if(d[field]){
                const value=d[field];
                if(value.issuer!==undefined)state.runtime[field].issuer=value.issuer;
                if(value.siteKey!==undefined)state.runtime[field].siteKey=value.siteKey;
                if(value.secretAction==='replace'){state.runtime[field].secretConfigured=true;if(field==='oauth')state.oauthSecret=value.secret;}
                if(value.secretAction==='clear'){state.runtime[field].secretConfigured=false;if(field==='oauth')state.oauthSecret='';}
            }
            state.runtime.revision++;return clone(state.runtime);
        case 'POST /setting/runtime/oauth-secret':
            if(!String(d.password||'').trim())fail('请输入任意非空示例密码。','Enter any non-empty sample password.');
            return {secret:state.oauthSecret};
        case 'GET /setting/oauth-provider': return clone({...state.provider,issuerReady:!!state.runtime.oauth.issuer,secretReady:state.runtime.oauth.secretConfigured});
        case 'PUT /setting/oauth-provider/enabled': state.provider.enabled=d.enabled;state.provider.revision++;return clone(state.provider);
        case 'PUT /setting/oauth-provider/clients': state.provider.clients=clone(d.clients);state.provider.revision++;return clone(state.provider);
        case 'POST /setting/brand-assets': {
            const type=d.get('type'),logo=d.get('file');
            if(type==='logo'&&logo instanceof Blob)state.settings.siteLogo=objectUrl(logo);
            if(type==='favicon'&&d.get('icon192') instanceof Blob){state.settings.siteFavicon=objectUrl(d.get('icon192'));state.settings.sitePwaIcons={icon192:state.settings.siteFavicon,icon512:objectUrl(d.get('icon512'))};}
            return clone(publicConfig());
        }
        case 'GET /admin/schema': return {
            currentVersion:{id:LATEST_SCHEMA_VERSION,label:SCHEMA_PATCH_CATALOG.at(-1).label},
            latestVersion:{id:LATEST_SCHEMA_VERSION,label:SCHEMA_PATCH_CATALOG.at(-1).label},upgradeRequired:false,pendingPatches:[],
            history:SCHEMA_PATCH_CATALOG.slice().reverse().map(p=>({...p,appliedTime:'2026-09-17 09:00:00'})),
        };
        case 'POST /admin/upgrade': return {...setupStatus,upgraded:false};
        case 'POST /admin/migrate-primary-email': fail('主邮箱迁移会改变登录身份，请在自己的邮箱实例中执行；体验账号保持不变。','Primary mailbox migration changes your sign-in identity. Use your own mailbox instance; the sample account stays available.');break;
        case 'GET /user/list': {
            let list=state.users.filter(u=>u.isDel===Number(p.isDel||0));
            if(p.status!=null&&Number(p.status)>=0)list=list.filter(u=>u.status===Number(p.status));
            if(p.email)list=list.filter(u=>u.email.includes(p.email));
            list.sort((a,b)=>Number(p.timeSort)?a.createTime.localeCompare(b.createTime):b.createTime.localeCompare(a.createTime));
            list=list.map(u=>({...u,accountCount:state.accounts.filter(a=>a.userId===u.userId).length}));
            return clone(page(list,p));
        }
        case 'POST /user/add': {
            const userId=state.nextId++,a=addAccount(d.email,userId);
            state.users.push({...state.users[1],userId,email:a.email,name:a.name,type:1,status:0,isDel:0,accountCount:1,accountNum:1,sendCount:0,createTime:now()});return {userId};
        }
        case 'DELETE /user/delete':
            if(ids(p.userIds).includes(1))fail('体验账号保留供继续使用。','The experience account is kept so you can continue exploring.');
            state.users.filter(u=>ids(p.userIds).includes(u.userId)).forEach(u=>{u.isDel=1;});return {};
        case 'PUT /user/setStatus': required(state.users,'userId',d.userId).status=d.status;return {};
        case 'PUT /user/setPwd': return {};
        case 'PUT /user/resetSendCount': required(state.users,'userId',d.userId).sendCount=0;return {};
        case 'PUT /user/updateSendLimit': required(state.users,'userId',d.userId).sendLimit=d.sendLimit;return {};
        case 'PUT /user/updateAccountLimit': required(state.users,'userId',d.userId).accountLimit=d.accountLimit;return {};
        case 'PUT /user/restore': required(state.users,'userId',d.userId).isDel=0;return {};
        case 'GET /user/allAccount': return clone(page(state.accounts.filter(a=>a.userId===Number(p.userId)),p));
        case 'POST /user/addAccount': return clone(addAccount(d.email,Number(d.userId)));
        case 'GET /setting/unmatched-policy': return {policy:state.policy};
        case 'PUT /setting/unmatched-policy': state.policy=d.policy;return {policy:state.policy};
        case 'GET /unmatched/list': return clone(page(state.unmatched,p,'page'));
        case 'GET /unmatched/detail': return clone(required(state.unmatched,'emailId',p.emailId));
        case 'DELETE /unmatched/delete': state.unmatched=state.unmatched.filter(e=>e.emailId!==Number(p.emailId));return {};
        case 'GET /oauth/bind/start': fail('Google 授权需要真实服务；在线体验不会跳转或绑定账号。','Google authorization requires a real service. This experience does not redirect or bind accounts.');break;
        case 'POST /oauth/unbind': state.users[0].googleEmail='';return {};
        default: fail('此操作需要真实邮箱服务，在线体验不执行。','This operation requires a real mailbox service and is unavailable in the online experience.');
        }
    }
    return {state,handle,userInfo,publicConfig,attachmentUrl,ownsObjectUrl,setLocale(value){locale=value;},dispose(){objects.forEach(url=>URL.revokeObjectURL(url));objects.clear();}};
}
