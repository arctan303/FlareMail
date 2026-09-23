export async function clearLocalDrafts(database) {
  if (!database?.draft?.clear || !database?.att?.clear) return
  const clearTables = () => Promise.all([
    database.draft.clear(),
    database.att.clear(),
  ])
  if (typeof database.transaction === 'function') {
    await database.transaction('rw', database.draft, database.att, clearTables)
    return
  }
  await clearTables()
}

export async function deleteLocalDrafts(database, draftIds) {
  const ids = [...new Set(draftIds)].filter(id => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return
  const remove = () => Promise.all([
    database.draft.bulkDelete(ids),
    database.att.bulkDelete(ids),
  ])
  if (typeof database.transaction === 'function') {
    await database.transaction('rw', database.draft, database.att, remove)
  } else {
    await remove()
  }
}
