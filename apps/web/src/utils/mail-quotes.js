// A blockquote can be part of the author's message. Only explicit mail-history
// markers identify content that is safe to collapse by default.
export const QUOTE_SELECTOR = '.gmail_quote, .flaremail_quote, blockquote[type="cite"]'

// Presentation only: these rules live in the reader shadow root / editor
// stylesheet, never in the stored or serialized message HTML.
export const MAIL_QUOTE_CSS = `
  :is(.gmail_quote, .flaremail_quote, blockquote[type="cite"])
  :is(.gmail_quote, .flaremail_quote, blockquote[type="cite"], blockquote blockquote) {
    margin-left: 0 !important; margin-right: 0 !important;
    padding-left: 0 !important; padding-right: 0 !important;
    border-left: 0 !important; border-right: 0 !important;
    max-width: 100% !important;
  }
  :is(.gmail_quote, .flaremail_quote, blockquote[type="cite"])
  :is(.gmail_quote, .flaremail_quote) > .flaremail_quote_body {
    margin-left: 0 !important; padding-left: 0 !important; border-left: 0 !important;
  }
`

export function collapseMailQuotes(content, { label, onToggle = () => {} } = {}) {
  const quotes = Array.from(content.querySelectorAll(QUOTE_SELECTOR)).filter(element => {
    for (let parent = element.parentElement; parent && parent !== content; parent = parent.parentElement) {
      if (parent.matches(QUOTE_SELECTOR)) return false
    }
    return true
  })

  for (const quote of quotes) {
    quote.classList.add('gmail_quote_collapsed')
    const button = content.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = 'gmail_quote_toggle'
    button.title = label || 'Toggle quoted text'
    button.setAttribute('aria-label', button.title)
    button.setAttribute('aria-expanded', 'false')
    button.textContent = '···'
    button.addEventListener('click', event => {
      event.stopPropagation()
      const expanded = quote.classList.contains('gmail_quote_collapsed')
      quote.classList.toggle('gmail_quote_collapsed', !expanded)
      button.setAttribute('aria-expanded', String(expanded))
      onToggle()
    })
    quote.parentNode.insertBefore(button, quote)
  }
}
