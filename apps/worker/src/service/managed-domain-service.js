import BizError from '../error/biz-error';
import { managedDomains } from '../utils/managed-domain-utils';
import cryptoUtils from '../utils/crypto-utils';
import KvConst from '../const/kv-const';
import sessionService from './session-service';
import { t } from '../i18n/i18n';
import verifyUtils from '../utils/verify-utils';
import { domainSchemaValid } from '../init/domain-schema';

const domainOf = column => `substr(${column},instr(${column},'@')+1)`;
const sourceAccounts = `SELECT account_id FROM account WHERE ${domainOf('email')}=? COLLATE NOCASE`;
const sourceUsers = `SELECT user_id FROM user WHERE ${domainOf('email')}=? COLLATE NOCASE`;
const busySql = `EXISTS (SELECT 1 FROM email WHERE account_id IN (${sourceAccounts}) AND status=6)
	OR EXISTS (SELECT 1 FROM send_request WHERE status='pending' AND user_id IN
		(SELECT user_id FROM account WHERE ${domainOf('email')}=? COLLATE NOCASE))`;

function operationInput(body) {
	if (!body || typeof body !== 'object' || Array.isArray(body)
		|| Object.keys(body).some(key => !['action','domain','targetDomain','enabled','revision','fingerprint'].includes(key))
		|| !['rename','migrate','setEnabled','delete'].includes(body.action)
		|| !Number.isSafeInteger(body.revision) || body.revision < 0) throw new BizError(t('domainInvalidRequest'));
	const domain = normalizeInput([body.domain])[0];
	const move = ['rename','migrate'].includes(body.action);
	if (move && typeof body.targetDomain !== 'string') throw new BizError(t('domainInvalidRequest'));
	if (body.action === 'setEnabled' && typeof body.enabled !== 'boolean') throw new BizError(t('domainInvalidRequest'));
	if ((!move && body.targetDomain !== undefined) || (body.action !== 'setEnabled' && body.enabled !== undefined)) throw new BizError(t('domainInvalidRequest'));
	return { action:body.action,domain,revision:body.revision,
		...(move ? { targetDomain:normalizeInput([body.targetDomain])[0] } : {}),
		...(body.action === 'setEnabled' ? { enabled:body.enabled } : {}) };
}

function normalizeInput(value) {
	if (!Array.isArray(value) || value.length === 0) {
		throw new BizError('At least one managed domain is required.');
	}
	if (value.some(domain => typeof domain !== 'string' || !domain.trim() || domain.includes('@'))) {
		throw new BizError('Managed domains must be domain names without @.');
	}
	let domains;
	try {
		domains = managedDomains(value);
	} catch {
		throw new BizError('Invalid managed domain.');
	}
	if (domains.length !== value.length) throw new BizError('Managed domains must be unique.');
	return domains;
}

const managedDomainService = {
	normalizeInput,

	async get(c, inspectManagement = false) {
		let state;
		try {
			state = await c.env.db.prepare(
				'SELECT revision, status FROM installation_state WHERE id = 1',
			).first();
		} catch (error) {
			if (/no such table/i.test(String(error?.message || ''))) {
				throw new BizError('Database upgrade required before reading managed domains.', 503);
			}
			throw error;
		}
		if (!state || state.status !== 'installed') {
			throw new BizError('System setup has not been completed.', 503);
		}
		const columns = (await c.env.db.prepare("PRAGMA table_info('managed_domain')").all()).results || [];
		const hasEnabled = columns.some(column => column.name === 'enabled');
		const marker = await c.env.db.prepare('SELECT version FROM schema_migrations WHERE version=328').first();
		if (marker && !hasEnabled) throw new BizError(t('domainUpgradeRequired'), 503);
		const rows = await c.env.db.prepare(`SELECT domain,${hasEnabled ? 'enabled' : '1 AS enabled'} FROM managed_domain ORDER BY domain`).all();
		return {
			domains: (rows.results || []).map(row => row.domain),
			entries: (rows.results || []).map(row => ({ domain:row.domain,enabled:Number(row.enabled) === 1 })),
			managementReady: !!marker && hasEnabled && (!inspectManagement || await domainSchemaValid(c)),
			revision: Number(state.revision),
		};
	},

	async suffixes(c) {
		return (await this.get(c)).entries.filter(row => row.enabled).map(row => `@${row.domain}`);
	},

	async containsEmail(c, email) {
		const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
		return (await this.get(c)).entries.some(row => row.domain === domain && row.enabled);
	},

	async preview(c, rawBody, issueReceipt = true) {
		const input = operationInput(rawBody);
		const state = await this.get(c);
		if (!state.managementReady || !await domainSchemaValid(c)) throw new BizError(t('domainUpgradeRequired'),503);
		if (input.revision !== state.revision) throw new BizError(t('domainChanged'),409);
		const source = state.entries.find(row => row.domain === input.domain);
		if (!source) throw new BizError(t('domainNotFound'),404);
		const { action,domain,targetDomain } = input;
		const move = ['rename','migrate'].includes(action);
		const blockers = [];
		const target = state.entries.find(row => row.domain === targetDomain);
		if (move) {
			if (domain === targetDomain) blockers.push('same_domain');
			if (action === 'rename' && target) blockers.push('target_exists');
			if (action === 'migrate' && !target) blockers.push('target_missing');
			if (action === 'migrate' && target && !target.enabled) blockers.push('target_inactive');
		}
		const accounts = (await c.env.db.prepare(`SELECT a.account_id AS accountId,a.user_id AS userId,a.email AS source,a.is_del AS isDel,
			CASE WHEN lower(a.email)=lower(u.email) THEN 1 ELSE 0 END AS isPrimary
			FROM account a LEFT JOIN user u ON u.user_id=a.user_id WHERE ${domainOf('a.email')}=? COLLATE NOCASE ORDER BY a.account_id`).bind(domain).all()).results || [];
		const counts = await c.env.db.prepare(`SELECT
			(SELECT COUNT(*) FROM user WHERE ${domainOf('email')}=? COLLATE NOCASE) AS userCount,
			(SELECT COUNT(*) FROM email WHERE account_id IN (${sourceAccounts})) AS emailCount,
			(SELECT COUNT(*) FROM attachments WHERE account_id IN (${sourceAccounts})) AS attachmentCount,
			(${busySql}) AS busy`).bind(domain,domain,domain,domain,domain).first();
		const conflicts = [];
		if (move) {
			for (const row of accounts) {
				const address = row.source.slice(0,row.source.indexOf('@')+1)+targetDomain;
				if (!verifyUtils.isEmail(address)) conflicts.push({email:row.source,reason:'invalid_address'});
			}
			const accountConflicts = (await c.env.db.prepare(`SELECT b.email FROM account a JOIN account b
				ON b.email=(substr(a.email,1,instr(a.email,'@')) || ?) COLLATE NOCASE AND b.account_id<>a.account_id
				WHERE ${domainOf('a.email')}=? COLLATE NOCASE LIMIT 51`).bind(targetDomain,domain).all()).results || [];
			conflicts.push(...accountConflicts.map(row => ({email:row.email,reason:'account_exists'})));
			const loginConflicts = (await c.env.db.prepare(`SELECT v.email FROM user u JOIN user v
				ON v.email=(substr(u.email,1,instr(u.email,'@')) || ?) COLLATE NOCASE AND v.user_id<>u.user_id
				WHERE ${domainOf('u.email')}=? COLLATE NOCASE LIMIT 51`).bind(targetDomain,domain).all()).results || [];
			conflicts.push(...loginConflicts.map(row => ({email:row.email,reason:'login_exists'})));
			const otherLogins = (await c.env.db.prepare(`SELECT u.email FROM account a JOIN user u
				ON u.email=(substr(a.email,1,instr(a.email,'@')) || ?) COLLATE NOCASE
				WHERE ${domainOf('a.email')}=? COLLATE NOCASE LIMIT 51`).bind(targetDomain,domain).all()).results || [];
			conflicts.push(...otherLogins.map(row => ({email:row.email,reason:'login_exists'})));
			const orphan = await c.env.db.prepare(`SELECT email FROM user u WHERE ${domainOf('u.email')}=? COLLATE NOCASE
				AND NOT EXISTS (SELECT 1 FROM account a WHERE a.user_id=u.user_id AND a.email=u.email COLLATE NOCASE) LIMIT 1`).bind(domain).first();
			if (orphan) { blockers.push('inconsistent_identity'); conflicts.push({email:orphan.email,reason:'orphan_login'}); }
			if (conflicts.length) blockers.push('address_conflict');
			if (counts.busy) blockers.push('mail_in_progress');
		}
		if (action === 'delete') {
			if (accounts.length || counts.userCount) blockers.push('domain_in_use');
			if (state.domains.length <= 1) blockers.push('last_domain');
		}
		if (action === 'setEnabled' && input.enabled === source.enabled) blockers.push('already_in_state');
		const plan = { ...input, accounts:accounts.slice(0,50).map(row => ({...row,isPrimary:!!row.isPrimary,target:move ? row.source.slice(0,row.source.indexOf('@')+1)+targetDomain : row.source})),
			accountCount:accounts.length,userCount:Number(counts.userCount),emailCount:Number(counts.emailCount),attachmentCount:Number(counts.attachmentCount),
			conflicts:conflicts.slice(0,50),blockers:[...new Set(blockers)],canApply:!blockers.length };
		// Counts may grow as mail arrives; confirmation binds the operation and
		// identity scope, which is serialized by the schema's revision triggers.
		const inputHash = await cryptoUtils.hashSecret(JSON.stringify(input));
		if (issueReceipt) {
			plan.fingerprint = crypto.randomUUID();
			await c.env.kv.put('domain-preview:'+plan.fingerprint,JSON.stringify({
				inputHash,userId:c.get?.('user')?.userId,sessionHash:c.get?.('session')?.hash || '',
			}),{expirationTtl:300});
		} else plan.fingerprint = inputHash;
		return plan;
	},

	async apply(c, rawBody) {
		const plan = await this.preview(c, rawBody, false);
		const token = rawBody.fingerprint;
		if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new BizError(t('domainPreviewRequired'),409);
		const receipt = await c.env.kv.get('domain-preview:'+token,{type:'json'});
		if (!receipt || receipt.inputHash !== plan.fingerprint || receipt.userId !== c.get?.('user')?.userId
			|| receipt.sessionHash !== (c.get?.('session')?.hash || '')) throw new BizError(t('domainPreviewRequired'),409);
		if (!plan.canApply) throw new BizError(t('domainOperationBlocked'),409);
		const { action,domain,targetDomain,revision } = plan;
		const move = ['rename','migrate'].includes(action);
		const before = await this.get(c);
		const source = before.entries.find(row => row.domain === domain);
		const db = c.env.db;
		const statements = [db.prepare('DELETE FROM installation_guard'),
			db.prepare(`INSERT INTO installation_guard(valid) SELECT CASE WHEN EXISTS
				(SELECT 1 FROM installation_state WHERE id=1 AND status='installed' AND revision=?)
				${move ? `AND NOT (${busySql})` : ''}
				THEN 1 ELSE 0 END`).bind(revision,...(move ? [domain,domain] : []))];
		let userResultIndex = -1;
		if (move) {
			if (action === 'rename') statements.push(db.prepare('INSERT INTO managed_domain(domain,enabled) VALUES (?,1)').bind(targetDomain));
			// Remove outstanding codes before changing login addresses; ID-based
			// email, attachment, draft and webhook ownership stays intact.
			statements.push(db.prepare(`DELETE FROM oauth_authorization_code WHERE user_id IN (${sourceUsers})`).bind(domain));
			statements.push(db.prepare(`UPDATE webhook_delivery SET status='cancelled',error='configuration_changed',updated_at=?,lease_token='',lease_until=0
				WHERE account_id IN (${sourceAccounts}) AND status IN ('pending','sending')`).bind(Date.now(),domain));
			statements.push(db.prepare(`UPDATE webhook_config SET revision=revision+1,updated_at=? WHERE account_id IN (${sourceAccounts})`).bind(Date.now(),domain));
			userResultIndex = statements.length;
			statements.push(db.prepare(`UPDATE user SET email=substr(email,1,instr(email,'@')) || ?,cli_token='',
				session_epoch=session_epoch+1,preserved_session_hash='' WHERE ${domainOf('email')}=? COLLATE NOCASE RETURNING user_id AS userId`).bind(targetDomain,domain));
			statements.push(db.prepare(`UPDATE account SET email=substr(email,1,instr(email,'@')) || ? WHERE ${domainOf('email')}=? COLLATE NOCASE`).bind(targetDomain,domain));
			if (action === 'rename') {
				statements.push(db.prepare('DELETE FROM managed_domain WHERE domain=?').bind(domain));
				statements.push(db.prepare('UPDATE managed_domain SET enabled=? WHERE domain=?').bind(+source.enabled,targetDomain));
			} else statements.push(db.prepare('UPDATE managed_domain SET enabled=0 WHERE domain=?').bind(domain));
		} else if (action === 'setEnabled') statements.push(db.prepare('UPDATE managed_domain SET enabled=? WHERE domain=?').bind(+plan.enabled,domain));
		else statements.push(db.prepare('DELETE FROM managed_domain WHERE domain=?').bind(domain));
		if (action === 'rename' || action === 'delete') statements.push(db.prepare('UPDATE setting SET resend_tokens=json_remove(resend_tokens,?)').bind(`$."${domain}"`));
		statements.push(db.prepare('UPDATE installation_state SET revision=revision+1,update_time=CURRENT_TIMESTAMP WHERE id=1'),db.prepare('DELETE FROM installation_guard'));
		let results;
		try { results = await db.batch(statements); }
		catch (error) {
			// D1 batches roll back on failed guards or constraints. Never report
			// these concurrent changes as a partially completed migration.
			if (/constraint|unique|Managed domain is inactive/i.test(String(error?.message || ''))) throw new BizError(t('domainChanged'),409);
			throw error;
		}
		const changedUsers = userResultIndex < 0 ? [] : (results[userResultIndex].results || []).map(row => row.userId);
		const callerId = Number(c.get?.('user')?.userId);
		const reauthRequired = changedUsers.includes(callerId);
		// Epochs and token revocation above are atomic; KV cleanup is best effort
		// and cannot turn a committed identity change into an ambiguous failure.
		await Promise.allSettled([c.env.kv.delete('domain-preview:'+token),c.env.kv.delete(KvConst.SETTING), ...changedUsers.map(id => sessionService.revokeAll(c,id))]);
		c.set?.('setting',null);
		if (reauthRequired && c.req) sessionService.clearCookie(c);
		return { state:await this.get(c),migratedAccountCount:move ? plan.accountCount : 0,migratedUserCount:changedUsers.length,reauthRequired };
	},

	async add(c, params) {
		if (!params || typeof params !== 'object' || Array.isArray(params)
			|| Object.keys(params).some(key => !['domains', 'revision'].includes(key))) {
			throw new BizError('Invalid managed domain request.');
		}
		const domains = normalizeInput(params.domains);
		const revision = params.revision;
		if (!Number.isInteger(revision) || revision < 0) throw new BizError('Invalid managed domain revision.');

		const current = await this.get(c);
		if (current.revision !== revision) throw new BizError('Managed domains changed; reload and try again.', 409);
		if (domains.some(domain => current.domains.includes(domain))) {
			throw new BizError('A managed domain is already configured.', 409);
		}

		try {
			await c.env.db.batch([
				c.env.db.prepare('DELETE FROM installation_guard'),
				c.env.db.prepare(`
					INSERT INTO installation_guard(valid)
					SELECT CASE WHEN EXISTS (
						SELECT 1 FROM installation_state
						WHERE id = 1 AND status = 'installed' AND revision = ?
					) THEN 1 ELSE 0 END
				`).bind(revision),
				...domains.map(domain => c.env.db.prepare(
					'INSERT INTO managed_domain(domain) VALUES (?)',
				).bind(domain)),
				c.env.db.prepare(`
					UPDATE installation_state
					SET revision = revision + 1, update_time = CURRENT_TIMESTAMP
					WHERE id = 1 AND status = 'installed' AND revision = ?
				`).bind(revision),
				c.env.db.prepare('DELETE FROM installation_guard'),
			]);
		} catch (error) {
			const latest = await this.get(c);
			if (latest.revision !== revision) throw new BizError('Managed domains changed; reload and try again.', 409);
			if (domains.some(domain => latest.domains.includes(domain))) {
				throw new BizError('A managed domain is already configured.', 409);
			}
			throw error;
		}
		return this.get(c);
	},
};

export default managedDomainService;
