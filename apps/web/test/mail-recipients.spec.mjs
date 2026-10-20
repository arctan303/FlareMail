import test from 'node:test'
import assert from 'node:assert/strict'
import {replyAllContext, replyContext, composeRecipientSnapshot, loadReplyAllContext, createComposeLoadGate} from '../src/utils/compose-state.js'
import {persistPendingSendDraft} from '../src/db/pending-send-recovery.js'
import {createPlaygroundApi} from '../src/playground/api.js'
import {hasInternalForwardFailure} from '../src/utils/mail-forwarding.js'

const accounts = [{accountId: 1, email: 'me@example.com'}, {accountId: 2, email: 'alias@example.com'}]
const original = {
  type: 0, accountId: 1, toEmail: 'me@example.com', sendEmail: 'sender@example.net',
  replyTo: [{address: 'reply@example.net'}],
  recipient: JSON.stringify([{address: 'me@example.com'}, {address: 'ALIAS@example.com'}, {address: 'peer@example.net'}]),
  cc: JSON.stringify([{address: 'copy@example.net'}, {address: 'PEER@example.net'}, {address: 'additional@example.com'}]),
  bcc: JSON.stringify([{address: 'private@example.net'}]),
}

test('the fixed automatic-forwarding notice applies only to received copies',()=>{
  const message=JSON.stringify({code:'INTERNAL_FORWARD_FAILED',message:'private provider body is ignored by the UI'})
  assert.equal(hasInternalForwardFailure({type:0,message}),true)
  assert.equal(hasInternalForwardFailure({type:1,message}),false)
  assert.equal(hasInternalForwardFailure({type:0,message:'invalid json'}),false)
})

test('reply all prefers Reply-To, keeps To/Cc participants and excludes all owned identities without Bcc', () => {
  const reply = replyAllContext(original, accounts, ['additional@example.com'])
  assert.deepEqual(reply.recipients, ['reply@example.net'])
  assert.deepEqual(reply.cc, ['peer@example.net', 'copy@example.net'])
  assert.deepEqual(reply.bcc, [])
  assert.equal(reply.account.accountId, 1)
  assert.deepEqual(replyContext(original, accounts).recipients, ['reply@example.net'])
})

test('sent reply all retains original To and Cc but never restores Bcc', () => {
  const reply = replyAllContext({...original, type: 1, sendEmail: 'alias@example.com'}, accounts)
  assert.deepEqual(reply.recipients, ['peer@example.net'])
  assert.deepEqual(reply.cc, ['copy@example.net', 'additional@example.com'])
  assert.deepEqual(reply.bcc, [])
  assert.equal(reply.account.accountId, 1)
})

test('a reply addressed only to owned mailboxes promotes a public participant, never a Bcc address', () => {
  const reply = replyAllContext({...original, replyTo: [{address: 'me@example.com'}]}, accounts, ['additional@example.com'])
  assert.deepEqual(reply.recipients, ['peer@example.net'])
  assert.deepEqual(reply.cc, ['copy@example.net'])
})

test('reply all loads retained identities after refresh and excludes an alias missing from the sender picker', async () => {
  const gate = createComposeLoadGate(), epoch = gate.begin()
  const reply = await loadReplyAllContext({...original, recipient:'[{"address":"deleted@example.com"},{"address":"peer@example.net"}]'}, accounts,
    {owner:7,currentOwner:()=>7,isCurrent:()=>gate.isCurrent(epoch),loadIdentities:async()=>({userId:7,addresses:['me@example.com','alias@example.com','deleted@example.com','additional@example.com']})})
  assert.deepEqual(reply.recipients, ['reply@example.net'])
  assert.deepEqual(reply.cc, ['peer@example.net','copy@example.net'])
})

test('reply all ignores a response from a previous user or composer generation and propagates failures', async () => {
  for (const change of ['owner','compose','responseOwner']) {
    let resolve, owner=7
    const gate=createComposeLoadGate(),epoch=gate.begin()
    const pending=loadReplyAllContext(original,accounts,{owner,currentOwner:()=>owner,isCurrent:()=>gate.isCurrent(epoch),loadIdentities:()=>new Promise(done=>{resolve=done})})
    if(change==='owner')owner=8
    if(change==='compose')gate.begin()
    resolve({userId:change==='responseOwner'?8:7,addresses:['me@example.com']})
    assert.equal(await pending,null)
  }
  await assert.rejects(loadReplyAllContext(original,accounts,{owner:7,currentOwner:()=>7,isCurrent:()=>true,loadIdentities:async()=>{throw new Error('offline')}}),/offline/)
})

test('Pages retained identities include a deleted alias absent from the current mailbox picker', async () => {
  const api=createPlaygroundApi('en')
  const created=await api.handle('POST','/account/add',{email:'deleted-preview@example.com'})
  await api.handle('DELETE','/account/delete',{}, {accountId:created.accountId})
  assert.ok(!api.userInfo().accountList.some(account=>account.email===created.email))
  assert.ok((await api.handle('GET','/mail/identities')).addresses.includes(created.email))
})

test('recipient snapshots detach every role and restore older drafts with empty Cc/Bcc', () => {
  const source = {receiveEmail: ['to@example.net'], cc: ['cc@example.net'], bcc: ['secret@example.net']}
  const snapshot = composeRecipientSnapshot(source)
  source.cc.push('new@example.net')
  assert.deepEqual(snapshot.cc, ['cc@example.net'])
  assert.deepEqual(composeRecipientSnapshot({receiveEmail: ['old@example.net']}), {receiveEmail: ['old@example.net'], cc: [], bcc: []})
})

test('saved/reopened and pending-send recovery drafts preserve all recipient roles without another owner', async () => {
  const drafts = new Map(), attachments = new Map()
  const db = {userId: 7, draft: {add: async value => (drafts.set(1, structuredClone(value)), 1), get: async id => structuredClone(drafts.get(id))}, att: {put: async value => attachments.set(value.draftId, structuredClone(value))}}
  const source = {userId: 7, ...composeRecipientSnapshot({receiveEmail: ['to@example.net'], cc: ['cc@example.net'], bcc: ['secret@example.net']}), subject: 'draft', requestId: 'recipient-recovery-01', requestHash: 'payload-fixture', attachments: []}
  const saved = await persistPendingSendDraft(db, source, {userId: 7})
  const reopened = await db.draft.get(saved.draftId)
  assert.deepEqual(composeRecipientSnapshot(reopened), composeRecipientSnapshot(source))
  assert.equal(reopened.requestHash, 'payload-fixture')
  await assert.rejects(persistPendingSendDraft(db, source, {userId: 8}), /another account|owner/i)
})

test('Pages simulates Cc/Bcc, deduplicates roles and rejects a changed idempotent send without sending mail', async () => {
  const api = createPlaygroundApi('en')
  const payload = {requestId: 'recipient-preview-01', accountId: 1, receiveEmail: ['TO@example.net'], cc: ['to@example.net', 'copy@example.net'], bcc: ['copy@example.net', 'hidden@example.net'], subject: 'preview roles', content: '<p>body</p>', text: 'body'}
  const [sent] = await api.handle('POST', '/email/send', payload)
  assert.deepEqual(JSON.parse(sent.cc), [{address: 'copy@example.net'}])
  assert.deepEqual(JSON.parse(sent.bcc), [{address: 'hidden@example.net'}])
  assert.match(sent.deliveryWarning, /Simulated/)
  const [replay] = await api.handle('POST', '/email/send', payload)
  assert.equal(replay.emailId, sent.emailId)
  await assert.rejects(api.handle('POST', '/email/send', {...payload, bcc: []}), error => error.code === 409)
  await assert.rejects(api.handle('POST', '/email/send', {...payload, requestId: 'recipient-preview-02', cc: ['bad\naddress']}), error => error.code === 400)
})
