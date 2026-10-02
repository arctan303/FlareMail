import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLocalDrafts, deleteLocalDrafts } from '../src/db/draft-lifecycle.js'
import { createMemoryDb } from '../src/playground/memory-db.js'
import {createDraftDatabaseAccess} from '../src/db/owned-draft-database.js'
import {rawDraftFixture} from './draft-fixture.mjs'

test('explicit logout clears draft rows and draft attachment rows in one transaction', async () => {
  const raw = rawDraftFixture([{draftId: 1, userId: 7}, {draftId: 2, userId: 8}, {draftId: 3}],
    [{draftId: 1, userId: 7}, {draftId: 2, userId: 8}, {draftId: 3}])
  const database = createDraftDatabaseAccess(raw, 7)
  await clearLocalDrafts(database)
  assert.ok(raw.transactionCount > 0)
  assert.equal(await raw.draft.get(1), undefined)
  assert.equal(await raw.att.get(1), undefined)
  assert.deepEqual((await raw.draft.toArray()).map(row => row.draftId), [2, 3])
  assert.deepEqual((await raw.att.toArray()).map(row => row.draftId), [2, 3])
})

test('preview memory drafts are cleared without requiring a transaction API', async () => {
  const database = createMemoryDb()
  delete database.transaction
  await clearLocalDrafts(database)
  assert.deepEqual(await database.draft.toArray(), [])
  assert.equal(await database.att.get(1), undefined)
})

for (const transactional of [true, false]) {
  test(`selected draft deletion removes matching attachments and keeps other drafts (transaction=${transactional})`, async () => {
    const database = createMemoryDb()
    await database.draft.put({ draftId: 2, userId: 1, subject: 'Keep' })
    await database.att.put({ draftId: 2, attachments: [{ filename: 'keep.txt' }] })
    let transactions = 0
    if (transactional) database.transaction = async (mode, draft, att, operation) => {
      assert.equal(mode, 'rw')
      assert.equal(draft, database.draft)
      assert.equal(att, database.att)
      transactions++
      return operation()
    }
    await deleteLocalDrafts(database, [1, 1, undefined])
    assert.equal(await database.draft.get(1), undefined)
    assert.equal(await database.att.get(1), undefined)
    assert.equal((await database.draft.get(2)).subject, 'Keep')
    assert.equal((await database.att.get(2)).attachments[0].filename, 'keep.txt')
    assert.equal(transactions, transactional ? 1 : 0)
  })
}

test('failed draft deletion rejects instead of reporting success', async () => {
  const database = createMemoryDb()
  database.transaction = async () => { throw new Error('storage unavailable') }
  await assert.rejects(deleteLocalDrafts(database, [1]), /storage unavailable/)
  assert.ok(await database.draft.get(1))
  assert.ok(await database.att.get(1))
})
