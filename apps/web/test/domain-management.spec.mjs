import test from 'node:test'
import assert from 'node:assert/strict'
import { createI18n } from 'vue-i18n'
import zh from '../src/i18n/zh.js'
import en from '../src/i18n/en.js'
import {
  normalizeDomainState, buildDomainActionRequest, canApplyDomainPreview,
  buildDomainApplyRequest, isMailboxDomainEnabled,
} from '../src/utils/domain-management.js'

const state = () => normalizeDomainState({
  domains: ['old.example', 'target.example', 'paused.example'], revision: 9, managementReady: true,
  entries: [{ domain: 'old.example', enabled: true }, { domain: 'target.example', enabled: true }, { domain: 'paused.example', enabled: false }],
})
const receipt = request => ({ ...request, accounts: [], accountCount: 0, userCount: 0, emailCount: 0, attachmentCount: 0,
  canApply: true, conflicts: [], blockers: [], fingerprint: 'server-preview-receipt' })

test('registered domains remain visible while available mailbox suffixes contain only enabled domains', () => {
  const result = state()
  assert.deepEqual(result.domains, ['old.example', 'target.example', 'paused.example'])
  assert.deepEqual(result.activeDomains, ['@old.example', '@target.example'])
  const allDisabled = normalizeDomainState({ domains: ['old.example'], entries: [{ domain: 'old.example', enabled: false }], revision: 10, managementReady: true })
  assert.deepEqual(allDisabled.activeDomains, [])
  assert.equal(allDisabled.entries.length, 1)
})

test('legacy domain responses keep addition compatible but never enable unsupported management', () => {
  const legacy = normalizeDomainState({ domains: ['old.example'], revision: 2 })
  assert.deepEqual(legacy.activeDomains, ['@old.example'])
  assert.equal(legacy.managementReady, false)
  assert.throws(() => buildDomainActionRequest({ action: 'delete', domain: 'old.example' }, legacy), /upgradeRequired/)
})

test('rename and migration send only their action fields and the current revision', () => {
  const rename = buildDomainActionRequest({ action: 'rename', domain: '@OLD.example', targetDomain: ' @NEW.example ', enabled: false, fingerprint: 'old' }, state())
  assert.deepEqual(rename, { action: 'rename', domain: 'old.example', revision: 9, targetDomain: 'new.example' })
  const migrate = buildDomainActionRequest({ action: 'migrate', domain: 'old.example', targetDomain: 'target.example' }, state())
  assert.deepEqual(migrate, { action: 'migrate', domain: 'old.example', revision: 9, targetDomain: 'target.example' })
  assert.deepEqual(buildDomainActionRequest({ action: 'setEnabled', domain: 'old.example', enabled: false, targetDomain: 'unused.example' }, state()), { action: 'setEnabled', domain: 'old.example', revision: 9, enabled: false })
  assert.deepEqual(buildDomainActionRequest({ action: 'delete', domain: 'old.example', targetDomain: 'unused.example' }, state()), { action: 'delete', domain: 'old.example', revision: 9 })
})

test('rename cannot overwrite a registered domain and migration requires an enabled target', () => {
  const action = (type, targetDomain) => buildDomainActionRequest({ action: type, domain: 'old.example', targetDomain }, state())
  assert.throws(() => action('rename', 'target.example'), /renameTargetExists/)
  assert.throws(() => action('rename', 'old.example'), /invalidTarget/)
  assert.throws(() => action('rename', 'https://new.example/path'), /invalidTarget/)
  assert.throws(() => action('migrate', 'paused.example'), /migrationTargetUnavailable/)
  assert.throws(() => action('migrate', 'unknown.example'), /migrationTargetUnavailable/)
})

test('confirmation forwards the exact server fingerprint and refuses conflicting or blocked plans', () => {
  const request = buildDomainActionRequest({ action: 'rename', domain: 'old.example', targetDomain: 'new.example' }, state())
  const preview = receipt(request)
  assert.deepEqual(buildDomainApplyRequest(preview, request), { ...request, fingerprint: 'server-preview-receipt' })
  for (const changed of [
    { canApply: false }, { conflicts: [{ email: 'me@new.example', reason: 'account_exists' }] },
    { blockers: ['mail_in_progress'] }, { fingerprint: '' }, { conflicts: undefined }, { blockers: undefined },
  ]) {
    assert.equal(canApplyDomainPreview({ ...preview, ...changed }, request), false)
    assert.throws(() => buildDomainApplyRequest({ ...preview, ...changed }, request), /stalePreview/)
  }
})

test('a stale revision, changed target or changed enabled value cannot reuse the previous confirmation', () => {
  const request = buildDomainActionRequest({ action: 'rename', domain: 'old.example', targetDomain: 'new.example' }, state())
  const preview = receipt(request)
  assert.equal(canApplyDomainPreview(preview, { ...request, revision: 10 }), false)
  assert.equal(canApplyDomainPreview(preview, { ...request, targetDomain: 'other.example' }), false)
  const disable = buildDomainActionRequest({ action: 'setEnabled', domain: 'old.example', enabled: false }, state())
  assert.equal(canApplyDomainPreview(receipt(disable), disable), true)
  assert.equal(canApplyDomainPreview(receipt(disable), { ...disable, enabled: true }), false)
})

test('sender availability preserves unknown legacy data but respects an explicit empty active-domain list', () => {
  assert.equal(isMailboxDomainEnabled('me@old.example'), true)
  assert.equal(isMailboxDomainEnabled('me@old.example', undefined, ['@old.example']), true)
  assert.equal(isMailboxDomainEnabled('me@OLD.example', ['@old.example']), true)
  assert.equal(isMailboxDomainEnabled('me@paused.example', state().activeDomains), false)
  assert.equal(isMailboxDomainEnabled('me@old.example', [], ['@old.example']), false)
  assert.equal(isMailboxDomainEnabled('me@old.example', null, []), false)
  assert.equal(isMailboxDomainEnabled('invalid-address', ['@old.example']), false)
})

test('domain management messages and interpolation compile in both languages', () => {
  const i18n = createI18n({ legacy: false, locale: 'zh', fallbackWarn: false, missingWarn: false, messages: { zh, en } })
  const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, entry]) => typeof entry === 'object' ? flatten(entry, prefix + key + '.') : [[prefix + key, entry]])
  const chinese = flatten(zh.domainManagement), english = flatten(en.domainManagement)
  assert.deepEqual(chinese.map(([key]) => key).sort(), english.map(([key]) => key).sort())
  for (const [locale, messages] of [['zh', chinese], ['en', english]]) {
    i18n.global.locale.value = locale
    for (const [key] of messages) {
      const translated = i18n.global.t('domainManagement.' + key, { shown: 50, total: 100 })
      assert.notEqual(translated, 'domainManagement.' + key)
      assert.ok(translated.length > 0)
    }
  }
})
