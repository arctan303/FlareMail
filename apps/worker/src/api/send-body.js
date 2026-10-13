import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { readLimitedJson } from '../utils/req-utils';

export const MAX_SEND_BODY_BYTES = 32 * 1024 * 1024;

export async function readSendBody(c) {
	const params = await readLimitedJson(c, MAX_SEND_BODY_BYTES, {
		tooLargeMessage: t('sendRequestTooLarge'),
		invalidMessage: t('invalidSendRequest'),
	});
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		throw new BizError(t('invalidSendRequest'), 400);
	}
	return params;
}
