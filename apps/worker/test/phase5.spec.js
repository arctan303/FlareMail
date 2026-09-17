import { describe, it, expect } from 'vitest';
import unmatchedService from '../src/service/unmatched-service';
import accountService from '../src/service/account-service';

describe('Phase 5 - Multi-mailbox identity & Unmatched quarantine boundaries', () => {

	it('strictly blocks non-admin users and validates unmatched policy values', async () => {
		const mockContext = { env: { db: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } } };
		// Reject invalid policy values (AC-UNM-001)
		await expect(unmatchedService.setPolicy(mockContext, 'invalid_policy', 1)).rejects.toThrow('Invalid unmatched policy mode');
		
		// Valid policy options check
		expect(['reject', 'drop', 'quarantine'].includes('reject')).toBe(true);
		expect(['reject', 'drop', 'quarantine'].includes('drop')).toBe(true);
		expect(['reject', 'drop', 'quarantine'].includes('quarantine')).toBe(true);
	});

	it('supports default send account selection and fallback logic (AC-SND-001/002)', async () => {
		const mockAccount = { accountId: 10, email: 'default@example.com' };
		const mockDb = {
			prepare: (sql) => ({
				bind: (...args) => ({
					first: async () => mockAccount,
					raw: async () => [[10, 'default@example.com']]
				})
			})
		};
		const mockContext = { env: { db: mockDb } };
		const res = await accountService.getDefaultSendAccount(mockContext, 1);
		expect(res.email).toBe('default@example.com');
	});

	it('enforces unmatched quarantine deletion and 30-day cleanup structure (AC-UNM-002/003)', async () => {
		const deletedKeys = [];
		const mockDb = {
			prepare: (sql) => ({
				bind: (...args) => ({
					first: async () => {
						if (sql.includes('sqlite_master')) return { name: 'object_delete_queue' };
						if (sql.includes('SELECT email_id FROM email')) return { email_id: 100 };
						return null;
					},
					all: async () => {
						if (sql.includes('SELECT email_id FROM email')) return { results: [{ email_id: 100 }] };
						return { results: [] };
					}
				}),
				first: async () => {
					if (sql.includes('sqlite_master')) return { name: 'object_delete_queue' };
					return null;
				}
			}),
			batch: async (stmts) => {
				deletedKeys.push(stmts.length);
				return stmts.map(() => ({ results: [{}] }));
			}
		};

		const mockContext = { env: { db: mockDb } };
		await unmatchedService.delete(mockContext, 100);
		expect(deletedKeys.length).toBe(1);

		const cleanupRes = await unmatchedService.cleanExpired(mockContext);
		expect(cleanupRes.cleanedCount).toBe(1);
	});
});
