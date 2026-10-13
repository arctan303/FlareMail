export function rawDraftFixture(initialDrafts = [], initialAttachments = [], {transactional = true} = {}) {
  const draftRows = new Map(initialDrafts.map(row => [row.draftId, structuredClone(row)]))
  const attachmentRows = new Map(initialAttachments.map(row => [row.draftId, structuredClone(row)]))
  let nextId = Math.max(0, ...draftRows.keys()) + 1
  function table(rows) {
    return {
      rows,
      async get(id) { return structuredClone(rows.get(id)) },
      async toArray() { return [...rows.values()].map(row => structuredClone(row)) },
      async add(value) {
        const row = structuredClone(value)
        row.draftId ??= nextId++
        if (rows.has(row.draftId)) throw new Error('Duplicate draft ID')
        rows.set(row.draftId, row)
        return row.draftId
      },
      async put(value) { rows.set(value.draftId, structuredClone(value)); return value.draftId },
      async update(id, value) {
        if (!rows.has(id)) return 0
        rows.set(id, {...rows.get(id), ...structuredClone(value)})
        return 1
      },
      async delete(id) { rows.delete(id) },
      async bulkDelete(ids) { for (const id of ids) rows.delete(id) },
    }
  }
  const raw = {draft: table(draftRows), att: table(attachmentRows), transactionCount: 0}
  if (transactional) raw.transaction = async (_mode, ...args) => {
    raw.transactionCount++
    const beforeDrafts = structuredClone(draftRows)
    const beforeAttachments = structuredClone(attachmentRows)
    try { return await args.at(-1)() } catch (error) {
      draftRows.clear()
      attachmentRows.clear()
      for (const [id, row] of beforeDrafts) draftRows.set(id, row)
      for (const [id, row] of beforeAttachments) attachmentRows.set(id, row)
      throw error
    }
  }
  return raw
}
