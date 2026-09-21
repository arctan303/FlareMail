import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearPendingSendDraft,
  createSendActivityGate,
  guardPendingSendUnload,
  hasActiveSend,
  persistPendingSendDraft,
} from '../src/db/pending-send-recovery.js'

function table() {
  const rows = new Map()
  let nextId = 1
  return {
    rows,
    async add(value) {
      const id = value.draftId || nextId++
      rows.set(id, { ...value, draftId: id })
      return id
    },
    async put(value) {
      rows.set(value.draftId, structuredClone(value))
      return value.draftId
    },
    async update(id, value) {
      if (!rows.has(id)) return 0
      rows.set(id, { ...rows.get(id), ...structuredClone(value), draftId: id })
      return 1
    },
    async delete(id) {
      rows.delete(id)
    },
  }
}

function database({ transactional = true } = {}) {
  const draft = table()
  const att = table()
  const db = { draft, att, transactionCount: 0 }
  if (transactional) {
    db.transaction = async (_mode, _draft, _att, operation) => {
      db.transactionCount += 1
      return operation()
    }
  }
  return db
}

const snapshot = {
  sendEmail: 'sender@example.com',
  receiveEmail: ['recipient@example.net'],
  subject: 'Recover me',
  content: '<p>Body</p>',
  attachments: [{ filename: 'note.txt', content: 'bm90ZQ==' }],
  requestId: 'request_recovery_0001',
}

test('pending send persists a reload-safe draft and attachments before the countdown', async () => {
  const db = database()
  const saved = await persistPendingSendDraft(db, snapshot, { userId: 7, now: 1234 })

  assert.equal(saved.draftId, 1)
  assert.equal(db.transactionCount, 1)
  assert.deepEqual(db.draft.rows.get(1), {
    sendEmail: snapshot.sendEmail,
    receiveEmail: snapshot.receiveEmail,
    subject: snapshot.subject,
    content: snapshot.content,
    requestId: snapshot.requestId,
    userId: 7,
    updateTime: 1234,
    createTime: 1234,
    draftId: 1,
  })
  assert.equal(db.draft.rows.get(1).requestId, snapshot.requestId)
  assert.deepEqual(db.att.rows.get(1), {
    draftId: 1,
    attachments: snapshot.attachments,
  })
})

test('an existing recovery draft is updated, then removed with its attachments after success', async () => {
  const db = database({ transactional: false })
  db.draft.rows.set(9, { draftId: 9, subject: 'Old' })
  db.att.rows.set(9, { draftId: 9, attachments: [] })

  const saved = await persistPendingSendDraft(db, { ...snapshot, draftId: 9 }, { userId: 7, now: 5678 })
  assert.equal(saved.draftId, 9)
  assert.equal(db.draft.rows.get(9).subject, 'Recover me')
  assert.equal(db.att.rows.get(9).attachments[0].filename, 'note.txt')

  await clearPendingSendDraft(db, 9)
  assert.equal(db.draft.rows.has(9), false)
  assert.equal(db.att.rows.has(9), false)
})

test('pending or in-flight sends block a second composer and request an unload warning', () => {
  assert.equal(hasActiveSend(null, false), false)
  assert.equal(hasActiveSend({ data: snapshot }, false), true)
  assert.equal(hasActiveSend(null, true), true)

  let prevented = false
  const event = {
    returnValue: undefined,
    preventDefault() {
      prevented = true
    },
  }
  assert.equal(guardPendingSendUnload(event, true), true)
  assert.equal(prevented, true)
  assert.equal(event.returnValue, '')

  const idleEvent = { preventDefault() { throw new Error('must not run') } }
  assert.equal(guardPendingSendUnload(idleEvent, false), false)
})

test('persistence gate synchronously blocks duplicate send, composer open, and unload', async () => {
  let releasePersistence
  const persistence = new Promise(resolve => { releasePersistence = resolve })
  let pending = null
  let sending = false
  let draftCount = 0
  let timerCount = 0
  let requestCount = 0
  const gate = createSendActivityGate(() => Boolean(pending || sending))

  async function beginSend() {
    if (!gate.tryBeginPersistence()) return false
    draftCount += 1
    await persistence
    pending = { timer: ++timerCount }
    gate.endPersistence()
    return true
  }

  const first = beginSend()
  const second = beginSend()
  assert.equal(await second, false)
  assert.equal(gate.isActive(), true)

  let prevented = false
  guardPendingSendUnload({
    preventDefault() { prevented = true },
    returnValue: undefined,
  }, gate.isActive())
  assert.equal(prevented, true)

  releasePersistence()
  assert.equal(await first, true)
  assert.equal(draftCount, 1)
  assert.equal(timerCount, 1)

  if (pending) {
    pending = null
    sending = true
    requestCount += 1
  }
  assert.equal(gate.tryBeginPersistence(), false)
  assert.equal(requestCount, 1)
})

test('an inbox recovery draft writes later edits and attachments before close', async () => {
  const db = database()
  const recovered = await persistPendingSendDraft(db, snapshot, { userId: 7, now: 1000 })
  const edited = {
    ...recovered,
    subject: 'Edited after undo',
    content: '<p>Latest body</p>',
    attachments: [{ filename: 'latest.txt', content: 'bGF0ZXN0' }],
  }

  await persistPendingSendDraft(db, edited, { userId: 7, now: 2000 })

  assert.equal(db.draft.rows.get(recovered.draftId).subject, 'Edited after undo')
  assert.equal(db.draft.rows.get(recovered.draftId).content, '<p>Latest body</p>')
  assert.equal(db.draft.rows.get(recovered.draftId).updateTime, 2000)
  assert.equal(db.att.rows.get(recovered.draftId).attachments[0].filename, 'latest.txt')
})
