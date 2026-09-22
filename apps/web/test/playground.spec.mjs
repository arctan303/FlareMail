import test from 'node:test';
import assert from 'node:assert/strict';
import {browserPreviewLocale,initialPreviewLocale} from '../src/playground/locale.js';
import {createPlaygroundApi} from '../src/playground/api.js';
import {createMemoryDb} from '../src/playground/memory-db.js';

test('conversation preview keeps originals, paginates replies and includes a newly sent reply once',async()=>{
  const api=createPlaygroundApi('en');
  const before=api.state.emails.find(e=>e.emailId===999).content;
  const first=await api.handle('GET','/email/conversation',{}, {emailId:999,size:2});
  assert.deepEqual(first.messages.map(e=>e.emailId),[999,1100]);
  assert.equal(first.anchor.emailId,999);
  const older=await api.handle('GET','/email/conversation',{}, {emailId:999,size:2,before:first.nextCursor});
  assert.deepEqual(older.messages.map(e=>e.emailId),[983,991]);
  assert.equal(older.hasMore,false);
  assert.ok(older.messages.every(e=>e.type===0));
  assert.equal(first.messages.at(-1).type,1);
  const payload={requestId:'conversation-sample-reply',accountId:1,receiveEmail:['maya@example.net'],subject:'Re: Re: A few ideas for our next project',content:'<p>NEW_REPLY</p>'+before,text:'NEW_REPLY',sendType:'reply',emailId:999};
  const [sent]=await api.handle('POST','/email/send',payload);
  await api.handle('POST','/email/send',payload);
  const conversation=await api.handle('GET','/email/conversation',{}, {emailId:999});
  assert.equal(conversation.messages.length,5);
  assert.equal(conversation.messages.at(-1).emailId,sent.emailId);
  assert.equal(conversation.messages.filter(e=>e.emailId===sent.emailId).length,1);
  assert.equal(api.state.emails.find(e=>e.emailId===999).content,before);
  assert.ok(conversation.messages.at(-1).content.includes(before));
  const unrelated=await api.handle('GET','/email/conversation',{}, {emailId:1000});
  assert.equal(unrelated.messages.length,1);
  await api.handle('DELETE','/email/delete',{}, {emailIds:'991'});
  const after=await api.handle('GET','/email/conversation',{}, {emailId:999});
  assert.ok(!after.messages.some(e=>e.emailId===991));
  assert.ok(after.messages.some(e=>e.emailId===983));
});
import {renderMarkdown} from '../src/playground/markdown.js';

test('mail paging, filters, search and account scope reflect sample data',async()=>{
  const api=createPlaygroundApi('en');
  assert.equal(Object.hasOwn(api.publicConfig(),'manyEmail'),false);
  const first=await api.handle('GET','/email/list',{}, {accountId:1,size:50,type:0,offset:0});
  const second=await api.handle('GET','/email/list',{}, {accountId:1,size:50,type:0,offset:50});
  assert.equal(first.total,66);assert.equal(first.list.length,50);assert.equal(second.list.length,16);
  assert.equal(new Set([...first.list,...second.list].map(e=>e.emailId)).size,66);
  for(const [filter,predicate]of [['unread',e=>e.unread===0],['has_att',e=>e.attachments.length>0]]){
    const result=await api.handle('GET','/email/list',{}, {accountId:1,size:100,filter});
    assert.ok(result.total>0);assert.ok(result.list.every(predicate));
    if(filter==='has_att')assert.ok(result.list.every(e=>e.attList.length>0));
  }
  const search=await api.handle('GET','/email/list',{}, {accountId:1,keyword:'COFFEE'});
  assert.ok(search.list.length>0);assert.ok(search.list.every(e=>e.subject.includes('Coffee')));
  const all=await api.handle('GET','/email/list',{}, {accountId:1,allReceive:1,size:100});
  assert.equal(all.total,86);
  first.list[0].subject='modified projection';
  assert.notEqual((await api.handle('GET','/email/list',{}, {accountId:1})).list[0].subject,'modified projection');
});
test('read, star and delete operations remain consistent across queries',async()=>{
  const api=createPlaygroundApi();
  await api.handle('PUT','/email/read',{emailIds:[1000]});
  assert.equal(api.state.emails.find(e=>e.emailId===1000).unread,1);
  await api.handle('POST','/star/add',{emailId:1000});
  assert.ok((await api.handle('GET','/star/list')).list.some(e=>e.emailId===1000));
  await api.handle('DELETE','/star/cancel',{}, {emailId:1000});
  assert.ok(!(await api.handle('GET','/star/list')).list.some(e=>e.emailId===1000));
  await api.handle('DELETE','/email/delete?emailIds=1000,999');
  assert.equal((await api.handle('GET','/email/list',{}, {accountId:1})).total,64);
  assert.equal((await createPlaygroundApi().handle('GET','/email/list',{}, {accountId:1})).total,66);
});
test('simulated send creates readable mail, keeps attachments locally and deduplicates retry',async()=>{
  const api=createPlaygroundApi('en');
  const inline=URL.createObjectURL(new Blob(['image bytes'],{type:'image/png'}));
  const imageMail=await api.handle('POST','/email/send',{accountId:1,receiveEmail:['maya@example.net'],subject:'Inline image',content:'<p>Local image</p><img src="'+inline+'">'});
  const retained=imageMail[0].content.match(/src="([^"]+)"/)[1];
  assert.ok(api.ownsObjectUrl(retained));URL.revokeObjectURL(inline);
  assert.equal(await (await fetch(retained)).text(),'image bytes');
  const form={requestId:'sample-send-1',accountId:1,receiveEmail:['maya@example.net'],subject:'Testing',content:'<p>Hello</p>',text:'Hello',attachments:[{filename:'hello.txt',content:btoa('hello'),contentType:'text/plain',size:5}]};
  const sent=await api.handle('POST','/email/send',form);
  const retry=await api.handle('POST','/email/send',form);
  assert.equal(sent[0].emailId,retry[0].emailId);assert.match(sent[0].deliveryWarning,/No email was delivered/);
  const list=await api.handle('GET','/email/list',{}, {accountId:1,type:1,keyword:'Testing'});
  assert.equal(list.total,1);assert.equal(list.list[0].content,'<p>Hello</p>');
  assert.equal(sent[0].attList.length,1);assert.equal(sent[0].attList[0].key,sent[0].attachments[0].key);
  const url=api.attachmentUrl(sent[0].attList[0].key);
  assert.ok(url.startsWith('blob:'));assert.equal(await (await fetch(url)).text(),'hello');
  const sample=api.attachmentUrl('sample/project-brief.txt');
  assert.match(await (await fetch(sample)).text(),/sample project brief/);
  api.dispose();
});
test('contacts, groups and aliases support actual create/update/delete queries',async()=>{
  const api=createPlaygroundApi();
  const c=await api.handle('POST','/contact/add',{name:'Test',email:'test@example.net',groupName:'Friends'});
  await api.handle('PUT','/contact/update',{...c,remark:'edited'});
  assert.equal((await api.handle('GET','/contact/detail',{}, {contactId:c.contactId})).remark,'edited');
  assert.ok((await api.handle('GET','/contact/groups')).includes('Friends'));
  await api.handle('DELETE','/contact/delete',{contactId:c.contactId});
  assert.equal((await api.handle('GET','/contact/list')).total,4);
  const a=await api.handle('POST','/account/add',{email:'extra@example.com'});
  await api.handle('PUT','/account/setDefaultSend',{accountId:a.accountId});
  assert.equal((await api.handle('GET','/account/getDefaultSend')).email,a.email);
  await api.handle('DELETE','/account/delete',{}, {accountId:a.accountId});
  assert.equal(api.userInfo().accountCount,3);
});
test('settings stay read-only while language, schema and sample detail remain available',async()=>{
  const api=createPlaygroundApi('en'), before=structuredClone(api.state.settings);
  for(const [method,url,data] of [['PUT','/setting/set',{title:'Changed'}],['POST','/admin/domains',{domains:['other.net']}],['POST','/user/add',{email:'new@example.com'}],['DELETE','/unmatched/delete',{}],['POST','/my/genCliToken',{}]])
    await assert.rejects(api.handle(method,url,data),e=>/read-only/.test(e.message));
  assert.deepEqual(api.state.settings,before);assert.equal(api.userInfo().accountCount,3);
  await api.handle('PUT','/my/locale',{locale:'zh'});assert.equal(api.userInfo().locale,'zh');
  const unmatched=await api.handle('GET','/unmatched/list',{}, {page:1,size:1});
  assert.equal(unmatched.total,2);assert.equal(unmatched.list.length,1);
  assert.match((await api.handle('GET','/unmatched/detail',{}, {emailId:unmatched.list[0].emailId})).toEmail,/example\.com/);
  const schema=await api.handle('GET','/admin/schema');
  assert.equal(schema.currentVersion.id,schema.latestVersion.id);assert.equal(schema.pendingPatches.length,0);assert.ok(schema.history.length);
});
test('unknown operations and external origins reject instead of falling through to network',async()=>{
  const api=createPlaygroundApi('en');
  for(const url of ['/new-real-service','https://production.example/api/email/send','//production.example/api/email/send']){
    await assert.rejects(api.handle('POST',url),e=>Boolean(e.code&&e.message));
  }
  await assert.rejects(api.handle('GET','/oauth/bind/start'),e=>/does not redirect/.test(e.message));
  await api.handle('PUT','/my/locale',{locale:'zh'});
  await assert.rejects(api.handle('GET','/oauth/bind/start'),e=>/不会跳转/.test(e.message));
});
test('drafts and attachment rows persist during navigation and reset in a new instance',async()=>{
  const db=createMemoryDb('en');
  const id=await db.draft.add({subject:'Draft',createTime:Date.now(),receiveEmail:[]});
  await db.att.update(id,{attachments:[{filename:'sample.txt',content:btoa('sample')}]});
  await db.draft.update(id,{subject:'Edited draft'});
  assert.equal((await db.draft.get(id)).subject,'Edited draft');assert.equal((await db.att.get(id)).attachments.length,1);
  const list=await db.draft.orderBy('createTime').reverse().toArray();
  assert.equal(list.length,2);
  await db.draft.bulkDelete([id]);await db.att.delete(id);
  assert.equal((await db.draft.toArray()).length,1);
  assert.equal((await createMemoryDb().draft.toArray()).length,1);
});
test('Docs render headings, tables and escaped code; HTML and links cannot inject handlers',()=>{
  const result=renderMarkdown('# Title\n\n## Section\n\n| A | B |\n| - | - |\n| one | two |\n\n\`\`\`js\n<script>alert(1)</script>\n\`\`\`\n\n<script>alert(2)</script>\n\n[bad](javascript:alert(3))','en');
  assert.match(result.html,/<table>/);assert.match(result.html,/data-copy-code/);assert.match(result.html,/&lt;script&gt;/);
  assert.ok(!result.html.includes('<script>'));assert.ok(!result.html.includes('href="javascript:'));
  assert.equal(result.headings[1].id,'section-1');
});

test('member statistics render finite totals in the read-only view',async()=>{
  const api=createPlaygroundApi('en');
  for(const user of (await api.handle('GET','/user/list')).list){
    for(const pair of [['sendEmailCount','delSendEmailCount'],['receiveEmailCount','delReceiveEmailCount'],['accountCount','delAccountCount']]) assert.ok(Number.isFinite(user[pair[0]]+user[pair[1]]));
  }
});

test('preview detects primary browser language and honors explicit bilingual document links',()=>{
  for(const language of ['zh','zh-CN','zh-TW','zh-Hant-HK','ZH-hans']) assert.equal(browserPreviewLocale({language}),'zh');
  for(const language of ['en-US','ja-JP','fr-FR','de','']) assert.equal(browserPreviewLocale({language}),'en');
  assert.equal(browserPreviewLocale({languages:['ja-JP','zh-CN'],language:'zh-CN'}),'en');
  assert.equal(initialPreviewLocale('/inbox',{languages:['zh-TW']}),'zh');
  assert.equal(initialPreviewLocale('/docs/en/usage',{language:'zh-CN'}),'en');
});

test('single-mailbox and unified filters compose with search, sent and starred paging',async()=>{
 const api=createPlaygroundApi('en');
 assert.equal((await api.handle('GET','/email/list',{}, {accountId:1,allReceive:1})).total,86);
 for(const accountId of [2,3]){
  const result=await api.handle('GET','/email/list',{}, {accountId,allReceive:0});
  assert.equal(result.total,10);assert.ok(result.list.every(e=>e.accountId===accountId));
  const starred=await api.handle('GET','/star/list',{}, {accountId,size:1});
  assert.ok(starred.list.every(e=>e.accountId===accountId));assert.equal(starred.list.length,Math.min(1,starred.total));
 }
 await api.handle('POST','/email/send',{accountId:2,receiveEmail:['test@example.net'],subject:'Scoped send',content:'<p>Hello</p>'});
 assert.equal((await api.handle('GET','/email/list',{}, {accountId:1,allReceive:1,type:1})).total,2);
 const sent=await api.handle('GET','/email/list',{}, {accountId:2,allReceive:0,type:1,keyword:'Scoped'});
 assert.equal(sent.total,1);assert.equal(sent.list[0].accountId,2);
});
