import { isDomain } from './verify-utils.js'

export function normalizeManagedDomain(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase()
}

export function normalizeDomainState(result = {}) {
  const suppliedEntries = Array.isArray(result.entries) ? result.entries : null
  const domains = [...new Set((Array.isArray(result.domains) ? result.domains : suppliedEntries?.map(entry => entry.domain) || [])
    .map(normalizeManagedDomain).filter(Boolean))]
  const byDomain = new Map((suppliedEntries || []).map(entry => [normalizeManagedDomain(entry.domain), entry.enabled === true]))
  const entries = domains.map(domain => ({ domain, enabled: suppliedEntries ? byDomain.get(domain) === true : true }))
  return {
    domains, entries, revision: result.revision ?? null,
    managementReady: result.managementReady === true,
    activeDomains: entries.filter(entry => entry.enabled).map(entry => '@' + entry.domain),
  }
}

function invalid(key) {
  throw new Error('domainManagement.' + key)
}

export function buildDomainActionRequest(draft, state) {
  if (!state?.managementReady) invalid('upgradeRequired')
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) invalid('stalePreview')
  const action = draft?.action
  const domain = normalizeManagedDomain(draft?.domain)
  if (!['rename', 'migrate', 'setEnabled', 'delete'].includes(action) || !state.entries.some(entry => entry.domain === domain)) invalid('stalePreview')
  const request = { action, domain, revision: state.revision }
  if (action === 'rename' || action === 'migrate') {
    const targetDomain = normalizeManagedDomain(draft.targetDomain)
    if (!isDomain(targetDomain) || targetDomain === domain) invalid('invalidTarget')
    const existing = state.entries.find(entry => entry.domain === targetDomain)
    if (action === 'rename' && existing) invalid('renameTargetExists')
    if (action === 'migrate' && !existing?.enabled) invalid('migrationTargetUnavailable')
    request.targetDomain = targetDomain
  }
  if (action === 'setEnabled') {
    if (typeof draft.enabled !== 'boolean') invalid('stalePreview')
    request.enabled = draft.enabled
  }
  return request
}

export function canApplyDomainPreview(preview, request) {
  return !!preview && !!request && preview.canApply === true &&
    typeof preview.fingerprint === 'string' && preview.fingerprint.length > 0 &&
    Array.isArray(preview.conflicts) && preview.conflicts.length === 0 &&
    Array.isArray(preview.blockers) && preview.blockers.length === 0 &&
    ['action', 'domain', 'targetDomain', 'enabled', 'revision'].every(key => preview[key] === request[key])
}

export function buildDomainApplyRequest(preview, request) {
  if (!canApplyDomainPreview(preview, request)) invalid('stalePreview')
  return { ...request, fingerprint: preview.fingerprint }
}

// An explicit empty list means all domains are disabled. Older API/demo data
// with no list keeps its previous behavior until domain information is known.
export function isMailboxDomainEnabled(email, ...domainLists) {
  const domains = domainLists.find(Array.isArray)
  if (!domains) return true
  const address = String(email || '').trim().toLowerCase()
  const domain = address.slice(address.lastIndexOf('@') + 1)
  return address.includes('@') && domains.some(value => normalizeManagedDomain(value) === domain)
}
