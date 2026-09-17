import {buildCliAgentPrompt} from './cli-agent-prompt.js';

export const CLI_DOCS_SITE = 'https://flaremail-demo.pages.dev';
export const CLI_EXAMPLE_ORIGIN = 'https://mail.example.com';

// Accept origins only. The restricted alphabet also keeps substituted shell examples safe.
export function normalizeInstanceOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[a-z0-9.:[\]\-]+\/?$/i.test(value)) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch { return ''; }
}

export function cliDocsUrl(instance, lang = 'en') {
  const origin = normalizeInstanceOrigin(instance);
  const host = origin ? new URL(origin).hostname : '';
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  const url = new URL('/docs/' + (lang === 'zh' ? 'zh' : 'en') + '/cli', local ? 'http://127.0.0.1:4174' : CLI_DOCS_SITE);
  if (origin) url.searchParams.set('instance', origin);
  return url.href;
}

export function personalizeCliDocs(source, instance, lang = 'en') {
  const origin = normalizeInstanceOrigin(instance) || CLI_EXAMPLE_ORIGIN;
  const prompt = buildCliAgentPrompt('en', {
    brand: 'FlareMail', apiBaseUrl: origin + '/api', docUrl: cliDocsUrl(origin, lang),
  });
  return source.replaceAll(CLI_EXAMPLE_ORIGIN, origin)
    .replace('<!-- CLI_AGENT_PROMPT -->', '\n\x60\x60\x60text\n' + prompt + '\n\x60\x60\x60\n');
}
