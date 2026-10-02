const DATABASE_PREFIX = 'flaremail-drafts-user-'

export function normalizeDraftUserId(value) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function draftDatabaseName(userId) {
  const owner = normalizeDraftUserId(userId)
  if (!owner) throw new Error('Draft owner is unavailable')
  return `${DATABASE_PREFIX}${owner}`
}

export function requireDraftDatabaseOwner(database, userId = database?.userId) {
  const owner = normalizeDraftUserId(userId)
  if (!owner || normalizeDraftUserId(database?.userId) !== owner) {
    throw new Error('Draft owner does not match the current account')
  }
  database.assertActive?.()
  return owner
}

function belongsTo(row, owner) {
  return row && normalizeDraftUserId(row.userId) === owner
}

function isUnowned(row) {
  return row && (row.userId === undefined || row.userId === null || row.userId === '')
}

async function removeOwnedRows(raw, owner) {
  const rows = (await raw.draft.toArray()).filter(row => belongsTo(row, owner))
  for (const row of rows) {
    if (belongsTo(await raw.att.get(row.draftId), owner)) await raw.att.delete(row.draftId)
    await raw.draft.delete(row.draftId)
  }
  for (const attachment of await raw.att.toArray()) {
    if (!belongsTo(attachment, owner)) continue
    const parent = await raw.draft.get(attachment.draftId)
    if (!parent || belongsTo(parent, owner)) await raw.att.delete(attachment.draftId)
  }
}

// This facade is also used by the Pages memory adapter. No caller receives an
// unfiltered table: attachment access always checks the owning draft as well.
export function createDraftDatabaseAccess(raw, userId, { ready = Promise.resolve() } = {}) {
  const owner = normalizeDraftUserId(userId)
  let active = Boolean(owner)
  const assertActive = () => {
    if (!active) throw new Error('Draft account changed or is unavailable')
  }
  async function checked(operation) {
    await ready
    assertActive()
    const result = await operation()
    assertActive()
    return result
  }
  function transaction(operation) {
    if (typeof raw.transaction === 'function') {
      return raw.transaction('rw', raw.draft, raw.att, async () => {
        assertActive()
        const result = await operation()
        assertActive()
        return result
      })
    }
    return operation()
  }
  async function ownedDraft(id) {
    const row = await raw.draft.get(id)
    return belongsTo(row, owner) ? row : undefined
  }
  async function deleteOwnedAttachment(id) {
    if (belongsTo(await raw.att.get(id), owner)) await raw.att.delete(id)
  }
  const ownedValue = value => {
    if (!belongsTo(value, owner)) throw new Error('Draft belongs to another account')
    return { ...value, userId: owner }
  }
  const access = {
    userId: owner,
    ready,
    assertActive,
    invalidate() {
      active = false
      raw.close?.()
    },
    captureExplicitLogoutCleanup() {
      assertActive()
      return async () => {
        if (typeof raw.transaction === 'function') {
          return raw.transaction('rw', raw.draft, raw.att, () => removeOwnedRows(raw, owner))
        }
        return removeOwnedRows(raw, owner)
      }
    },
    async transaction(_mode, ...args) {
      const operation = args.at(-1)
      return checked(() => transaction(operation))
    },
  }
  access.draft = {
    get: id => checked(() => ownedDraft(id)),
    toArray: () => checked(async () => (await raw.draft.toArray()).filter(row => belongsTo(row, owner))),
    orderBy(field) {
      let reverse = false
      const query = {
        reverse() { reverse = !reverse; return query },
        async toArray() {
          const rows = await access.draft.toArray()
          return rows.sort((a, b) => reverse ? b[field] - a[field] : a[field] - b[field])
        },
      }
      return query
    },
    add: value => checked(() => transaction(() => raw.draft.add(ownedValue(value)))),
    put: value => checked(() => transaction(async () => {
      const row = ownedValue(value)
      if (row.draftId != null) {
        const previous = await raw.draft.get(row.draftId)
        if (previous && !belongsTo(previous, owner)) throw new Error('Draft belongs to another account')
      }
      return raw.draft.put(row)
    })),
    update: (id, value) => checked(() => transaction(async () => {
      const previous = await raw.draft.get(id)
      if (!previous) return 0
      if (!belongsTo(previous, owner)) throw new Error('Draft belongs to another account')
      if (value.draftId !== undefined && value.draftId !== id) throw new Error('Draft ID cannot change')
      if (value.userId !== undefined && normalizeDraftUserId(value.userId) !== owner) {
        throw new Error('Draft belongs to another account')
      }
      return raw.draft.update(id, { ...value, userId: owner })
    })),
    delete: id => checked(() => transaction(async () => {
      if (!await ownedDraft(id)) return
      await deleteOwnedAttachment(id)
      await raw.draft.delete(id)
    })),
    bulkDelete: ids => checked(() => transaction(async () => {
      for (const id of ids) {
        if (!await ownedDraft(id)) continue
        await deleteOwnedAttachment(id)
        await raw.draft.delete(id)
      }
    })),
    clear: () => checked(() => transaction(async () => {
      const rows = (await raw.draft.toArray()).filter(row => belongsTo(row, owner))
      for (const row of rows) {
        await deleteOwnedAttachment(row.draftId)
        await raw.draft.delete(row.draftId)
      }
    })),
  }
  access.att = {
    get: id => checked(async () => {
      if (!await ownedDraft(id)) return undefined
      const row = await raw.att.get(id)
      return belongsTo(row, owner) ? row : undefined
    }),
    put: value => checked(() => transaction(async () => {
      if (!await ownedDraft(value.draftId)) throw new Error('Attachment draft belongs to another account or is missing')
      if (value.userId !== undefined && normalizeDraftUserId(value.userId) !== owner) {
        throw new Error('Attachments belong to another account')
      }
      const previous = await raw.att.get(value.draftId)
      if (previous && !belongsTo(previous, owner)) throw new Error('Attachments belong to another account')
      return raw.att.put({ ...value, userId: owner })
    })),
    update: (id, value) => checked(() => transaction(async () => {
      if (!await ownedDraft(id)) throw new Error('Attachment draft belongs to another account or is missing')
      if ((value.userId !== undefined && normalizeDraftUserId(value.userId) !== owner) ||
          (value.draftId !== undefined && value.draftId !== id)) {
        throw new Error('Attachments belong to another account')
      }
      const previous = await raw.att.get(id)
      if (previous && !belongsTo(previous, owner)) throw new Error('Attachments belong to another account')
      await raw.att.put({...previous, ...value, draftId: id, userId: owner})
      return 1
    })),
    delete: id => checked(() => transaction(async () => {
      if (await ownedDraft(id)) await deleteOwnedAttachment(id)
    })),
    bulkDelete: ids => checked(() => transaction(async () => {
      for (const id of ids) if (await ownedDraft(id)) await deleteOwnedAttachment(id)
    })),
    clear: () => checked(() => transaction(async () => {
      for (const row of await raw.att.toArray()) {
        if (belongsTo(row, owner)) {
          const parent = await raw.draft.get(row.draftId)
          if (!parent || belongsTo(parent, owner)) await raw.att.delete(row.draftId)
        }
      }
    })),
  }
  return access
}

// Old releases named their database after an email. Inspect only that schema,
// never another user's stable database, and leave every source row in place.
async function openLegacyDatabase(Dexie, name) {
  if (typeof name !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(name)) return null
  if (!await Dexie.exists(name)) return null
  const source = new Dexie(name)
  try {
    await source.open()
    if (!source.tables.some(table => table.name === 'draft' && table.schema.primKey.name === 'draftId') ||
        !source.tables.some(table => table.name === 'att' && table.schema.primKey.name === 'draftId')) {
      source.close()
      return null
    }
    source.draft = source.table('draft')
    source.att = source.table('att')
    return source
  } catch (error) {
    source.close()
    throw error
  }
}

export function createOwnedDraftDatabase(Dexie, userId) {
  const owner = normalizeDraftUserId(userId)
  if (!owner) return createDraftDatabaseAccess({}, null)
  const raw = new Dexie(draftDatabaseName(owner))
  raw.version(1).stores({ draft: '++draftId,createTime,userId', att: 'draftId,userId', migration: 'key' })
  let access
  const ensureActive = () => access.assertActive()
  async function transfer(source, draftId) {
    ensureActive()
    const snapshot = await source.transaction('r', source.draft, source.att, async () => {
      const row = await source.draft.get(draftId)
      if (!belongsTo(row, owner)) return null
      const attachment = await source.att.get(draftId)
      // Legacy attachment rows did not have an owner. An explicit foreign
      // marker must still never be imported with an otherwise owned draft.
      if (attachment && !isUnowned(attachment) && !belongsTo(attachment, owner)) {
        return null
      }
      return { row, attachments: attachment?.attachments || [] }
    })
    if (!snapshot) return false
    const key = JSON.stringify([source.name, draftId])
    return raw.transaction('rw', raw.draft, raw.att, raw.migration, async () => {
      ensureActive()
      if (await raw.migration.get(key)) return false
      const value = { ...snapshot.row, userId: owner }
      delete value.draftId
      delete value.attachments
      const targetDraftId = await raw.draft.add(value)
      await raw.att.put({ draftId: targetDraftId, userId: owner, attachments: snapshot.attachments })
      await raw.migration.put({ key, targetDraftId })
      ensureActive()
      return true
    })
  }
  async function visitLegacy(operation) {
    for (const name of await Dexie.getDatabaseNames()) {
      ensureActive()
      const source = await openLegacyDatabase(Dexie, name)
      if (!source) continue
      try { await operation(source) } finally { source.close() }
    }
    ensureActive()
  }
  async function migrateOwned() {
    await visitLegacy(async source => {
      for (const row of await source.draft.toArray()) {
        if (belongsTo(row, owner)) await transfer(source, row.draftId)
      }
    })
  }
  // Defer initialization one microtask so access exists before migrations run.
  const ready = Promise.resolve().then(async () => {
    try {
      ensureActive()
      await raw.open()
      ensureActive()
      await migrateOwned()
    } catch (error) {
      raw.close()
      throw error
    }
  })
  access = createDraftDatabaseAccess(raw, owner, { ready })
  // Avoid an unhandled rejection while the user is still loading a page; each
  // operation awaits the original promise and reports the actual storage error.
  ready.catch(() => {})
  access.listLegacyUnowned = async () => {
    await ready
    await migrateOwned()
    const entries = []
    await visitLegacy(async source => {
      for (const row of await source.draft.toArray()) {
        if (!isUnowned(row)) continue
        const attachment = await source.att.get(row.draftId)
        if (attachment && !isUnowned(attachment) && !belongsTo(attachment, owner)) continue
        entries.push({ sourceName: source.name, draftId: row.draftId })
      }
    })
    return entries
  }
  access.claimLegacyDraft = async ({ sourceName, draftId }) => {
    await ready
    ensureActive()
    const source = await openLegacyDatabase(Dexie, sourceName)
    if (!source) throw new Error('Legacy draft is unavailable')
    try {
      // Source ownership is committed first. Concurrent tabs/users cannot both
      // claim this row; a failed target copy is resumed by the next migration.
      await source.transaction('rw', source.draft, source.att, async () => {
        ensureActive()
        const row = await source.draft.get(draftId)
        if (!row || (!isUnowned(row) && !belongsTo(row, owner))) {
          throw new Error('Legacy draft belongs to another account or is missing')
        }
        const attachment = await source.att.get(draftId)
        if (attachment && !isUnowned(attachment) && !belongsTo(attachment, owner)) {
          throw new Error('Legacy attachments belong to another account')
        }
        await source.draft.update(draftId, { userId: owner })
        if (attachment) await source.att.update(draftId, { userId: owner })
        ensureActive()
      })
      return await transfer(source, draftId)
    } finally { source.close() }
  }
  access.captureExplicitLogoutCleanup = () => {
    ensureActive()
    // A logout intent is captured before its HTTP request. Its narrow cleanup
    // capability remains tied to this owner even if the ordinary handle closes.
    return async () => {
      const cleanup = new Dexie(draftDatabaseName(owner))
      cleanup.version(1).stores({ draft: '++draftId,createTime,userId', att: 'draftId,userId', migration: 'key' })
      try {
        await cleanup.open()
        const sources = []
        for (const name of await Dexie.getDatabaseNames()) {
          const source = await openLegacyDatabase(Dexie, name)
          if (!source) continue
          try {
            const ids = []
            for (const row of await source.draft.toArray()) {
              if (belongsTo(row, owner)) ids.push(row.draftId)
            }
            // A source may contain only orphan attachments after an interrupted
            // old write. Its explicitly owned payload still needs logout cleanup.
            sources.push({name, ids})
          } finally { source.close() }
        }
        await cleanup.transaction('rw', cleanup.draft, cleanup.att, cleanup.migration, async () => {
          // Tombstones cover interrupted initial migrations as well as existing
          // mappings. Commit them before clearing any source payload so a
          // source storage failure cannot resurrect a cleared target draft.
          for (const {name, ids} of sources) {
            for (const id of ids) {
              const key = JSON.stringify([name, id])
              if (!await cleanup.migration.get(key)) await cleanup.migration.put({key, cleared: true})
            }
          }
          await removeOwnedRows(cleanup, owner)
        })
        const failures = []
        for (const {name, ids} of sources) {
          let source
          try {
            source = await openLegacyDatabase(Dexie, name)
            if (!source) continue
            await source.transaction('rw', source.draft, source.att, async () => {
              for (const id of ids) {
                // Ownership can change after enumeration. Recheck inside the
                // deleting transaction before touching either source table.
                if (!belongsTo(await source.draft.get(id), owner)) continue
                const attachment = await source.att.get(id)
                if (isUnowned(attachment) || belongsTo(attachment, owner)) await source.att.delete(id)
                await source.draft.delete(id)
              }
              for (const attachment of await source.att.toArray()) {
                if (!belongsTo(attachment, owner)) continue
                // Do not infer ownership from a foreign or hidden parent. Only
                // the explicit current-owner marker on an orphan permits removal.
                if (!await source.draft.get(attachment.draftId)) await source.att.delete(attachment.draftId)
              }
            })
          } catch (error) {
            failures.push(error)
          } finally { source?.close() }
        }
        if (failures.length) throw new AggregateError(failures, 'Could not clear all legacy drafts during logout')
      } finally { cleanup.close() }
    }
  }
  return access
}
