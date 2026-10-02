import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { sanitizeEmailHtml } from '../src/utils/html-sanitizer';

function document(html) {
  return parseHTML(sanitizeEmailHtml(html)).document;
}

describe('mail HTML security boundaries', () => {
  it('normalizes mixed-case attributes before applying image, link and CSS policy', () => {
    const clean = document('<p STYLE="background-image:url(https://tracker.example/css);color:red">Visible</p><img SRC="https://tracker.example/pixel"><a HREF="javascript:alert(1)">Link</a>');
    expect(clean.querySelector('p').getAttribute('style')).toBe('color: red');
    expect(clean.querySelector('img').hasAttribute('src')).toBe(false);
    expect(clean.querySelector('img').getAttribute('data-remote-src')).toBe('https://tracker.example/pixel');
    expect(clean.querySelector('a').hasAttribute('href')).toBe(false);
  });

  it('drops ambiguous case-duplicate attributes instead of selecting a different parser value', () => {
    const clean = document('<img src="attachments/local.png" SRC="https://tracker.example/pixel"><p style="color:red" STYLE="background-image:url(https://tracker.example/css)">Text</p>');
    expect(clean.querySelector('img').hasAttribute('src')).toBe(false);
    expect(clean.querySelector('p').hasAttribute('style')).toBe(false);
    expect(clean.querySelector('p').textContent).toBe('Text');
  });

  it.each([
    'attachments/../../../oauth/authorize',
    '{{domain}}attachments/../../../login/oauth/start',
    '/api/attachment/attachments/../../../oauth/authorize',
    '/api/attachment/attachments/%2e%2e/%2e%2e/login/oauth/start',
    '/api/attachment/attachments/%2F..%2Foauth/authorize',
    '/api/attachment/attachments/%5c..%5clogin/oauth/start',
    '/api/attachment/attachments/%00bad.png',
    'attachments/%zz',
  ])('does not exempt an unsafe attachment source: %s', source => {
    expect(document(`<img src="${source}">`).querySelector('img').hasAttribute('src')).toBe(false);
  });

  it('keeps ordinary rich mail, generated and legacy attachment keys and CID images', () => {
    const clean = document('<blockquote type="cite"><b>History</b><table><tr><td colspan="2">Cell</td></tr></table></blockquote><img src="attachments/old-hash.png"><img src="{{domain}}attachments/new-hash-uuid.png"><img src="/api/attachment/attachments/hash%20name.png"><img src="cid:part@example.test">');
    expect(clean.querySelector('blockquote').getAttribute('type')).toBe('cite');
    expect(clean.querySelector('td').getAttribute('colspan')).toBe('2');
    expect(Array.from(clean.querySelectorAll('img')).every(image => image.hasAttribute('src'))).toBe(true);
  });

  it('removes browser-comment mismatches and protected comments before serializing', () => {
    for (const comment of [
      '<!-- sender --!><IMAGE SRC="https://tracker.example/pixel"> -->',
      '<!--mce:protected %3Cimg%20src%3D%22https%3A//tracker.example/pixel%22%3E-->',
      '<!-- ordinary hidden note -->',
    ]) {
      const clean = sanitizeEmailHtml(`<p>Visible</p>${comment}<p>End</p>`);
      expect(clean).not.toContain('<!--');
      expect(clean).not.toContain('tracker.example');
      expect(clean).toContain('Visible');
      expect(clean).toContain('End');
    }
  });

  it('keeps entity-looking attribute values stable across repeated parser boundaries', () => {
    let clean = sanitizeEmailHtml('<p style="color:red&#38#38#38#59background-image:u&#38#38#38#114l(https://tracker.example/css)" title="literal &lt;img&gt;">Visible</p><a href="https://outside.example/?a=1&amp;b=2">Link</a>');
    const first = parseHTML(clean).document.querySelector('p');
    const firstTitle = first.getAttribute('title');
    // The receive path reparses once to replace CID images between sanitizer
    // passes; this serializer is also the retained LinkeDOM implementation.
    clean = parseHTML(clean).document.toString();
    clean = sanitizeEmailHtml(clean);
    const parsed = parseHTML(clean).document;
    expect(parsed.querySelector('p').getAttribute('title')).toBe(firstTitle);
    expect(parsed.querySelector('p').getAttribute('style')).not.toContain('url(');
    for (let pass = 0; pass < 3; pass++) clean = sanitizeEmailHtml(clean);
    expect(parseHTML(clean).document.querySelector('p').getAttribute('style')).not.toContain('url(');
    expect(parsed.querySelector('a').getAttribute('href')).toBe('https://outside.example/?a=1&b=2');
  });
});
