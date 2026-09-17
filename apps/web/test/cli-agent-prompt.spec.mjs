import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCliAgentPrompt } from '../src/utils/cli-agent-prompt.js'

test('the English agent prompt is the portable default', () => {
  const prompt = buildCliAgentPrompt('en', {
    brand: 'Acme Mail',
    apiBaseUrl: 'https://mail.example.com/api',
    docUrl: 'https://flaremail-demo.pages.dev/docs/en/cli?instance=https%3A%2F%2Fmail.example.com',
    token: '<TOKEN>',
  })
  assert.match(prompt, /You are a professional email management assistant/)
  assert.match(prompt, /Acme Mail CLI endpoints/)
  assert.match(prompt, /Authorization: Bearer <TOKEN>/)
  assert.doesNotMatch(prompt, /[\u4e00-\u9fff]/)
})

test('the Chinese prompt remains available as an explicit option', () => {
  const prompt = buildCliAgentPrompt('zh', { brand: '测试邮箱' })
  assert.match(prompt, /你是一个专业的邮件管理助手/)
  assert.match(prompt, /测试邮箱 CLI 接口/)
})

test('unknown prompt locales fall back to English', () => {
  const prompt = buildCliAgentPrompt('de', { brand: 'Acme Mail' })
  assert.match(prompt, /You are a professional email management assistant/)
  assert.doesNotMatch(prompt, /[\u4e00-\u9fff]/)
})
