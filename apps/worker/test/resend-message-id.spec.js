import { afterEach, describe, expect, it, vi } from 'vitest';
import emailSendService from '../src/service/email-send-service';

describe('accepted Resend Message-ID lookup', () => {
	afterEach(() => vi.useRealTimers());

	it('degrades an explicit GET rejection without losing accepted state', async () => {
		const resend = { get: vi.fn().mockRejectedValue(new Error('lookup denied')) };
		await expect(emailSendService.retrieveResendMessageId(resend, 'accepted-id', 20)).resolves.toEqual({
			messageId: '',
			messageIdWarning: expect.stringMatching(/accepted.*Message-ID/i),
		});
	});

	it('waits for queued metadata to become available without repeating the send', async () => {
		vi.useFakeTimers();
		const resend = { get: vi.fn()
			.mockResolvedValueOnce({ data: { last_event: 'queued', message_id: null } })
			.mockResolvedValueOnce({ data: { last_event: 'sent', message_id: '<ready@mail.example.net>' } }) };
		const lookup = emailSendService.retrieveResendMessageId(resend, 'accepted-id');
		await vi.advanceTimersByTimeAsync(999);
		expect(resend.get).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await expect(lookup).resolves.toEqual({ messageId: '<ready@mail.example.net>', messageIdWarning: '' });
		expect(resend.get).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('bounds metadata reads when the provider stays queued', async () => {
		vi.useFakeTimers();
		const resend = { get: vi.fn().mockResolvedValue({ data: { message_id: null, last_event: 'queued' } }) };
		const lookup = emailSendService.retrieveResendMessageId(resend, 'accepted-id');
		await vi.advanceTimersByTimeAsync(3000);
		await expect(lookup).resolves.toMatchObject({ messageId: '', messageIdWarning: expect.any(String) });
		expect(resend.get).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('the overall deadline also stops retry delays', async () => {
		vi.useFakeTimers();
		const resend = { get: vi.fn().mockResolvedValue({ data: { message_id: null } }) };
		const lookup = emailSendService.retrieveResendMessageId(resend, 'accepted-id', 500);
		await vi.advanceTimersByTimeAsync(500);
		await expect(lookup).resolves.toMatchObject({ messageId: '', messageIdWarning: expect.any(String) });
		expect(resend.get).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not retry denied or rate-limited metadata requests', async () => {
		for (const statusCode of [403, 429]) {
			const resend = { get: vi.fn().mockResolvedValue({ data: null, error: { statusCode } }) };
			await expect(emailSendService.retrieveResendMessageId(resend, 'accepted-id')).resolves.toMatchObject({
				messageId: '', messageIdWarning: expect.any(String),
			});
			expect(resend.get).toHaveBeenCalledTimes(1);
		}
	});

	it('aborts and degrades a GET that never settles', async () => {
		vi.useFakeTimers();
		let signal;
		const resend = { get: vi.fn((path, options) => {
			signal = options.signal;
			return new Promise(() => {});
		}) };
		const lookup = emailSendService.retrieveResendMessageId(resend, 'accepted-id', 1500);
		await vi.advanceTimersByTimeAsync(1500);
		await expect(lookup).resolves.toMatchObject({ messageId: '', messageIdWarning: expect.any(String) });
		expect(signal.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['api-record-id', '<api-record-id>', '<@example.net>', '<id@>', '<id@@example.net>', '<id\u0000@example.net>', '<id@example.net>\r\nX-Bad: yes'])('rejects a provider API ID that is not a safe Message-ID: %s', async (messageId) => {
		const resend = { get: vi.fn().mockResolvedValue({ data: { message_id: messageId }, error: null }) };
		await expect(emailSendService.retrieveResendMessageId(resend, 'accepted-id', 20)).resolves.toMatchObject({
			messageId: '',
			messageIdWarning: expect.any(String),
		});
	});

	it('retains a provider-generated local@domain Message-ID', async () => {
		const resend = { get: vi.fn().mockResolvedValue({ data: { message_id: '<accepted@mail.example.net>' } }) };
		await expect(emailSendService.retrieveResendMessageId(resend, 'accepted-id', 20)).resolves.toEqual({
			messageId: '<accepted@mail.example.net>', messageIdWarning: '',
		});
	});
});
