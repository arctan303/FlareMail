import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeInstanceOrigin,cliDocsUrl,personalizeCliDocs,CLI_EXAMPLE_ORIGIN} from '../src/utils/cli-docs.js';
import {renderMarkdown} from '../src/playground/markdown.js';

test('docs links use local preview or central Pages and only carry the origin',()=>{
  for(const [instance,base] of [['http://127.0.0.1:3001','http://127.0.0.1:4174'],['http://localhost:8787','http://127.0.0.1:4174'],['https://mail.example.org','https://flaremail-demo.pages.dev']]){
    for(const lang of ['zh','en']){
      const link=new URL(cliDocsUrl(instance,lang));
      assert.equal(link.origin,base);assert.equal(link.pathname,'/docs/'+lang+'/cli');
      assert.deepEqual([...link.searchParams],[['instance',instance]]);
    }
  }
  assert.equal(new URL(cliDocsUrl('https://mail.example.org','fr')).pathname,'/docs/en/cli');
});
test('untrusted instance parameters reject credentials, paths, ambiguity and shell injection',()=>{
  for(const value of [undefined,['https://a.example'], 'javascript:alert(1)','//a.example','https://u:p@a.example','https://a.example/api','https://a.example/?token=secret','https://a.example/#token','https://a.example/..',"https://a';echo-secret.example",'https://a`whoami`.example','https://a$(whoami).example','https://a.example\\path','https://a.example\n']){
    assert.equal(normalizeInstanceOrigin(value),'',String(value));
    assert.equal(new URL(cliDocsUrl(value)).search,'');
  }
  assert.equal(normalizeInstanceOrigin('HTTPS://MAIL.EXAMPLE.ORG:443/'),'https://mail.example.org');
  assert.equal(normalizeInstanceOrigin('http://[::1]:3001'),'http://[::1]:3001');
});
test('both CLI articles render full instance endpoints, curl and a placeholder Agent prompt',()=>{
  for(const lang of ['zh','en']){
    const source=fs.readFileSync(new URL('../docs/'+lang+'/cli.md',import.meta.url),'utf8');
    const personalized=personalizeCliDocs(source,'https://inbox.example.org:8443',lang);
    const {html}=renderMarkdown(personalized,lang);
    for(const path of ['/cli/accounts','/cli/emails','/cli/emails/:id','/cli/attachments/:key','/cli/emails/send','/cli/emails/:id/reply','/cli/emails/:id/read']) assert.ok(html.includes('https://inbox.example.org:8443/api'+path),path);
    assert.ok(html.includes('You are a professional email management assistant'));
    assert.ok(html.includes('&lt;YOUR_CLI_TOKEN&gt;'));
    assert.ok(!personalized.includes(CLI_EXAMPLE_ORIGIN));
    assert.ok(!personalized.includes('<!-- CLI_AGENT_PROMPT -->'));
    assert.ok(personalized.includes('instance=https%3A%2F%2Finbox.example.org%3A8443'));
    assert.ok(personalizeCliDocs(source,'javascript:alert(1)',lang).includes(CLI_EXAMPLE_ORIGIN));
  }
});
