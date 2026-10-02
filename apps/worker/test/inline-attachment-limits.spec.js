import { afterEach, describe, expect, it, vi } from 'vitest';
import attService from '../src/service/att-service';
import r2Service from '../src/service/r2-service';
import settingService from '../src/service/setting-service';
import fileUtils from '../src/utils/file-utils';
import { validatePreparedAttachments } from '../src/utils/send-validator';

const MB = 1024 * 1024;
const context = { req: { url: 'https://mail.example/api/email/send' } };
const key = 'attachments/inline image.png';

function prepare(size = 3, actualSize = 3) {
	vi.spyOn(settingService, 'query').mockResolvedValue({ r2Domain: 'https://files.example' });
	const metadata = vi.spyOn(attService, 'selectOneByKeys').mockResolvedValue([
		{ key, filename: 'image.png', mimeType: 'image/png', size },
	]);
	const get = vi.spyOn(r2Service, 'getObj').mockResolvedValue({
		arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(actualSize)),
	});
	const hash = vi.spyOn(fileUtils, 'createAttachmentKey').mockResolvedValue('copied.png');
	return { metadata, get, hash };
}

function privateImages(count) {
	return `<p>body</p>${`<img src="/api/attachment/${encodeURIComponent(key)}">`.repeat(count)}`;
}

afterEach(() => vi.restoreAllMocks());

describe('inline attachment preparation', () => {
	it('rejects duplicate references over the existing count limit before reading storage', async () => {
		const { get, hash } = prepare();
		await expect(attService.toImageUrlHtml(context, privateImages(11), 7))
			.rejects.toThrow('at most 10 attachments');
		expect(get).not.toHaveBeenCalled();
		expect(hash).not.toHaveBeenCalled();
	});

	it('rejects repeated owned bytes over the existing aggregate limit before reading storage', async () => {
		const { get, hash } = prepare(8 * MB);
		await expect(attService.toImageUrlHtml(context, privateImages(3), 7))
			.rejects.toThrow('Total attachment size');
		expect(get).not.toHaveBeenCalled();
		expect(hash).not.toHaveBeenCalled();
	});

	it('includes ordinary uploads in count and byte preflight', async () => {
		const { get } = prepare(8 * MB);
		await expect(attService.toImageUrlHtml(context, privateImages(2), 7, [
			{ content: new ArrayBuffer(4 * MB + 1) },
		])).rejects.toThrow('Total attachment size');
		expect(get).not.toHaveBeenCalled();
		await expect(attService.toImageUrlHtml(context, privateImages(2), 7,
			Array.from({ length: 9 }, () => ({ content: 'eA==' }))))
			.rejects.toThrow('at most 10 attachments');
		expect(get).not.toHaveBeenCalled();
	});

	it('fetches and hashes one owned object once across legacy, private, and plain references', async () => {
		const { metadata, get, hash } = prepare();
		const html = `<img src="https://files.example/${key}"><img src="/api/attachment/${encodeURIComponent(key)}"><img src="${key}">`;
		const result = await attService.toImageUrlHtml(context, html, 7);
		expect(metadata).toHaveBeenCalledWith(context, [key], 7);
		expect(get).toHaveBeenCalledTimes(1);
		expect(hash).toHaveBeenCalledTimes(1);
		expect(result.imageDataList).toHaveLength(3);
		expect(new Set(result.imageDataList.map(image => image.contentId)).size).toBe(3);
		expect(result.imageDataList.every(image => image.key === 'attachments/copied.png')).toBe(true);
		for (const image of result.imageDataList) expect(result.html).toContain(`cid:${image.contentId}`);
	});

	it('accepts the exact aggregate boundary including binary and base64 uploads', async () => {
		const { get } = prepare(8 * MB, 8 * MB);
		const uploads = [{ content: new ArrayBuffer(4 * MB - 1) }, { content: 'eA==' }];
		const result = await attService.toImageUrlHtml(context, privateImages(2), 7, uploads);
		expect(result.imageDataList).toHaveLength(2);
		expect(get).toHaveBeenCalledTimes(1);
		expect(() => validatePreparedAttachments([...result.imageDataList, ...uploads])).not.toThrow();
	});

	it('preflights data images together with owned references and uploads before decoding', async () => {
		const { get, hash } = prepare();
		const decode = vi.spyOn(fileUtils, 'base64ToFile');
		const html = `${privateImages(9)}<img src="data:image/png;base64,eA==">`;
		await expect(attService.toImageUrlHtml(context, html, 7, [{ content: 'eA==' }]))
			.rejects.toThrow('at most 10 attachments');
		expect(get).not.toHaveBeenCalled();
		expect(hash).not.toHaveBeenCalled();
		expect(decode).not.toHaveBeenCalled();
		const result = await attService.toImageUrlHtml(context, html, 7);
		expect(result.imageDataList).toHaveLength(10);
		expect(get).toHaveBeenCalledTimes(1);
		expect(decode).toHaveBeenCalledTimes(1);
	});

	it('keeps unknown, foreign, malformed, and missing object references omitted', async () => {
		const { metadata, get } = prepare();
		metadata.mockResolvedValue([]);
		const unknown = await attService.toImageUrlHtml(context, privateImages(20), 7);
		expect(unknown.imageDataList).toEqual([]);
		expect(get).not.toHaveBeenCalled();
		const malformed = await attService.toImageUrlHtml(context, '<img src="/api/attachment/%E0%A4%A">', 7);
		expect(malformed.imageDataList).toEqual([]);
		metadata.mockResolvedValue([{ key, filename: 'image.png', mimeType: 'image/png', size: 3 }]);
		get.mockResolvedValue(null);
		const missing = await attService.toImageUrlHtml(context, privateImages(2), 7);
		expect(missing.imageDataList).toEqual([]);
		expect(get).toHaveBeenCalledTimes(1);
	});
});
