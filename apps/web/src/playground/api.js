import {createSeed} from './seed.js';
import {SCHEMA_PATCH_CATALOG, LATEST_SCHEMA_VERSION} from '../../../worker/src/init/patch-catalog.js';
import {findConversation, groupConversations} from '../../../worker/src/utils/mail-conversation.js';

const clone = value => structuredClone(value);
const ids = value => (Array.isArray(value)?value:String(value??'').split(',')).map(Number);
const now = () => new Date().toISOString().replace('T',' ').slice(0,19);
export const setupStatus = {setupRequired:false,upgradeRequired:false,upgradeBlocking:false,upgradeSupported:true,currentVersion:LATEST_SCHEMA_VERSION,targetVersion:LATEST_SCHEMA_VERSION};

export function createPlaygroundApi(locale='zh') {
    const state=createSeed(locale), sentRequests=new Map(), assets=new Map(), objects=new Set();
    const fail=(zh,en,code=400)=>{throw {code,message:locale==='en'?en:zh};};
    const required=(list,key,id)=>list.find(item=>item[key]===Number(id))||fail('示例数据不存在，请刷新后重试。','Sample data not found. Refresh to start again.');
    const myAccounts=()=>state.accounts.filter(a=>a.userId===1);
    const visibleMail=()=>state.emails.filter(e=>e.userId===1&&!e.isDel&&myAccounts().some(a=>a.accountId===e.accountId&&!a.isDel));
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
        return {...page(list,p),truncated:grouped.truncated};
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
        if(method!=='GET' && /^\/(setting|admin|my|user|unmatched)\//.test(path) && key!=='PUT /my/locale')
            fail('体验中的设置仅供查看，语言与外观可以切换。','Settings are read-only in the experience. Language and appearance can be changed.');
        switch(key){
        case 'GET /setup/status': return clone(setupStatus);
        case 'GET /login/security': return {oauthEnabled:false,turnstileRequired:false,siteKey:''};
        case 'GET /setting/websiteConfig': return clone(publicConfig());
        case 'GET /my/loginUserInfo': return clone(userInfo());
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
            const a=required(state.accounts,'accountId',p.accountId);
            if(state.users.some(u=>u.email===a.email))fail('主邮箱保留供体验使用。','The primary mailbox is kept for the experience.');
            state.accounts=state.accounts.filter(item=>item!==a);state.emails=state.emails.filter(item=>item.accountId!==a.accountId);return {};
        }
        case 'PUT /account/setAllReceive': {
            const a=required(state.accounts,'accountId',d.accountId),next=a.allReceive?0:1;myAccounts().forEach(item=>{item.allReceive=0;});a.allReceive=next;return {};
        }
        case 'PUT /account/setForward': required(state.accounts,'accountId',d.accountId).forwardStatus=d.forwardStatus;return {};
        case 'PUT /account/setAsTop': required(state.accounts,'accountId',d.accountId).sort=Math.max(...myAccounts().slice(1).map(a=>a.sort),0)+1;return {};
        case 'PUT /account/setDefaultSend': myAccounts().forEach(a=>{a.isDefaultSend=a.accountId===Number(d.accountId)?1:0;});return {};
        case 'GET /account/getDefaultSend': return clone(myAccounts().find(a=>a.isDefaultSend)||myAccounts()[0]);
        case 'GET /email/list': case 'GET /star/list': {
            if(p.view==='conversation')return clone(conversationList(p,path==='/star/list'));
            let list=state.emails.filter(e=>!e.isDel&&e.userId===1);
            if(path==='/star/list')list=list.filter(e=>e.isStar&&(!p.accountId||e.accountId===Number(p.accountId)));
            else {list=list.filter(e=>e.type===Number(p.type||0));if(!Number(p.allReceive))list=list.filter(e=>e.accountId===Number(p.accountId||1));}
            if(p.filter==='unread')list=list.filter(e=>e.unread===0);
            if(p.filter==='has_att')list=list.filter(e=>e.attachments.length);
            if(p.keyword){const term=String(p.keyword).toLowerCase();list=list.filter(e=>[e.subject,e.text,e.sendEmail,e.recipient,e.name].some(v=>String(v||'').toLowerCase().includes(term)));}
            list.sort((a,b)=>Number(p.timeSort)?a.createTime.localeCompare(b.createTime):b.createTime.localeCompare(a.createTime));
            return clone(page(list,p));
        }
        case 'GET /email/latest': return [];
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
                if(d.action==='delete')e.isDel=1;
                if(d.action==='star')e.isStar=1;
                if(d.action==='unstar')e.isStar=0;
            }
            return {emailIds:selected.map(e=>e.emailId),updatedCount:selected.length};
        }
        case 'DELETE /email/delete': state.emails=state.emails.filter(e=>!ids(p.emailIds).includes(e.emailId));return {};
        case 'PUT /email/read': state.emails.filter(e=>ids(d.emailIds).includes(e.emailId)).forEach(e=>{e.unread=1;});return {};
        case 'PUT /email/unread': state.emails.filter(e=>ids(d.emailIds).includes(e.emailId)).forEach(e=>{e.unread=0;});return {};
        case 'POST /star/add': required(state.emails,'emailId',d.emailId).isStar=1;return {};
        case 'DELETE /star/cancel': required(state.emails,'emailId',p.emailId).isStar=0;return {};
        case 'POST /email/send': {
            if(d.requestId&&sentRequests.has(d.requestId))return clone(sentRequests.get(d.requestId));
            if(!d.receiveEmail?.length||!d.subject||!d.content)fail('请填写收件人、主题和正文。','Enter recipients, a subject, and a message.');
            const account=required(myAccounts(),'accountId',d.accountId);
            const attachments=(d.attachments||[]).map(att=>{
                const key='uploads/'+state.nextId+++'/'+att.filename;
                const bytes=Uint8Array.from(atob(att.content),c=>c.charCodeAt(0));
                assets.set(key,objectUrl(new Blob([bytes],{type:att.contentType||'application/octet-stream'})));
                return {filename:att.filename,size:att.size,contentType:att.contentType,key};
            });
            const email={emailId:state.nextId++,userId:1,accountId:account.accountId,type:1,isStar:0,isDel:0,unread:1,status:2,code:'',cc:'[]',bcc:'[]',subject:d.subject,content:await preserveInlineImages(d.content),text:d.text||'',sendEmail:account.email,name:d.name||account.name,recipient:JSON.stringify(d.receiveEmail.map(address=>({address}))),toEmail:d.receiveEmail[0],attachments,attList:attachments.map((att,index)=>({...att,attId:state.nextId+'-'+index})),createTime:now(),messageId:'sample-send@example.com',deliveryWarning:locale==='en'?'Simulated send. No email was delivered.':'已模拟发送，未投递真实邮件。'};
            email.messageId=`<sample-send-${email.emailId}@example.com>`;
            if(d.sendType==='reply'){
                const parent=required(state.emails.filter(e=>e.userId===1&&!e.isDel),'emailId',d.emailId);
                email.inReplyTo=parent.messageId||'';
                email.relation=[parent.relation,parent.messageId].filter(Boolean).join(' ');
            }
            state.emails.push(email);state.users[0].sendCount++;
            if(d.requestId)sentRequests.set(d.requestId,[email]);return clone([email]);
        }
        case 'GET /contact/list': return clone({list:state.contacts,total:state.contacts.length});
        case 'GET /contact/groups': return [...new Set(state.contacts.map(c=>c.groupName).filter(Boolean))];
        case 'GET /contact/detail': return clone(required(state.contacts,'contactId',p.contactId));
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
