import { describe, expect, it } from 'vitest';
import {
	inboundAttachmentLimitReason,
	inboundMailLimits,
	inboundRawLimitReason,
} from '../src/utils/inbound-mail-limits';

describe('inbound mail limits', () => {
	it('accepts exact raw and decoded attachment boundaries', () => {
		expect(inboundRawLimitReason(inboundMailLimits.maxRawBytes)).toBe('');
		expect(inboundAttachmentLimitReason(Array.from({ length: 50 }, (_, index) => ({
			filename: `${index}.bin`,
			content: { byteLength: index === 0 ? inboundMailLimits.maxDecodedAttachmentBytes : 0 },
		})))).toBe('');
	});

	it('rejects raw size, attachment count, and decoded total above their boundaries', () => {
		expect(inboundRawLimitReason(inboundMailLimits.maxRawBytes + 1)).toMatch(/25 MiB/);
		expect(inboundAttachmentLimitReason(Array.from({ length: 51 }, () => ({ content: { byteLength: 1 } })))).toMatch(/50/);
		expect(inboundAttachmentLimitReason([
			{ content: { byteLength: inboundMailLimits.maxDecodedAttachmentBytes } },
			{ content: { byteLength: 1 } },
		])).toMatch(/18 MiB/);
	});
});
