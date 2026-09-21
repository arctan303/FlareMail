import BizError from '../error/biz-error';
import constant from '../const/constant';
import userService from '../service/user-service';
import sessionService from '../service/session-service';
import { isDel, userConst } from '../const/entity-const';
import cryptoUtils from '../utils/crypto-utils';
import { isAllowedOrigin } from '../utils/origin-utils';
import { isAdmin, resolvePermKeys } from './admin-identity';

import { t } from '../i18n/i18n'
import app from '../hono/hono';

const exclude = [
	'/login',
	'/oauth/authorize',
	'/oauth/token',
	'/oauth/userinfo',
	'/.well-known/oauth-authorization-server',
	'/setting/websiteConfig',
	'/site-assets/brand',
	'/manifest.webmanifest',
	'/setup',
	'/oauth/bind/callback'
];

const requirePerms = [
	'/email/send',
	'/email/delete',
	'/account/list',
	'/account/add',
	'/account/delete',
	'/setting/set',
	'/setting/brand-assets',
	'/setting/query',
	'/setting/oauth-provider',
	'/user/delete',
	'/user/setPwd',
	'/user/setStatus',
	'/user/list',
	'/user/restore',
	'/user/resetSendCount',
	'/user/add',
	'/user/addAccount',
	'/user/deleteAccount',
	'/user/allAccount',
	'/user/updateSendLimit',
	'/user/updateAccountLimit',
	'/unmatched/list',
	'/unmatched/detail',
	'/unmatched/delete',
	'/unmatched/policy',
	'/setting/unmatched-policy'
];

const premKey = {
	'email:delete': ['/email/delete'],
	'email:send': ['/email/send'],
	'account:query': ['/account/list'],
	'account:add': ['/account/add'],
	'account:delete': ['/account/delete'],
	'user:query': ['/user/list','/user/allAccount'],
	'user:add': ['/user/add', '/user/addAccount'],
	'user:reset-send': ['/user/resetSendCount', '/user/updateSendLimit', '/user/updateAccountLimit'],
	'user:set-pwd': ['/user/setPwd'],
	'user:set-status': ['/user/setStatus', '/user/restore'],
	'user:delete': ['/user/delete','/user/deleteAccount'],
	'setting:query': ['/setting/query', '/setting/oauth-provider'],
	'setting:set': ['/setting/set', '/setting/brand-assets', '/setting/oauth-provider'],
};

app.use('*', async (c, next) => {

	const path = c.req.path;
	if (!await isTrustedMutation(c)) {
		throw new BizError(t('unauthorized'), 403);
	}

	const index = exclude.findIndex(item => pathMatches(path, item));

	if (index > -1) {
		return await next();
	}

	if (pathMatches(path, '/cli')) {
		const token = (c.req.header(constant.TOKEN_HEADER) || '').replace('Bearer ', '');
		const userRow = await userService.verifyCliToken(c, token);
		if (!userRow) {
			throw new BizError('CLI token invalid or not configured', 401);
		}
		c.set('user', userRow);
		return await next();
	}

	const session = await sessionService.resolve(c);
	if (!session) {
		throw new BizError(t('authExpired'), 401);
	}

	const userRow = await userService.selectByIdIncludeDel(c, session.userId);
	if (!userRow || userRow.isDel !== isDel.NORMAL || userRow.status === userConst.status.BAN) {
		await sessionService.revokeAll(c, session.userId);
		sessionService.clearCookie(c);
		throw new BizError(t('authExpired'), 401);
	}
	const credentialFingerprint = await cryptoUtils.hashSecret(userRow.password);
	if (!session.credentialFingerprint || session.credentialFingerprint !== credentialFingerprint) {
		await sessionService.revokeCurrent(c);
		throw new BizError(t('authExpired'), 401);
	}

	const permIndex = requirePerms.findIndex(item => pathMatches(path, item));

	if (permIndex > -1) {

		const admin = isAdmin(userRow);
		const permKeys = resolvePermKeys(userRow);

		const userPaths = permKeyToPaths(permKeys);

		const userPermIndex = userPaths.findIndex(item => pathMatches(path, item));

		if (userPermIndex === -1 && !admin) {
			throw new BizError(t('unauthorized'), 403);
		}

	}

	c.set('user', userRow)
	c.set('session', session)

	return await next();
});

async function isTrustedMutation(c) {
	if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return true;

	const origin = c.req.header('Origin');
	if (!origin) return !c.req.header('Sec-Fetch-Site');

	const requestOrigin = new URL(c.req.url).origin;
	if (origin === requestOrigin) return true;
	return await isAllowedOrigin(c, origin);
}

function pathMatches(path, route) {
	return path === route || path.startsWith(`${route}/`);
}

function permKeyToPaths(permKeys) {

	const paths = [];

	for (const key of permKeys) {
		const routeList = premKey[key];
		if (routeList && Array.isArray(routeList)) {
			paths.push(...routeList);
		}
	}
	return paths;
}
