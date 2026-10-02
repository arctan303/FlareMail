import {
  CONTENT_LIMITS, isBoundedLink, tableWithinBudget, downgradeOverBudgetTables,
} from '../../../../shared/content-budgets.mjs'

const AST_ADAPTER = {
  name: node => node.name,
  children(node) {
    const children = []
    for (let child = node.firstChild; child; child = child.next) children.push(child)
    return children
  },
  attribute: (node, name) => node.attr(name),
}

function astTableText(table) {
  const output = []
  const pending = [{ node: table, close: false }]
  const breaks = new Set(['table', 'caption', 'tr', 'p', 'div', 'blockquote', 'pre', 'li',
    'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'article', 'section', 'header', 'footer'])
  while (pending.length) {
    const { node, close } = pending.pop()
    if (node.type === 3) { output.push(node.value || ''); continue }
    if (close) {
      if (node.name === 'td' || node.name === 'th') output.push('\t')
      else if (breaks.has(node.name)) output.push('\n')
      continue
    }
    if (node.name === 'br' || node.name === 'hr') output.push('\n')
    else if (breaks.has(node.name) && output.length && !output.at(-1).endsWith('\n')) output.push('\n')
    if (node.name === 'img') output.push(node.attr('alt') || '')
    pending.push({ node, close: true })
    const children = AST_ADAPTER.children(node)
    for (let i = children.length - 1; i >= 0; i--) pending.push({ node: children[i], close: false })
  }
  return output.join('').replace(/\t\n/g, '\n')
}

export function installEditorContentBudgets(editor) {
  // DOM URL setters and link dialogs also call convertURL. A null result is
  // TinyMCE's normal attribute-removal value, rather than an empty clickable URL.
  const convertURL = editor.convertURL.bind(editor)
  editor.convertURL = (value, attribute, element) => {
    if (attribute === 'href' && !isBoundedLink(value)) return null
    const converted = convertURL(value, attribute, element)
    if (attribute === 'href') {
      if (!isBoundedLink(converted)) return null
      // Browser normalization may expand Unicode, a relative path or a base.
      // Keep the same boundary as the reader and inbound mail sanitizers.
      try {
        if (!isBoundedLink(new URL(converted, editor.documentBaseURI.getURI()).toString())) return null
      } catch { /* Leave protocol/validity handling to TinyMCE's existing rules. */ }
    }
    return converted
  }

  function cleanAstLinks(nodes) {
    for (const node of nodes) {
      const href = node.attr('href')
      const remembered = node.attr('data-mce-href')
      if ((href != null && (!isBoundedLink(href) || editor.convertURL(href, 'href', 'a') == null))
          || (remembered != null && (!isBoundedLink(remembered) || editor.convertURL(remembered, 'href', 'a') == null))) {
        node.attr('href', null)
        node.attr('data-mce-href', null)
      }
    }
  }

  editor.on('PreInit', () => {
    // Node filters precede TinyMCE's src/href attribute converter and every
    // table grid consumer, including initial/source/paste/restored content.
    editor.parser.addNodeFilter('a', cleanAstLinks)
    editor.parser.addAttributeFilter('href,data-mce-href', cleanAstLinks)
    editor.serializer.addNodeFilter('a', cleanAstLinks)
    editor.parser.addNodeFilter('table', nodes => {
      for (const table of nodes) {
        if (!table.parent || tableWithinBudget(table, AST_ADAPTER)) continue
        const replacement = new window.tinymce.html.Node('pre', 1)
        replacement.attr('style', 'white-space: pre-wrap')
        const text = new window.tinymce.html.Node('#text', 3)
        text.value = astTableText(table)
        replacement.append(text)
        table.replace(replacement)
      }
    })
  })

  let cleaning = false
  function cleanDom(root = editor.getBody?.()) {
    if (!root || cleaning) return
    cleaning = true
    try {
      const links = [...(root.matches?.('a') ? [root] : []), ...root.querySelectorAll('a')]
      for (const link of links) {
        const href = link.getAttribute('href')
        const remembered = link.getAttribute('data-mce-href')
        if ((href != null && (!isBoundedLink(href) || editor.convertURL(href, 'href', link) == null))
            || (remembered != null && (!isBoundedLink(remembered) || editor.convertURL(remembered, 'href', link) == null))) {
          link.removeAttribute('href')
          link.removeAttribute('data-mce-href')
        }
      }
      // Include the root table, without cleaning unrelated sibling tables.
      const tableRoot = root.matches?.('table') ? root.parentNode : root
      if (tableRoot) downgradeOverBudgetTables(tableRoot)
    } finally { cleaning = false }
  }

  editor.on('SetAttrib', event => {
    const element = event.attrElm
    if (!element) return
    if (element.matches?.('a') && ['href', 'data-mce-href'].includes(event.attrName)
        && event.attrValue != null && !isBoundedLink(String(event.attrValue))) {
      element.removeAttribute('href')
      element.removeAttribute('data-mce-href')
    }
    cleanDom(element.closest?.('table') || element)
  }, true)
  editor.on('TableModified', event => cleanDom(event.table), true)
  editor.on('NodeChange', event => cleanDom(event.element?.closest?.('table') || event.element), true)
  editor.on('SetContent BeforeGetContent Undo Redo', () => cleanDom(), true)
  editor.on('BeforeSetContent', event => {
    // The table model pastes cells from raw HTML in this event, before the
    // ordinary insertContent parser. Run the existing parser first so its node
    // filters bound source tables before that model allocates any matrix.
    if (event.selection === true && event.paste === true && typeof event.content === 'string') {
      const ast = editor.parser.parse(event.content, { context: 'div', insert: true })
      event.content = window.tinymce.html.Serializer({}, editor.schema).serialize(ast)
    }
  }, true)
  editor.on('BeforeExecCommand', event => {
    // mceInsertTable allocates its matrix before insertContent/parser filters.
    if (event.command.toLowerCase() === 'mceinserttable') {
      const rows = event.value?.rows
      const columns = event.value?.columns
      if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns)
          || rows < 1 || columns < 1 || rows * columns > CONTENT_LIMITS.tableCells) {
        event.preventDefault()
        editor.notificationManager.open({ text: editor.translate('Table exceeds the 10000-cell limit.'), type: 'warning' })
        return
      }
    }
    cleanDom()
  }, true)
}
