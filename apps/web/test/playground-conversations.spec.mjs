import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundApi} from '../src/playground/api.js';

function fixture() {
  const api=createPlaygroundApi('en'),base=api.state.emails[0];
  const mail=(emailId,type,accountId,parent='',extra={})=>({...base,emailId,type,accountId,subject:'Same subject',text:`Body ${emailId}`,messageId:`<thread-${emailId}@example.test>`,inReplyTo:parent,relation:'',createTime:`2026-09-22 ${String(Math.floor(emailId/60)).padStart(2,'0')}:${String(emailId%60).padStart(2,'0')}:00`,unread:type?1:0,isStar:0,...extra});
  api.state.emails=[mail(1,0,1),mail(2,1,2,'<thread-1@example.test>'),mail(3,0,1,'<thread-2@example.test>'),mail(4,0,3,'<thread-3@example.test>'),mail(5,0,1)];
  return {api,mail};
}
const list=(api,params={})=>api.handle('GET','/email/list',{}, {view:'conversation',type:0,accountId:1,allReceive:1,size:50,...params});

test('preview changed subjects split lists, reading and actions while original reply headers remain',async()=>{
  const {api,mail}=fixture();
  api.state.emails=[
    mail(1,0,1,'',{subject:'Project'}),
    mail(2,1,2,'<thread-1@example.test>',{subject:'Re: 回复：Project'}),
    mail(3,0,1,'<thread-2@example.test>',{subject:'New plan',relation:'<thread-1@example.test> <thread-2@example.test>'}),
    mail(4,0,3,'<thread-3@example.test>',{subject:'RE[2]: New plan',relation:'<thread-1@example.test> <thread-2@example.test> <thread-3@example.test>'}),
    mail(5,0,1,'',{subject:'Project'}),
    mail(6,0,1,'<thread-4@example.test>',{subject:'Re: Project',relation:'<thread-1@example.test> <thread-2@example.test> <thread-3@example.test> <thread-4@example.test>'}),
  ];
  const originals=api.state.emails.map(({emailId,subject,inReplyTo,relation})=>({emailId,subject,inReplyTo,relation}));
  const grouped=await list(api);
  assert.equal(grouped.total,4);
  assert.deepEqual(grouped.list.map(e=>e.conversationCount),[1,1,2,2]);
  const read=await api.handle('GET','/email/conversation',{}, {emailId:4});
  assert.deepEqual(read.messages.map(e=>e.emailId),[3,4]);
  await api.handle('PUT','/email/conversation/read',{emailId:4,readThroughEmailId:read.readThroughEmailId});
  assert.ok(api.state.emails.filter(e=>[1,5,6].includes(e.emailId)).every(e=>e.unread===0));
  assert.ok(api.state.emails.filter(e=>[3,4].includes(e.emailId)).every(e=>e.unread===1));
  const deleted=await api.handle('PUT','/email/conversation/state',{emailIds:[4],view:{type:0,accountId:1,allReceive:1},action:'delete'});
  assert.deepEqual(deleted.emailIds.sort(),[3,4]);
  assert.ok(api.state.emails.filter(e=>[1,2,5,6].includes(e.emailId)).every(e=>!e.isDel));
  assert.deepEqual(api.state.emails.map(({emailId,subject,inReplyTo,relation})=>({emailId,subject,inReplyTo,relation})),originals);
});

test('preview reply send joins matching subjects but edited subject starts its own conversation',async()=>{
  const {api}=fixture();
  const body='<p>A new answer</p><blockquote type="cite">Original history</blockquote>';
  const send=(emailId,subject)=>api.handle('POST','/email/send',{accountId:1,receiveEmail:['maya@example.net'],subject,content:body,sendType:'reply',emailId});
  const [same]=await send(3,'Re: 回复：Same subject');
  const old=await api.handle('GET','/email/conversation',{}, {emailId:3});
  assert.ok(old.messages.some(e=>e.emailId===same.emailId));
  const [changed]=await send(same.emailId,'Updated plan');
  const [followup]=await send(changed.emailId,'Re: Updated plan');
  const renamed=await api.handle('GET','/email/conversation',{}, {emailId:changed.emailId});
  assert.deepEqual(renamed.messages.map(e=>e.emailId),[changed.emailId,followup.emailId]);
  assert.equal(changed.inReplyTo,same.messageId);
  assert.ok(changed.relation.includes('<thread-3@example.test>'));
  assert.equal(changed.content,body);
  assert.equal(changed.subject,'Updated plan');
});

test('preview groups across sent and mailbox bridges before filtering, counting and pagination',async()=>{
  const {api}=fixture();
  const result=await list(api,{size:1});
  assert.equal(result.total,2);assert.equal(result.list[0].emailId,5);
  const second=await list(api,{size:1,offset:1});
  assert.equal(second.list[0].emailId,4);assert.equal(second.list[0].conversationCount,4);assert.equal(second.list[0].scopeCount,3);
  assert.deepEqual(second.list[0].unreadIds.sort(),[1,3,4]);
  const search=await list(api,{allReceive:0,keyword:'Body 1'});
  assert.equal(search.total,1);assert.equal(search.list[0].emailId,3);
  assert.deepEqual(search.list[0].memberIds.sort(),[1,3]);
  assert.equal((await list(api,{timeSort:1})).list[0].emailId,4);
});

test('preview opening reads folded history across mailboxes but preserves later arrivals',async()=>{
  const {api,mail}=fixture();
  const loaded=await api.handle('GET','/email/conversation',{}, {emailId:3,size:1});
  assert.equal(loaded.messages.length,1);
  api.state.emails.push(mail(6,0,1,'<thread-4@example.test>'));
  const result=await api.handle('PUT','/email/conversation/read',{emailId:3,readThroughEmailId:loaded.readThroughEmailId});
  assert.deepEqual(result.emailIds.sort(),[1,3,4]);
  assert.ok(api.state.emails.filter(e=>[1,3,4].includes(e.emailId)).every(e=>e.unread===1));
  assert.equal(api.state.emails.find(e=>e.emailId===6).unread,0);
  assert.equal((await list(api)).list[0].unread,0);
});

test('preview conversation mutations respect folder and mailbox scope including hidden matches',async()=>{
  const {api}=fixture();
  const result=await api.handle('PUT','/email/conversation/state',{emailIds:[3],view:{type:0,accountId:1,allReceive:0},action:'delete'});
  assert.deepEqual(result.emailIds.sort(),[1,3]);
  assert.ok(api.state.emails.filter(e=>[2,4,5].includes(e.emailId)).every(e=>!e.isDel));
  assert.equal((await list(api)).total,2);
});

test('preview starred conversation actions affect only starred scoped members',async()=>{
  const {api}=fixture();api.state.emails.filter(e=>[1,3,4].includes(e.emailId)).forEach(e=>{e.isStar=1;});
  const starred=await api.handle('GET','/star/list',{}, {view:'conversation',accountId:1});
  assert.equal(starred.total,1);assert.deepEqual(starred.list[0].memberIds.sort(),[1,3]);
  await api.handle('PUT','/email/conversation/state',{emailIds:[3],view:{starred:true,accountId:1},action:'unstar'});
  assert.equal(api.state.emails.find(e=>e.emailId===4).isStar,1);
  assert.equal((await api.handle('GET','/star/list',{}, {view:'conversation',accountId:1})).total,0);
});

test('preview reads beyond the reading limit and rejects oversized list scans without partial totals',async()=>{
  const {api,mail}=fixture();
  api.state.emails=Array.from({length:225},(_,index)=>mail(index+1,0,1,index?`<thread-${index}@example.test>`:''));
  const loaded=await api.handle('GET','/email/conversation',{}, {emailId:225,size:20});
  assert.equal(loaded.truncated,true);assert.equal(loaded.messages.length,20);
  await api.handle('PUT','/email/conversation/read',{emailId:225,readThroughEmailId:loaded.readThroughEmailId});
  assert.ok(api.state.emails.every(e=>e.unread===1));
  const base=api.state.emails[0];api.state.emails=Array.from({length:10001},(_,index)=>({...base,emailId:index+1}));
  await assert.rejects(list(api),error=>error.code===413);
});
