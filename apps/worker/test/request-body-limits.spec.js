import { describe, expect, it, vi } from 'vitest';
import { readLimitedBytes, readLimitedJson } from '../src/utils/req-utils';

function contextFor(request) {
	return {
		req: {
			raw: request,
			header(name) {
				return request.headers.get(name);
			},
		},
	};
}

describe('bounded request body reader', () => {
	it('rejects a declared oversized body before reading its stream', async () => {
		const getReader = vi.fn();
		const c = {
			req: {
				header: () => '17',
				raw: { body: { getReader } },
			},
		};
		await expect(readLimitedBytes(c, 16)).rejects.toMatchObject({ code: 413 });
		expect(getReader).not.toHaveBeenCalled();
	});

	it('stops a body with no Content-Length as soon as streamed bytes exceed the limit', async () => {
		const cancel = vi.fn(async () => undefined);
		let reads = 0;
		const reader = {
			async read() {
				reads += 1;
				return reads <= 2 ? { done: false, value: new Uint8Array(8) } : { done: true };
			},
			cancel,
			releaseLock: vi.fn(),
		};
		const c = { req: { header: () => null, raw: { body: { getReader: () => reader } } } };
		await expect(readLimitedBytes(c, 15)).rejects.toMatchObject({ code: 413 });
		expect(cancel).toHaveBeenCalledOnce();
		expect(reads).toBe(2);
	});

	it('does not trust a falsely small Content-Length', async () => {
		const chunks = [new Uint8Array(8), new Uint8Array(8)];
		const reader = {
			async read() {
				return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
			},
			cancel: vi.fn(async () => undefined),
			releaseLock: vi.fn(),
		};
		const c = { req: { header: () => '1', raw: { body: { getReader: () => reader } } } };
		await expect(readLimitedBytes(c, 15)).rejects.toMatchObject({ code: 413 });
		expect(reader.cancel).toHaveBeenCalledOnce();
	});

	it('accepts an exact-size JSON body and rejects malformed JSON', async () => {
		const valid = new Request('https://mail.example/api/test', {
			method: 'POST', body: '{"ok":true}',
		});
		await expect(readLimitedJson(contextFor(valid), 11)).resolves.toEqual({ ok: true });

		const invalid = new Request('https://mail.example/api/test', {
			method: 'POST', body: '{broken',
		});
		await expect(readLimitedJson(contextFor(invalid), 32)).rejects.toMatchObject({ code: 400 });
	});
});
