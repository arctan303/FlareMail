import { describe, expect, it, vi } from 'vitest';
import setupSessionService from '../src/service/setup-session-service';

describe('setup session authorization', () => {
	it('signs a short-lived bootstrap token and rejects it after expiration', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		const context = { env: { SETUP_SECRET: 'unit-test-setup-secret' } };
		const issued = await setupSessionService.issue(context);
		expect(Date.parse(issued.expiresAt)).toBe(1_800_000_600_000);
		await expect(setupSessionService.require(context, issued.setupSession)).resolves.toMatchObject({
			purpose: 'flaremail-setup',
			expiresAt: 1_800_000_600_000,
		});
		now.mockReturnValue(1_800_000_600_001);
		await expect(setupSessionService.require(context, issued.setupSession)).rejects.toThrow('expired');
		now.mockRestore();
	});
});
