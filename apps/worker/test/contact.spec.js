import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import contactService from '../src/service/contact-service';
import { markInstalled } from './installed-instance';

function createTestContext() {
	const values = new Map();
	return {
		env,
		get(key) {
			return values.get(key);
		},
		set(key, value) {
			values.set(key, value);
		},
	};
}

async function createTestUser(email, password) {
	const salt = `salt-${email}`;
	const hash = await cryptoUtils.genHashPassword(password, salt);
	const inserted = await env.db.prepare(
		'INSERT INTO user (email, password, salt, cli_token) VALUES (?, ?, ?, ?) RETURNING user_id AS userId',
	).bind(email, hash, salt, '').first();
	await env.db.prepare('INSERT INTO account (email, user_id) VALUES (?, ?)').bind(email, inserted.userId).run();
	return inserted.userId;
}

async function api(path, options = {}, runtimeEnv = env) {
	const request = new Request(`http://localhost${path}`, options);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, runtimeEnv, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function loginUser(email, password) {
	const loginEnv = {
		...env,
		LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	};
	const response = await api('/api/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Origin: 'http://localhost:8787',
		},
		body: JSON.stringify({ email, password }),
	}, loginEnv);
	const cookie = response.headers.get('set-cookie');
	return cookie;
}

describe('Contact module & Account isolation', () => {
	let user1Id;
	let user2Id;
	let user1Cookie;
	let user2Cookie;
	const context = createTestContext();

	beforeAll(async () => {
		await dbInit.migrate(context);
		await markInstalled(env);
		user1Id = await createTestUser('contact_user1@example.com', 'Pass123456');
		user2Id = await createTestUser('contact_user2@example.com', 'Pass123456');
		user1Cookie = await loginUser('contact_user1@example.com', 'Pass123456');
		user2Cookie = await loginUser('contact_user2@example.com', 'Pass123456');
	});

	it('supports full CRUD for contacts within a user account', async () => {
		// Add contact
		const added = await contactService.add(context, {
			name: 'Alice Cooper',
			email: 'alice@rock.com',
			phone: '13812345678',
			remark: 'Lead Singer',
			group_name: 'Musicians'
		}, user1Id);

		expect(added.contactId).toBeGreaterThan(0);
		expect(added.name).toBe('Alice Cooper');
		expect(added.email).toBe('alice@rock.com');
		expect(added.groupName).toBe('Musicians');

		// List contacts
		const listRes = await contactService.list(context, {}, user1Id);
		expect(listRes.list.some(c => c.email === 'alice@rock.com')).toBe(true);

		// Groups
		const groups = await contactService.groups(context, user1Id);
		expect(groups).toContain('Musicians');

		// Update contact
		const updated = await contactService.update(context, {
			contactId: added.contactId,
			name: 'Alice Cooper (Legend)',
			email: 'alice.legend@rock.com',
			phone: '13812345678',
			remark: 'Legendary Performer',
			group_name: 'VIP'
		}, user1Id);

		expect(updated.name).toBe('Alice Cooper (Legend)');
		expect(updated.email).toBe('alice.legend@rock.com');
		expect(updated.groupName).toBe('VIP');

		// Delete contact
		await contactService.delete(context, { contactId: added.contactId }, user1Id);

		const afterDeleteList = await contactService.list(context, {}, user1Id);
		expect(afterDeleteList.list.some(c => c.contactId === added.contactId)).toBe(false);
	});

	it('enforces strict account isolation (User 2 cannot read or modify User 1 contacts)', async () => {
		// User 1 adds a secret contact
		const u1Contact = await contactService.add(context, {
			name: 'User1 Secret',
			email: 'u1secret@domain.com',
			group_name: 'Private'
		}, user1Id);

		// User 2 cannot get detail of User 1's contact
		await expect(contactService.getById(context, u1Contact.contactId, user2Id)).rejects.toThrow();

		// User 2 cannot update User 1's contact
		await expect(contactService.update(context, {
			contactId: u1Contact.contactId,
			name: 'Hacked Name',
			email: 'u1secret@domain.com'
		}, user2Id)).rejects.toThrow();

		// User 2 cannot delete User 1's contact
		await contactService.delete(context, { contactId: u1Contact.contactId }, user2Id);
		// Contact must still exist for User 1
		const u1Detail = await contactService.getById(context, u1Contact.contactId, user1Id);
		expect(u1Detail).toBeDefined();
		expect(u1Detail.name).toBe('User1 Secret');
	});

	it('supports keyword search and group filtering', async () => {
		await contactService.add(context, {
			name: 'Bob Dev',
			email: 'bob.dev@corp.com',
			remark: 'Senior Go Developer',
			group_name: 'DevTeam'
		}, user1Id);

		await contactService.add(context, {
			name: 'Charlie Sales',
			email: 'charlie.sales@corp.com',
			remark: 'Sales Manager',
			group_name: 'SalesTeam'
		}, user1Id);

		// Search by keyword
		const searchDev = await contactService.list(context, { keyword: 'Go Developer' }, user1Id);
		expect(searchDev.list.some(c => c.name === 'Bob Dev')).toBe(true);
		expect(searchDev.list.some(c => c.name === 'Charlie Sales')).toBe(false);

		// Filter by group
		const filterGroup = await contactService.list(context, { group: 'SalesTeam' }, user1Id);
		expect(filterGroup.list.some(c => c.name === 'Charlie Sales')).toBe(true);
		expect(filterGroup.list.some(c => c.name === 'Bob Dev')).toBe(false);
	});

	it('supports HTTP API endpoints with session authentication', async () => {
		const res = await api('/api/contact/list', {
			headers: { Cookie: user1Cookie }
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.code).toBe(200);
		expect(Array.isArray(body.data.list)).toBe(true);
	});
});
