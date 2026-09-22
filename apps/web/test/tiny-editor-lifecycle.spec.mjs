import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorLifecycle } from '../src/components/tiny-editor/editor-lifecycle.js'

function fakeEditor({ throwBeforeReady = false } = {}) {
  let value = ''
  let ready = !throwBeforeReady
  const calls = []
  return {
    calls,
    becomeReady() { ready = true },
    getContent() {
      calls.push('get')
      if (!ready) throw new Error('editor is not initialized')
      return value
    },
    setContent(next) { calls.push(['set', next]); value = next },
    focus() { calls.push('focus') },
    destroy() { calls.push('destroy') },
  }
}

test('pre-init component operations use pending content without touching TinyMCE', () => {
  const state = createEditorLifecycle('<p>first</p>')
  const editor = fakeEditor({ throwBeforeReady: true })
  state.attach(editor)
  assert.equal(state.getContent(), '<p>first</p>')
  state.focus()
  state.setExternalContent('<p>latest</p>')
  assert.equal(state.getContent(), '<p>latest</p>')
  assert.deepEqual(editor.calls, [])
  editor.becomeReady()
  state.markReady()
  assert.deepEqual(editor.calls, [['set', '<p>latest</p>']])
  state.clear()
  assert.equal(state.getContent(), '')
})

test('theme or language rebuild snapshots user edits and restores them after re-init', () => {
  const state = createEditorLifecycle('<p>initial</p>')
  const first = fakeEditor()
  state.attach(first)
  state.markReady()
  first.setContent('<p>typed</p>')
  state.recordEdit('<p>typed</p>')
  assert.equal(state.detach(), '<p>typed</p>')
  assert.equal(state.getContent(), '<p>typed</p>')
  assert.equal(first.calls.at(-1), 'destroy')
  const replacement = fakeEditor({ throwBeforeReady: true })
  state.attach(replacement)
  assert.equal(state.getContent(), '<p>typed</p>')
  replacement.becomeReady()
  state.markReady()
  assert.deepEqual(replacement.calls.at(-1), ['set', '<p>typed</p>'])
})

test('an external compose load during rebuild replaces the preserved snapshot', () => {
  const state = createEditorLifecycle('<p>old draft</p>')
  const first = fakeEditor()
  state.attach(first)
  state.markReady()
  first.setContent('<p>latest edit</p>')
  state.detach()
  const replacement = fakeEditor({ throwBeforeReady: true })
  state.attach(replacement)
  state.setExternalContent('<p>different message</p>')
  replacement.becomeReady()
  state.markReady()
  assert.deepEqual(replacement.calls.at(-1), ['set', '<p>different message</p>'])
})

test('a late init event from a destroyed instance cannot initialize its replacement', () => {
  const state = createEditorLifecycle('<p>preserved</p>')
  const stale = fakeEditor({ throwBeforeReady: true })
  state.attach(stale)
  state.detach()
  const replacement = fakeEditor({ throwBeforeReady: true })
  state.attach(replacement)
  stale.becomeReady()
  assert.equal(state.markReady(stale), false)
  assert.deepEqual(replacement.calls, [])
  replacement.becomeReady()
  assert.equal(state.markReady(replacement), true)
  assert.deepEqual(replacement.calls, [['set', '<p>preserved</p>']])
})
