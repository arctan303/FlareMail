import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationSubject } from '../src/utils/mail-conversation.js'
import { normalizeConversationSubject } from '../../worker/src/utils/mail-conversation.js'

test('conversation heading strips only leading reply prefixes without changing original subjects', () => {
  assert.equal(conversationSubject(' Re: 回复：RE[2]: 项目评审 '), '项目评审')
  assert.equal(conversationSubject('回覆: 答复：Project update'), 'Project update')
  for (const subject of ['Report: details','Project Re: details','Fwd: Project','【项目】Re: details','<b>Project</b>']) {
    assert.equal(conversationSubject(subject), subject)
  }
  assert.equal(conversationSubject(' Re: 回复： '), '')
  assert.equal(conversationSubject(''), '')
  assert.equal(conversationSubject(null), '')
  const mail={subject:'Re: 原始主题'}
  assert.equal(conversationSubject(mail.subject),'原始主题')
  assert.equal(mail.subject,'Re: 原始主题')
})
test('web and worker normalize conversation subjects with the same prefix rules', () => {
  for (const subject of [' Re: 回复：RE[2]: 项目评审 ', '回覆: 答复：Project update', 'Fwd: Re: Project', 'Re:', 'Project Re: details']) {
    assert.equal(conversationSubject(subject), normalizeConversationSubject(subject).subject)
  }
})
import { applyConversationRead, applyReadIdsToMessages, conversationAllowsUnread, conversationMemberIds, conversationSnippet, createConversationRequestGate, initialExpandedIds, mergeConversationMessages } from '../src/utils/mail-conversation.js'

test('conversation pages merge without duplicates and remain chronological', () => {
  const merged = mergeConversationMessages([{emailId:3,createTime:'2026-01-03'}], [{emailId:1,createTime:'2026-01-01'},{emailId:2,createTime:'2026-01-02'}], {emailId:2,createTime:'2026-01-02',subject:'anchor'})
  assert.deepEqual(merged.map(item => item.emailId), [1,2,3]); assert.equal(merged[1].subject, 'anchor')
})
test('initial view expands only the latest message', () => {
  assert.deepEqual([...initialExpandedIds([{emailId:1},{emailId:2}],1)], [2]); assert.deepEqual([...initialExpandedIds([{emailId:1},{emailId:2}],2)], [2])
})
test('stale requests cannot replace a newer anchor', () => {
  const gate=createConversationRequestGate(), first=gate.begin(1), second=gate.begin(2)
  assert.equal(gate.isCurrent(first,1),false); assert.equal(gate.isCurrent(second,2),true); assert.equal(gate.isCurrent(second,1),false)
})
test('paging does not invalidate a pending read result, while changing anchor does', () => {
  const pageGate = createConversationRequestGate(), readGate = createConversationRequestGate()
  const read = readGate.begin(7)
  pageGate.begin(7)
  pageGate.begin(7)
  assert.equal(readGate.isCurrent(read, 7), true)
  readGate.begin(8)
  assert.equal(readGate.isCurrent(read, 7), false)
})
test('confirmed reads are reapplied after a stale page snapshot is merged', () => {
  const messages = mergeConversationMessages([{ emailId: 2, unread: 1 }], [{ emailId: 1, unread: 0 }, { emailId: 2, unread: 0 }])
  applyReadIdsToMessages(messages, new Set([1, 2]))
  assert.deepEqual(messages.map(message => message.unread), [1, 1])
})
test('collapsed summaries derive safe compact text', () => assert.equal(conversationSnippet({content:'<p>Hello &amp; <b>world</b></p>'}),'Hello & world'))
test('conversation read handling requires an explicit opt-in and a received message', () => {
  assert.equal(conversationAllowsUnread(true, {type:0}), true)
  assert.equal(conversationAllowsUnread(false, {type:0}), false)
  assert.equal(conversationAllowsUnread(true, {type:1}), false)
})
test('conversation member operations deduplicate ids and read updates clear only matching rows', () => {
  assert.deepEqual(conversationMemberIds({emailId:9,memberIds:[2,2,3]}), [2,3])
  const rows=[{unread:0,unreadIds:[2,3]},{unread:0,unreadIds:[4]}]
  applyConversationRead(rows,[2,3]); assert.equal(rows[0].unread,1); assert.equal(rows[1].unread,0)
})
