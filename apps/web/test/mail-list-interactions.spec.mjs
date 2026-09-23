import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from 'vue/compiler-sfc'
import { ref, reactive, computed, nextTick } from 'vue'

// Execute the component's real setup logic with browser/services replaced by
// controlled boundaries. No copied handlers or source-string assertions.
async function mountList(overrides = {}) {
  const source = await readFile(new URL('../src/components/email-scroll/index.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const { scriptSetupAst } = compileScript(descriptor, { id: 'mail-list-test' })
  let script = descriptor.scriptSetup.content
  for (const node of [...scriptSetupAst].reverse()) {
    if (node.type === 'ImportDeclaration') script = script.slice(0, node.start) + script.slice(node.end)
  }
  const events = [], requests = [], messages = []
  const props = { type: 'email', conversationView: false, showUnread: true,
    getEmailList: async (...args) => { requests.push(args); return page(1) },
    emailDelete: async ids => { requests.push(['delete', ids]) }, ...overrides }
  const noop = () => {}
  const env = {
    ref, reactive, computed, nextTick, h: noop, watch: noop,
    onActivated: noop, onMounted: noop, onBeforeUnmount: noop, onDeactivated: noop, onUnmounted: noop,
    defineProps: () => props, defineExpose: noop, defineEmits: () => (...args) => events.push(args),
    useRoute: () => ({ query: {} }), useRouter: () => ({}),
    useEmailStore: () => ({ searchKeyword: '' }), useUiStore: () => ({}),
    useAccountStore: () => ({}), useUserStore: () => ({}),
    useElementSize: () => ({ width: ref(1000) }), useI18n: () => ({ t: key => key }),
    formatMailListTime: () => '', EmailUnreadEnum: { READ: 1, UNREAD: 0 },
    ElMessage: message => { messages.push(message); return {} },
    ElMessageBox: { confirm: async () => {} },
    DOMRect: { fromRect: value => value }, window: { innerWidth: 1000 },
    setTimeout: () => 1, clearTimeout: noop,
  }
  const api = new Function(...Object.keys(env), `${script}\nreturn { rightDelete, refreshCurrentPage, refresh, changePage, onScroll, scroll, emailList, currentPage, isRefreshing, loading };`)(...Object.values(env))
  api.scroll.value = { scrollTop: 0 }
  await settle()
  return { ...api, events, requests, messages }
}
function page(id) { return { list: [{ emailId: id, text: 'mail' }], total: 100 } }
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve() }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('draft row deletion targets the local draft instead of the server email API', async () => {
  const list = await mountList({ type: 'draft', getEmailList: async () => ({ list: [{ draftId: 9, text: 'draft' }], total: 1 }) })
  await list.rightDelete(list.emailList[0])
  await settle()
  assert.deepEqual(list.events, [['delete-draft', [9]]])
  assert.deepEqual(list.requests, [])
})

for (const action of ['next page', 'manual refresh']) {
  test(`${action} takes priority over an in-flight background refresh`, async () => {
    const background = deferred(), calls = []
    const list = await mountList({ getEmailList: async (_id, _size, pageIndex) => {
      calls.push(pageIndex)
      return calls.length === 2 ? background.promise : page(calls.length)
    } })
    const pending = list.refreshCurrentPage()
    if (action === 'next page') list.changePage(1)
    else list.refresh()
    await settle()
    assert.equal(calls.length, 3)
    assert.equal(list.currentPage.value, action === 'next page' ? 1 : 0)
    assert.equal(list.emailList[0].emailId, 3)
    background.resolve(page(2))
    await pending
    assert.equal(list.emailList[0].emailId, 3)
    assert.equal(list.isRefreshing.value, false)
  })
}

test('background refresh preserves scrolling performed while its request was pending', async () => {
  const background = deferred(); let calls = 0
  const list = await mountList({ getEmailList: async () => ++calls === 2 ? background.promise : page(1) })
  list.scroll.value.scrollTop = 100
  list.onScroll({ target: list.scroll.value })
  const pending = list.refreshCurrentPage()
  list.scroll.value.scrollTop = 450
  list.onScroll({ target: list.scroll.value })
  background.resolve(page(2))
  await pending
  assert.equal(list.scroll.value.scrollTop, 450)
})
