import assert from 'node:assert/strict'
import test from 'node:test'
import {createDraftDatabaseAccess, draftDatabaseName, normalizeDraftUserId} from '../src/db/owned-draft-database.js'
import {clearLocalDrafts, deleteLocalDrafts} from '../src/db/draft-lifecycle.js'
import {clearPendingSendDraft, persistPendingSendDraft} from '../src/db/pending-send-recovery.js'
import {rawDraftFixture} from './draft-fixture.mjs'

test('stable owner names support numeric serialized IDs and never depend on an email', () => {
  assert.equal(draftDatabaseName(7), draftDatabaseName('7'))
  assert.notEqual(draftDatabaseName(7), draftDatabaseName(8))
  for (const value of [undefined, null, '', 'a@example.com', -1, 0, NaN, '1.5']) {
    assert.equal(normalizeDraftUserId(value), null)
    assert.throws(() => draftDatabaseName(value), /owner/)
  }
})

test('all draft lists, opens, edits and deletions isolate foreign and hidden legacy rows', async () => {
  const raw = rawDraftFixture([
    {draftId: 1, userId: 7, subject: 'Mine', createTime: 1},
    {draftId: 2, userId: 8, subject: 'Foreign secret', createTime: 2},
    {draftId: 3, subject: 'Hidden legacy secret', createTime: 3},
  ], [
    {draftId: 1, userId: 7, attachments: ['mine']},
    {draftId: 2, userId: 8, attachments: ['foreign']},
    {draftId: 3, attachments: ['legacy']},
  ])
  const db = createDraftDatabaseAccess(raw, 7)
  assert.deepEqual((await db.draft.toArray()).map(row => row.draftId), [1])
  assert.deepEqual((await db.draft.orderBy('createTime').reverse().toArray()).map(row => row.draftId), [1])
  for (const id of [2, 3]) {
    assert.equal(await db.draft.get(id), undefined)
    assert.equal(await db.att.get(id), undefined)
    await assert.rejects(db.draft.update(id, {subject: 'Changed'}), /another account/)
    await assert.rejects(db.draft.put({draftId: id, userId: 7}), /another account/)
    await assert.rejects(db.att.put({draftId: id, userId: 7, attachments: []}), /another account/)
    await assert.rejects(db.att.update(id, {attachments: []}), /another account/)
  }
  await deleteLocalDrafts(db, [2, 3])
  await db.draft.delete(2)
  await db.att.delete(2)
  assert.equal((await raw.draft.get(2)).subject, 'Foreign secret')
  await clearLocalDrafts(db)
  assert.equal(await raw.draft.get(1), undefined)
  assert.equal(await raw.att.get(1), undefined)
  assert.deepEqual((await raw.draft.toArray()).map(row => row.draftId), [2, 3])
  assert.deepEqual((await raw.att.toArray()).map(row => row.draftId), [2, 3])
})

test('an owned parent never reveals, overwrites or deletes a foreign attachment row', async () => {
  const raw = rawDraftFixture([{draftId: 1, userId: 7}], [{draftId: 1, userId: 8, attachments: ['secret']}])
  const db = createDraftDatabaseAccess(raw, 7)
  assert.equal(await db.att.get(1), undefined)
  await assert.rejects(db.att.put({draftId: 1, attachments: []}), /another account/)
  await assert.rejects(db.att.update(1, {attachments: []}), /another account/)
  await assert.rejects(persistPendingSendDraft(db, {draftId: 1, subject: 'Edit'}, {userId: 7}), /another account/)
  assert.equal((await raw.draft.get(1)).subject, undefined, 'failed attachment write rolls back the draft edit')
  await clearLocalDrafts(db)
  assert.deepEqual((await raw.att.get(1)).attachments, ['secret'])
})

test('foreign IDs and forged snapshot owners cannot be turned into a saved recovery draft', async () => {
  const raw = rawDraftFixture([{draftId: 1, userId: 8}, {draftId: 2}])
  const db = createDraftDatabaseAccess(raw, 7)
  await assert.rejects(persistPendingSendDraft(db, {userId: 8, content: 'Foreign'}, {userId: 7}), /another account/)
  await assert.rejects(persistPendingSendDraft(db, {content: 'Mine'}, {userId: 8}), /owner/)
  for (const draftId of [1, 2]) {
    await assert.rejects(persistPendingSendDraft(db, {draftId, content: 'Changed'}, {userId: 7}), /another account/)
  }
  assert.equal((await raw.draft.toArray()).length, 2)
  const saved = await persistPendingSendDraft(db, {draftId: 999, content: 'Deleted draft recovery'}, {userId: 7})
  assert.notEqual(saved.draftId, 999)
  assert.equal((await db.draft.get(saved.draftId)).content, 'Deleted draft recovery')
  assert.equal((await db.att.get(saved.draftId)).userId, 7)
})

test('switching accounts invalidates pending reads and all ordinary old-handle writes', async () => {
  const raw = rawDraftFixture([{draftId: 1, userId: 7}], [{draftId: 1, userId: 7}])
  let resume
  const wait = new Promise(resolve => {resume = resolve})
  const get = raw.draft.get
  raw.draft.get = async id => {await wait; return get(id)}
  const db = createDraftDatabaseAccess(raw, 7)
  const pending = db.draft.get(1)
  await Promise.resolve()
  db.invalidate()
  resume()
  await assert.rejects(pending, /changed/)
  await assert.rejects(db.draft.toArray(), /changed/)
  await assert.rejects(persistPendingSendDraft(db, {content: 'Stale'}, {userId: 7}), /changed/)
  await assert.rejects(clearLocalDrafts(db), /changed/)
  assert.ok(await raw.draft.get(1))
})

test('accepted-send cleanup stays tied to the original account and same-number IDs do not cross accounts', async () => {
  const rawA = rawDraftFixture([{draftId: 1, userId: 7}], [{draftId: 1, userId: 7}])
  const rawB = rawDraftFixture([{draftId: 1, userId: 8}], [{draftId: 1, userId: 8}])
  const dbA = createDraftDatabaseAccess(rawA, 7)
  const dbB = createDraftDatabaseAccess(rawB, 8)
  await clearPendingSendDraft(dbA, 1, 7)
  assert.equal(await dbA.draft.get(1), undefined)
  assert.ok(await dbB.draft.get(1))
  await assert.rejects(clearPendingSendDraft(dbB, 1, 7), /owner/)
  assert.ok(await dbB.draft.get(1))
})

test('logout invalidation aborts an in-flight recovery save before it can commit', async () => {
  const raw = rawDraftFixture([{draftId: 1, userId: 7, subject: 'Before logout'}],
    [{draftId: 1, userId: 7, attachments: ['Before logout']}])
  const db = createDraftDatabaseAccess(raw, 7)
  let entered
  let resume
  const atWrite = new Promise(resolve => {entered = resolve})
  const writeAllowed = new Promise(resolve => {resume = resolve})
  const update = raw.draft.update
  raw.draft.update = async (...args) => {entered(); await writeAllowed; return update(...args)}
  const saving = persistPendingSendDraft(db, {draftId: 1, subject: 'Late write', attachments: ['Late write']}, {userId: 7})
  await atWrite
  const cleanup = db.captureExplicitLogoutCleanup()
  db.invalidate()
  resume()
  await assert.rejects(saving, /changed/)
  assert.equal((await raw.draft.get(1)).subject, 'Before logout')
  assert.deepEqual((await raw.att.get(1)).attachments, ['Before logout'])
  await cleanup()
  assert.equal(await raw.draft.get(1), undefined)
  assert.equal(await raw.att.get(1), undefined)
})

test('captured explicit logout cleanup survives an identity switch and stays scoped to the captured owner', async () => {
  const rawA = rawDraftFixture([{draftId: 1, userId: 7}, {draftId: 2, userId: 8}, {draftId: 3}],
    [{draftId: 1, userId: 7}, {draftId: 2, userId: 8}, {draftId: 3}, {draftId: 4, userId: 7}])
  const dbA = createDraftDatabaseAccess(rawA, 7)
  const clearA = dbA.captureExplicitLogoutCleanup()
  dbA.invalidate()
  await clearA()
  assert.equal(await rawA.draft.get(1), undefined)
  assert.deepEqual((await rawA.draft.toArray()).map(row => row.draftId), [2, 3])
  assert.deepEqual((await rawA.att.toArray()).map(row => row.draftId), [2, 3])
})
