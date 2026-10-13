import {normalizeDraftUserId, requireDraftDatabaseOwner} from './owned-draft-database.js'

function copyAttachments(attachments) {
  return Array.isArray(attachments) ? attachments.map(attachment => ({ ...attachment })) : []
}

async function withDraftTransaction(database, operation) {
  if (typeof database?.transaction === 'function') {
    return database.transaction('rw', database.draft, database.att, operation)
  }
  return operation()
}

export async function persistPendingSendDraft(database, snapshot, { userId, now = Date.now() } = {}) {
  if (!database?.draft || !database?.att) throw new Error('Draft database is unavailable')
  const owner = requireDraftDatabaseOwner(database, userId)
  if (snapshot?.userId !== undefined && normalizeDraftUserId(snapshot.userId) !== owner) {
    throw new Error('Draft belongs to another account')
  }

  const attachments = copyAttachments(snapshot?.attachments)
  const draft = {
    ...snapshot,
    userId: owner,
    updateTime: now,
    createTime: snapshot?.createTime || now,
  }
  delete draft.draftId
  delete draft.attachments

  return withDraftTransaction(database, async () => {
    let draftId = snapshot?.draftId || null
    if (draftId) {
      const existing = await database.draft.get(draftId)
      if (existing && normalizeDraftUserId(existing.userId) !== owner) {
        throw new Error('Draft belongs to another account')
      }
      // The owned facade distinguishes a genuinely deleted recovery row from
      // an existing hidden/foreign ID without exposing the foreign contents.
      const updated = await database.draft.update(draftId, draft)
      if (!updated) draftId = await database.draft.add(draft)
    } else {
      draftId = await database.draft.add(draft)
    }
    await database.att.put({ draftId, userId: owner, attachments })
    requireDraftDatabaseOwner(database, owner)
    return { ...snapshot, userId: owner, draftId, attachments }
  })
}

export async function clearPendingSendDraft(database, draftId, userId = database?.userId) {
  if (!draftId || !database?.draft || !database?.att) return
  const owner = requireDraftDatabaseOwner(database, userId)
  await withDraftTransaction(database, async () => {
    const row = await database.draft.get(draftId)
    if (!row || normalizeDraftUserId(row.userId) !== owner) return
    await database.draft.delete(draftId)
    await database.att.delete(draftId)
    requireDraftDatabaseOwner(database, owner)
  })
}

export function hasActiveSend(pendingSend, sending) {
  return Boolean(pendingSend || sending)
}

export function createSendActivityGate(isOtherwiseActive = () => false) {
  let persisting = false

  return {
    tryBeginPersistence() {
      if (persisting || isOtherwiseActive()) return false
      persisting = true
      return true
    },
    endPersistence() {
      persisting = false
    },
    isActive() {
      return persisting || Boolean(isOtherwiseActive())
    },
  }
}

export function guardPendingSendUnload(event, active) {
  if (!active) return false
  event?.preventDefault?.()
  if (event) event.returnValue = ''
  return true
}
