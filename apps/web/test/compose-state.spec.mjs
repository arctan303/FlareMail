import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createComposeLoadGate,
  editorSnapshot,
  findComposeAccount,
  htmlToPlainText,
  normalizeReplySubject,
  replyContext,
  replyRecipients,
  sentRecipients,
} from '../src/utils/compose-state.js'

test('reply subject normalization removes only reply prefixes and preserves forwarding semantics', () => {
  assert.equal(normalizeReplySubject(' re[12]：回复: 回覆：答复:  Project '), 'Re: Project')
  assert.equal(normalizeReplySubject('Fwd: Project'), 'Re: Fwd: Project')
  assert.equal(normalizeReplySubject('Fw：Re: Project'), 'Re: Fw：Re: Project')
  assert.equal(normalizeReplySubject(''), 'Re: ')
  assert.equal(normalizeReplySubject(' Re: 回复： '), 'Re: ')
})

test('a stale editor load cannot overwrite a newer compose action or user edit', () => {
  const gate = createComposeLoadGate()
  const firstReply = gate.begin()
  const secondReply = gate.begin()
  assert.equal(gate.isCurrent(firstReply), false)
  assert.equal(gate.isCurrent(secondReply), true)

  gate.begin()
  assert.equal(gate.isCurrent(secondReply), false)
})

test('editor snapshot keeps HTML and derives matching text when programmatic content was not emitted', () => {
  const html = '<div>Hello &amp; welcome</div><blockquote>Older<br>message</blockquote>'
  const snapshot = editorSnapshot({ getContent: () => html }, { content: '', text: '' })
  assert.equal(snapshot.content, html)
  assert.equal(snapshot.text, 'Hello & welcome\nOlder\nmessage')
  assert.equal(htmlToPlainText('<p>A</p><p>B</p>'), 'A\nB')
})

test('reply recipients accept structured Reply-To, strings, and a sender fallback', () => {
  assert.deepEqual(replyRecipients([
    { address: 'reply@example.com' },
    'second@example.com',
    { address: 'reply@example.com' },
  ], 'sender@example.com'), ['reply@example.com', 'second@example.com'])
  assert.deepEqual(replyRecipients([], 'sender@example.com'), ['sender@example.com'])
})

test('replying to sent mail targets original recipients and selects the original sender account', () => {
  const accounts = [
    { accountId: 7, email: 'me@example.com' },
    { accountId: 8, email: 'alias@example.com' },
  ]
  const context = replyContext({
    type: 1,
    accountId: '8',
    sendEmail: 'alias@example.com',
    recipient: JSON.stringify([
      { address: 'one@example.net' },
      { address: 'two@example.net' },
    ]),
  }, accounts)
  assert.deepEqual(context.recipients, ['one@example.net', 'two@example.net'])
  assert.equal(context.account.accountId, 8)
  assert.deepEqual(sentRecipients('not-json@example.net'), ['not-json@example.net'])

  const legacyContext = replyContext({
    type: 1,
    accountId: 8,
    sendEmail: 'alias@example.com',
    recipient: '[]',
    toEmail: 'legacy-recipient@example.net',
  }, accounts)
  assert.deepEqual(legacyContext.recipients, ['legacy-recipient@example.net'])
})

test('received replies prefer Reply-To and account matching tolerates persisted id types', () => {
  const accounts = [{ accountId: 9, email: 'Inbox@Example.com' }]
  const context = replyContext({
    type: 0,
    toEmail: 'inbox@example.com',
    sendEmail: 'sender@example.net',
    replyTo: [{ address: 'reply@example.net' }],
  }, accounts)
  assert.deepEqual(context.recipients, ['reply@example.net'])
  assert.equal(context.account, accounts[0])
  assert.equal(findComposeAccount(accounts, { accountId: '9' }), accounts[0])
})
