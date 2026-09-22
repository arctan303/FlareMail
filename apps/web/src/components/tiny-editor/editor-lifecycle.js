export function createEditorLifecycle(initialContent = '') {
  let editor = null
  let ready = false
  let pendingContent = String(initialContent || '')

  function currentContent() {
    if (!ready || !editor || typeof editor.getContent !== 'function') return pendingContent
    try {
      return editor.getContent()
    } catch {
      return pendingContent
    }
  }

  return {
    attach(instance) {
      editor = instance
      ready = false
    },
    markReady(instance = editor) {
      if (!editor || instance !== editor) return false
      ready = true
      editor?.setContent?.(pendingContent)
      return true
    },
    setExternalContent(content) {
      pendingContent = String(content || '')
      if (ready && editor && currentContent() !== pendingContent) editor.setContent(pendingContent)
    },
    recordEdit(content) {
      pendingContent = String(content || '')
    },
    getContent() {
      return currentContent()
    },
    isAttached(instance) {
      return instance === editor
    },
    clear() {
      pendingContent = ''
      if (ready) editor?.setContent?.('')
    },
    focus() {
      if (ready) editor?.focus?.()
    },
    detach() {
      pendingContent = currentContent()
      const attached = editor
      editor = null
      ready = false
      attached?.destroy?.()
      return pendingContent
    },
  }
}
