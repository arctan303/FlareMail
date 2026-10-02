// Shared by the mail DOM sanitizers and TinyMCE's pre-expansion AST filters.
export const CONTENT_LIMITS = Object.freeze({
    hrefLength: 8192,
    tableCells: 10000,
    cellSpan: 100,
})

export function isBoundedLink(value) {
    return typeof value === 'string' && value.trim().length <= CONTENT_LIMITS.hrefLength
}

export const DOM_TABLE_ADAPTER = Object.freeze({
    name: node => node.nodeType === 1 ? node.tagName : '',
    children: node => node.childNodes || [],
    attribute: (node, name) => node.getAttribute?.(name) ?? null,
})

const ROW_GROUPS = new Set(['THEAD', 'TBODY', 'TFOOT'])

// Match parseInt(..., 10), including numeric prefixes, without ever allocating
// from an unbounded value. Invalid/negative spans have the native default of 1.
function spanValue(value, maximum, zero = false) {
    const parsed = Number.parseInt(value, 10)
    if (parsed > maximum || parsed === Infinity) return null
    if (zero && parsed === 0) return 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

/**
 * adapter.name(node), adapter.children(node), adapter.attribute(node, name)
 * inspect an already-parsed DOM or AST. Nested tables have separate budgets.
 * A sparse rectangle and an allocation counter bound table plugin work before
 * it constructs its dense matrix, including rows created by trailing rowspans.
 */
export function tableWithinBudget(table, adapter = DOM_TABLE_ADAPTER) {
    const rows = []
    const groups = new Map()
    let columns = 0
    let cells = 0
    const pending = [{ node: table, group: table, row: null, cell: false }]

    while (pending.length) {
        let { node, group, row, cell } = pending.pop()
        const name = String(adapter.name(node) || '').toUpperCase()
        if (name === 'TABLE' && node !== table) continue
        if (ROW_GROUPS.has(name)) group = node
        if (name === 'TR') {
            // Malformed nested rows/cells are flattened rather than relying on
            // different HTML parsers to invent different table structures.
            if (row || cell || rows.length >= CONTENT_LIMITS.tableCells) return false
            const groupRows = groups.get(group) || []
            row = { node, cells: [], groupRows, groupIndex: groupRows.length }
            groupRows.push(row)
            groups.set(group, groupRows)
            rows.push(row)
        } else if (name === 'TD' || name === 'TH') {
            if (!row || cell || ++cells > CONTENT_LIMITS.tableCells) return false
            const colspan = spanValue(adapter.attribute(node, 'colspan'), CONTENT_LIMITS.cellSpan)
            const rowspan = spanValue(adapter.attribute(node, 'rowspan'), CONTENT_LIMITS.cellSpan, true)
            if (colspan === null || rowspan === null) return false
            row.cells.push({ colspan, rowspan })
            cell = true
        } else if (name === 'COL') {
            const span = spanValue(adapter.attribute(node, 'span'), CONTENT_LIMITS.tableCells)
            if (span === null || (columns += span) > CONTENT_LIMITS.tableCells) return false
        } else if (name === 'COLGROUP') {
            // Native COLGROUP span applies only when the group has no COLs.
            const hasCols = Array.from(adapter.children(node)).some(child =>
                String(adapter.name(child) || '').toUpperCase() === 'COL')
            if (!hasCols) {
                const span = spanValue(adapter.attribute(node, 'span'), CONTENT_LIMITS.tableCells)
                if (span === null || (columns += span) > CONTENT_LIMITS.tableCells) return false
            }
        }
        const children = Array.from(adapter.children(node))
        for (let index = children.length - 1; index >= 0; index--) {
            pending.push({ node: children[index], group, row, cell })
        }
    }

    let width = columns
    let height = rows.length
    let allocated = 0
    if (width * height > CONTENT_LIMITS.tableCells) return false
    const occupied = new Map()
    for (let y = 0; y < rows.length; y++) {
        const row = rows[y]
        let x = 0
        for (const cell of row.cells) {
            const rowspan = cell.rowspan === 0
                ? row.groupRows.length - row.groupIndex
                : cell.rowspan
            if (rowspan > CONTENT_LIMITS.cellSpan) return false
            const rowOccupied = occupied.get(y)
            while (rowOccupied?.has(x)) x++
            width = Math.max(width, x + cell.colspan)
            height = Math.max(height, y + rowspan)
            allocated += cell.colspan * rowspan
            if (width * height > CONTENT_LIMITS.tableCells || allocated > CONTENT_LIMITS.tableCells) return false
            for (let dy = y; dy < y + rowspan; dy++) {
                let occupiedColumns = occupied.get(dy)
                if (!occupiedColumns) occupied.set(dy, occupiedColumns = new Set())
                for (let dx = x; dx < x + cell.colspan; dx++) occupiedColumns.add(dx)
            }
            x += cell.colspan
        }
    }
    return true
}

const TEXT_LINE_BREAKS = new Set([
    'TABLE', 'CAPTION', 'TR', 'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'LI', 'DT', 'DD',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER',
])

// Call only after forbidden content has been removed. An inert text node
// makes decoded text such as "<img>" inert at every subsequent parser boundary.
export function tablePlainText(table) {
    const output = []
    const pending = [{ node: table, close: false }]
    while (pending.length) {
        const { node, close } = pending.pop()
        if (node.nodeType === 3) {
            output.push(node.textContent || '')
            continue
        }
        const name = node.nodeType === 1 ? node.tagName.toUpperCase() : ''
        if (close) {
            if (name === 'TD' || name === 'TH') output.push('\t')
            else if (TEXT_LINE_BREAKS.has(name)) output.push('\n')
            continue
        }
        if (name === 'BR' || name === 'HR') output.push('\n')
        else if (TEXT_LINE_BREAKS.has(name) && output.length && !output.at(-1).endsWith('\n')) output.push('\n')
        // The image itself is discarded; its textual alternative stays readable.
        if (name === 'IMG') output.push(node.getAttribute('alt') || '')
        pending.push({ node, close: true })
        const children = Array.from(node.childNodes || [])
        for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index], close: false })
    }
    return output.join('').replace(/\t\n/g, '\n')
}

export function downgradeOverBudgetTables(root) {
    let downgraded = 0
    // Outer-first prevents duplicate flattening of tables inside a downgraded
    // parent; a safe parent still evaluates every nested table independently.
    for (const table of Array.from(root.querySelectorAll('table'))) {
        if (!root.contains(table) || tableWithinBudget(table)) continue
        const text = table.ownerDocument.createElement('pre')
        text.setAttribute('style', 'white-space: pre-wrap')
        text.appendChild(table.ownerDocument.createTextNode(tablePlainText(table)))
        table.replaceWith(text)
        downgraded++
    }
    return downgraded
}
