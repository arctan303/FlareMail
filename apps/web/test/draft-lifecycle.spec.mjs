import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLocalDrafts, deleteLocalDrafts } from '../src/db/draft-lifecycle.js'
import { createMemoryDb } from '../src/playground/memory-db.js'

test('explicit logout clears draft rows and draft attachment rows in one transaction', async () => {
  const calls = []
  const database = {
    draft: { clear: async () => calls.push('draft') },
    att: { clear: async () => calls.push('att') },
    async transaction(mode, draft, att, action) {
      assert.equal(mode, 'rw')
      assert.equal(draft, this.draft)
      assert.equal(att, this.att)
      calls.push('transaction')
      return action()
    },
  }

  await clearLocalDrafts(database)
  assert.deepEqual(calls, ['transaction', 'draft', 'att'])
})

test('preview memory drafts are cleared without requiring a transaction API', async () => {
  const calls = []
  await clearLocalDrafts({
    draft: { clear: async () => calls.push('draft') },
    att: { clear: async () => calls.push('att') },
  })
  assert.deepEqual(calls.sort(), ['att', 'draft'])
})

for (const transactional of [true, false]) {
  test(`selected draft deletion removes matching attachments and keeps other drafts (transaction=${transactional})`, async () => {
    const database = createMemoryDb()
    await database.draft.put({ draftId: 2, subject: 'Keep' })
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
