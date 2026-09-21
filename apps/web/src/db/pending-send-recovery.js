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

  const attachments = copyAttachments(snapshot?.attachments)
  const draft = {
    ...snapshot,
    userId,
    updateTime: now,
    createTime: snapshot?.createTime || now,
  }
  delete draft.draftId
  delete draft.attachments

  return withDraftTransaction(database, async () => {
    let draftId = snapshot?.draftId || null
    if (draftId) {
      const updated = await database.draft.update(draftId, draft)
      if (!updated) draftId = await database.draft.add(draft)
    } else {
      draftId = await database.draft.add(draft)
    }
    await database.att.put({ draftId, attachments })
    return { ...snapshot, draftId, attachments }
  })
}

export async function clearPendingSendDraft(database, draftId) {
  if (!draftId || !database?.draft || !database?.att) return
  await withDraftTransaction(database, async () => {
    await database.draft.delete(draftId)
    await database.att.delete(draftId)
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
