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
