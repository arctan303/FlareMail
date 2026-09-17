/**
 * 键盘快捷键监听器 (CHANGE-UI-UX-20260805)
 */
import { ref } from 'vue'

export const isShortcutsHelpVisible = ref(false)

const listeners = new Map()

export function registerShortcut(key, callback) {
    listeners.set(key.toLowerCase(), callback)
}

export function unregisterShortcut(key) {
    listeners.delete(key.toLowerCase())
}

export function initShortcuts() {
    window.addEventListener('keydown', handleKeyDown)
}

export function destroyShortcuts() {
    window.removeEventListener('keydown', handleKeyDown)
}

function handleKeyDown(event) {
    // 若焦点的元素是输入框、富文本或编辑区，避免截获输入字符
    const target = event.target
    const isEditing = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        target.closest('.tox') ||
        target.closest('.el-input') ||
        target.closest('.el-textarea')
    )

    if (isEditing) {
        return
    }

    // 带修饰键的组合键（Ctrl/Cmd/Alt + 字母）不触发单键快捷键，
    // 否则 Ctrl+C 复制会被误判为 'c' 而打开写邮件
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return
    }

    const key = event.key ? event.key.toLowerCase() : ''

    if (event.key === '?') {
        event.preventDefault()
        isShortcutsHelpVisible.value = !isShortcutsHelpVisible.value
        return
    }

    if (key === 'escape') {
        if (isShortcutsHelpVisible.value) {
            isShortcutsHelpVisible.value = false
            event.preventDefault()
            return
        }
    }

    if (listeners.has(key)) {
        const handler = listeners.get(key)
        handler(event)
    }
}
