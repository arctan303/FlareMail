import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLocalDrafts } from '../src/db/draft-lifecycle.js'

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
