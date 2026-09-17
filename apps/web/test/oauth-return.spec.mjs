import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authenticatedLoginTarget,
  safeAuthorizationReturn,
  shouldProbeAuthenticatedSession,
} from '../src/utils/oauth-return.js';

test('已登录用户进入带 OAuth redirect 的登录页时继续原授权请求', () => {
  const redirect = '/oauth/authorize?client_id=ai&state=state-value';

  assert.equal(
    authenticatedLoginTarget(redirect, 'https://mail.example.com'),
    redirect,
  );
  assert.equal(authenticatedLoginTarget('/inbox', 'https://mail.example.com'), '/');
});

test('OAuth 返回地址只允许当前邮件站的授权端点', () => {
  assert.equal(
    safeAuthorizationReturn('/oauth/authorize?client_id=ai', 'https://mail.example.com'),
    '/oauth/authorize?client_id=ai',
  );
  assert.equal(safeAuthorizationReturn('//evil.example/oauth/authorize', 'https://mail.example.com'), '');
  assert.equal(safeAuthorizationReturn('https://evil.example/oauth/authorize', 'https://mail.example.com'), '');
  assert.equal(safeAuthorizationReturn('/inbox', 'https://mail.example.com'), '');
});

test('即使本地登录提示丢失，OAuth 回流页仍验证服务端邮件会话', () => {
  assert.equal(shouldProbeAuthenticatedSession({
    hasSessionHint: false,
    oauthJustLoggedIn: false,
    redirect: '/oauth/authorize?client_id=ai&state=state-value',
    origin: 'https://mail.example.com',
  }), true);
  assert.equal(shouldProbeAuthenticatedSession({
    hasSessionHint: false,
    oauthJustLoggedIn: false,
    redirect: '/inbox',
    origin: 'https://mail.example.com',
  }), false);
});
