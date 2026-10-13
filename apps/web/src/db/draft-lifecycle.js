import {normalizeDraftUserId, requireDraftDatabaseOwner} from './owned-draft-database.js'

export async function clearLocalDrafts(database, userId = database?.userId) {
  if (!database?.draft || !database?.att) return
  const owner = requireDraftDatabaseOwner(database, userId)
  const clearTables = async () => {
    // Select rows rather than clearing an entire store: even a malformed or
    // interrupted migration must not delete another owner's or hidden rows.
    const rows = await database.draft.toArray()
    const ids = rows.filter(row => normalizeDraftUserId(row.userId) === owner).map(row => row.draftId)
    await database.att.bulkDelete(ids)
    await database.draft.bulkDelete(ids)
    requireDraftDatabaseOwner(database, owner)
  }
  if (typeof database.transaction === 'function') {
    await database.transaction('rw', database.draft, database.att, clearTables)
    return
  }
  await clearTables()
}

export async function deleteLocalDrafts(database, draftIds, userId = database?.userId) {
  const owner = requireDraftDatabaseOwner(database, userId)
  const ids = [...new Set(draftIds)].filter(id => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return
  const remove = async () => {
    const owned = []
    for (const id of ids) {
      const row = await database.draft.get(id)
      if (normalizeDraftUserId(row?.userId) === owner) owned.push(id)
    }
    await database.att.bulkDelete(owned)
    await database.draft.bulkDelete(owned)
    requireDraftDatabaseOwner(database, owner)
  }
  if (typeof database.transaction === 'function') {
    await database.transaction('rw', database.draft, database.att, remove)
  } else {
    await remove()
  }
}
