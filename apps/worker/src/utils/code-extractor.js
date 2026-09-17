import { parseHTML } from 'linkedom';

/**
 * 常见非验证码英文单词、品牌名称与保留词黑名单（不区分大小写）
 */
const INVALID_WORD_SET = new Set([
	'post', 'get', 'http', 'https', 'smtp', 'imap', 'pop3', 'html', 'head', 'body',
	'true', 'false', 'null', 'undefined', 'nan', 'none', 'nil',
	'email', 'admin', 'error', 'login', 'reset', 'user', 'password', 'pass',
	'account', 'verify', 'code', 'token', 'support', 'help', 'click', 'here',
	'dear', 'hello', 'hi', 'privacy', 'policy', 'terms', 'team', 'service',
	'noreply', 'domain', 'host', 'view', 'open', 'more', 'link', 'logo',
	'image', 'icon', 'button', 'table', 'span', 'div', 'font', 'color',
	'style', 'class', 'width', 'height', 'align', 'center', 'right', 'left',
	'border', 'solid', 'padding', 'margin', 'inline', 'block', 'none', 'auto',
	'test', 'demo', 'info', 'warn', 'debug', 'trace', 'fatal', 'status',
	'valid', 'expire', 'minute', 'second', 'hour', 'days', 'month', 'year',
	'github', 'google', 'telegram', 'discord', 'steam', 'microsoft', 'apple',
	'amazon', 'notion', 'stripe', 'twitter', 'zhihu', 'bilibili', 'huawei',
	'tencent', 'aliyun', 'alipay', 'taobao', 'baidu', 'wechat', 'netease'
]);

/**
 * 常见无验证码语境下的端口号与协议数字
 */
const INVALID_NUMBER_SET = new Set([
	'21', '22', '23', '25', '53', '80', '110', '143', '443', '465', '587', '993', '995',
	'3000', '3306', '5432', '6379', '8000', '8080', '8443', '8888', '9000'
]);

const codeExtractor = {
	/**
	 * 从邮件的主题、纯文本或 HTML 内容中提取验证码
	 * @param {Object} emailData
	 * @param {string} [emailData.subject] - 邮件主题
	 * @param {string} [emailData.text] - 邮件纯文本内容
	 * @param {string} [emailData.html] - 邮件 HTML 内容
	 * @returns {string} 提取到的验证码，若未识别出则返回空字符串 ''
	 */
	extract(emailData = {}) {
		const { subject = '', text = '', html = '' } = emailData;

		const cleanSubject = this.cleanText(subject);
		const cleanPlainText = this.cleanText(text);

		// 1. 优先级最高：邮件主题提取 (Subject Fast-Path)
		if (cleanSubject) {
			const subjectCode = this.extractFromSubject(cleanSubject);
			if (subjectCode) {
				return subjectCode;
			}
		}

		// 2. 准备正文文本（纯文本或从 HTML 提取结构化文本）
		let bodyText = cleanPlainText;
		let domDocument = null;

		if (html && typeof html === 'string') {
			try {
				const wrappedHtml = html.includes('<body')
					? html
					: `<!DOCTYPE html><html><body>${html}</body></html>`;
				const parsed = parseHTML(wrappedHtml);
				domDocument = parsed.document;

				// 移除干扰节点
				domDocument.querySelectorAll('style, script, noscript, svg, title').forEach(el => el.remove());

				if (!bodyText) {
					bodyText = this.cleanText(domDocument.body?.innerText || '');
				}
			} catch (err) {
				console.error('DOM parse error during code extraction:', err?.message || err);
			}
		}

		// 3. 优先级 2：正文高置信度上下文锚点提取 (Body Context Matching)
		if (bodyText) {
			const bodyCode = this.extractFromBodyContext(bodyText);
			if (bodyCode) {
				return bodyCode;
			}
		}

		// 4. 优先级 3：HTML 视觉与 DOM 启发式提取 (DOM Visual Heuristics)
		if (domDocument && domDocument.body) {
			const domCode = this.extractFromDomHeuristics(domDocument);
			if (domCode) {
				return domCode;
			}
		}

		// 5. 优先级 4：正文后置启发式兜底（针对含“有效期/请勿泄露”等特征的邮件）
		if (bodyText) {
			const fallbackCode = this.extractFromFallbackContext(bodyText);
			if (fallbackCode) {
				return fallbackCode;
			}
		}

		return '';
	},

	/**
	 * 清洗不可见字符、特殊空格和换行
	 */
	cleanText(str) {
		if (typeof str !== 'string' || !str) return '';
		return str
			.replace(/[\u200B-\u200F\uFEFF\u034F\u00A0\u3000\u00AD\t\r]+/g, ' ')
			.replace(/\n\s*\n/g, '\n')
			.trim();
	},

	/**
	 * 从邮件主题中提取验证码
	 */
	extractFromSubject(subject) {
		const patterns = [
			// 中文/英文前置引导：验证码是 123456 / verification code is 123456 / Code: 123456
			/(?:验证码|校验码|动态码|安全码|授权码|确认码|激活码|安全代码|通行码|口令|verification\s*code|verify\s*code|security\s*code|confirmation\s*code|authorization\s*code|login\s*code|otp|passcode|access\s*code|pin\s*code)[\s:：为是is-]*(?:[【\[「『"“'‘\x60\s]*)([A-Z]{1,3}-[0-9]{4,8}|[0-9]{3}\s+[0-9]{3}|[0-9a-zA-Z]{4,8})(?:[】\]」』"”'’\x60\s]*)/i,
			// 紧跟在验证码后的描述：123456 是您的验证码 / 123456 is your verification code
			/(?:^|[\s【\["“'‘\x60])([A-Z]{1,3}-[0-9]{4,8}|[0-9]{3}\s+[0-9]{3}|[0-9a-zA-Z]{4,8})(?:[\s"”'’\x60\】\]]*)(?:是您的|为您的|是用于|is\s+(?:your\s+)?(?:verification|security|confirmation|login|otp|access)\s+code|is\s+your\s+code)/i,
			// 带有明显前缀格式如 G-123456
			/\b([A-Z]{1,3}-[0-9]{4,8})\b/,
			// 方括号包裹的纯数字：[123456] 或 【123456】（避免误匹配 [GitHub] 等品牌词）
			/[【\[]([0-9]{4,8})[】\]]/
		];

		for (const pattern of patterns) {
			const match = subject.match(pattern);
			if (match && match[1]) {
				const candidate = this.normalizeCandidate(match[1]);
				if (this.isValidCode(candidate, subject)) {
					return candidate;
				}
			}
		}

		return '';
	},

	/**
	 * 从正文上下文锚点提取验证码
	 */
	extractFromBodyContext(text) {
		const patterns = [
			// 中文前置引导：验证码：123456 / 验证码为 123456 / 验证码是“392014”
			/(?:验证码|校验码|动态码|安全码|授权码|确认码|激活码|安全代码|动态密码|通行口令|口令)[\s:：为是is-]*(?:[【\[「『"“'‘\x60\s]*)([A-Z]{1,3}-[0-9]{4,8}|[0-9]{3}\s+[0-9]{3}|[0-9a-zA-Z]{4,8})(?:[】\]」』"”'’\x60\s]*)/i,
			// 英文前置引导：Verification code: 123456 / Security Code is 123456 / One-time password: 123456
			/(?:\b(?:verification|verify|security|confirmation|authorization|authorized|login|otp|one-time\s+password|access|activation|passcode|pin)\s*(?:code|number|password)?|code\s*(?:is|:)|code\s+is)[\s:：is-]*(?:[【\["“'‘\x60\s]*)([A-Z]{1,3}-[0-9]{4,8}|[0-9]{3}\s+[0-9]{3}|[0-9a-zA-Z]{4,8})(?:[】\]"”'’\x60\s]*)/i,
			// 日文/韩文前置引导
			/(?:確認コード|認証コード|인증번호|인증\s*코드)[\s:：is-]*(?:[【\[「『"“'‘\x60\s]*)([0-9a-zA-Z]{4,8})(?:[】\]」』"”'’\x60\s]*)/i,
			// 后置括号或后缀引导：849102（登录验证码） / 849102 (verification code)
			/([A-Z]{1,3}-[0-9]{4,8}|[0-9]{3}\s+[0-9]{3}|[0-9a-zA-Z]{4,8})[\s]*(?:[(（[【]\s*)(?:验证码|登录验证码|动态码|安全码|确认码|verification\s*code|security\s*code|confirmation\s*code|otp|passcode)(?:\s*[)）\]】])/i,
			// 后置说明引导：123456 是您的验证码 / 123456 is your security code
			/([A-Z]{1,3}-[0-9]{4,8}|[0-9]{3}\s+[0-9]{3}|[0-9a-zA-Z]{4,8})[\s]*(?:[】\]」』"”'’\x60\s]*)?(?:是您的|为您的|是用于|为登录|为注册|is\s+your\s+(?:verification|security|confirmation|login|otp|access)\s+code|is\s+the\s+verification\s+code)/i
		];

		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match && match[1]) {
				const candidate = this.normalizeCandidate(match[1]);
				if (this.isValidCode(candidate, text)) {
					return candidate;
				}
			}
		}

		return '';
	},

	/**
	 * 利用 DOM 结构特征（大字号、粗体、独立居中元素、类名标记等）启发式提取验证码
	 */
	extractFromDomHeuristics(document) {
		if (!document || !document.body) return '';

		// 检查是否有带验证码语境（如包含 code, verify, 验证, 有效, expire 等）
		const fullText = document.body.innerText || '';
		const hasVerificationContext = /(?:验证码|校验码|动态码|安全码|确认码|verification|security\s*code|confirmation|login\s*code|otp|passcode|valid|expire|分钟|有效)/i.test(fullText);

		// 挑选可能渲染验证码的视觉元素
		const candidateElements = document.querySelectorAll('div, p, span, td, th, h1, h2, h3, b, strong, font, a');

		for (const el of candidateElements) {
			// 只看直接子文本或短纯文本
			const innerText = el.textContent ? el.textContent.trim() : '';
			if (!innerText || innerText.length < 4 || innerText.length > 12) {
				continue;
			}

			// 检查文本是否符合验证码形态（如 123456, G-123456, 123 456, ABCDEF）
			const candidate = this.normalizeCandidate(innerText);
			if (!/^[0-9a-zA-Z]{4,8}$/.test(candidate) && !/^[A-Z]{1,3}-[0-9]{4,8}$/.test(candidate)) {
				continue;
			}

			// 检查样式特征或语义特征
			const style = (el.getAttribute('style') || '').toLowerCase();
			const className = (el.getAttribute('class') || '').toLowerCase();
			const id = (el.getAttribute('id') || '').toLowerCase();

			const isLargeFont = /font-size\s*:\s*(?:1[8-9]|[2-9]\d|\d{3,})px/i.test(style) || /font-size\s*:\s*(?:1\.[3-9]|[2-9])(?:rem|em)/i.test(style);
			const isBold = /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style) || ['b', 'strong', 'h1', 'h2', 'h3'].includes(el.tagName?.toLowerCase());
			const isLetterSpaced = /letter-spacing\s*:\s*[1-9]/i.test(style);
			const hasCodeClass = /(?:code|otp|pin|token|verify)/i.test(className) || /(?:code|otp|pin|token|verify)/i.test(id);

			// 如果元素有视觉突出特征，或者在验证码语境下拥有独立样式块
			if ((isLargeFont || (isBold && hasVerificationContext) || isLetterSpaced || hasCodeClass)) {
				if (this.isValidCode(candidate, fullText)) {
					return candidate;
				}
			}
		}

		return '';
	},

	/**
	 * 正文兜底启发式提取：针对带有“有效时间/请勿泄露”等强特征词的邮件，在附近抓取孤立数字/代码
	 */
	extractFromFallbackContext(text) {
		const contextKeywords = /(?:分钟内有效|有效时间|有效期|分钟有效|秒内有效|expires\s+in|valid\s+for|valid\s+within|do\s+not\s+share|please\s+do\s+not\s+disclose|请勿泄露|请勿将|切勿告知)/i;
		const matchIndex = text.search(contextKeywords);
		if (matchIndex === -1) return '';

		// 截取关键词前后 200 个字符的窗口
		const start = Math.max(0, matchIndex - 200);
		const end = Math.min(text.length, matchIndex + 200);
		const windowText = text.substring(start, end);

		// 在窗口内查找孤立的 4~8 位纯数字或前缀格式
		const codeMatches = windowText.matchAll(/(?:^|[^0-9a-zA-Z])([A-Z]{1,3}-[0-9]{4,8}|[0-9]{4,8})(?:[^0-9a-zA-Z]|$)/g);
		for (const match of codeMatches) {
			const candidate = this.normalizeCandidate(match[1]);
			if (this.isValidCode(candidate, text)) {
				return candidate;
			}
		}

		return '';
	},

	/**
	 * 候选词清洗与归一化
	 */
	normalizeCandidate(rawStr) {
		if (typeof rawStr !== 'string') return '';
		let str = rawStr.trim();
		// 去除首尾常见的引号、括号等包裹字符（含中文全角与弯引号）
		str = str.replace(/^[【\[「『"“'‘`(\s]+/, '').replace(/[】\]」』"”'’`)\s.,;:!！?？]+$/, '');
		// 针对 "123 456" 分组数字格式，合并为空格去除后的纯数字
		if (/^[0-9]{3}\s+[0-9]{3}$/.test(str) || /^[0-9]{2}\s+[0-9]{2}\s+[0-9]{2}$/.test(str)) {
			str = str.replace(/\s+/g, '');
		}
		return str;
	},

	/**
	 * 校验提取结果的有效性（排除年份、端口号、常见单词、UUID/时间等假阳性）
	 */
	isValidCode(code, contextText = '') {
		if (!code || typeof code !== 'string') return false;

		// 长度必须在 4 到 8 位之间（连字符前缀格式如 G-123456 最长可达 10 位）
		if (code.includes('-')) {
			if (code.length < 5 || code.length > 11) return false;
			if (!/^[A-Z]{1,3}-[0-9]{4,8}$/i.test(code)) return false;
			return true;
		}

		if (code.length < 4 || code.length > 8) {
			return false;
		}

		// 只能由纯数字或字母数字组成
		if (!/^[0-9a-zA-Z]+$/.test(code)) {
			return false;
		}

		const lowerCode = code.toLowerCase();

		// 1. 黑名单单词过滤
		if (INVALID_WORD_SET.has(lowerCode)) {
			return false;
		}

		// 2. 常见端口/协议数字过滤
		if (INVALID_NUMBER_SET.has(code)) {
			return false;
		}

		// 3. 常见年份过滤（1990 ~ 2035）
		if (/^(?:199\d|20[0-3]\d)$/.test(code)) {
			// 只有当上下文有极其明确强烈的 "验证码是 2026" / "code: 2026" 等模式时才允许
			const strongYearPattern = new RegExp('(?:验证码|校验码|动态码|code|otp)[\\s:：为是is]*[【\\["“\'‘`\\s]*' + code + '[】\\]"”\'’`\\s]*', 'i');
			if (!strongYearPattern.test(contextText)) {
				return false;
			}
		}

		// 4. 纯字母代码验证：如果是纯字母，长度通常为 4~8 位，但必须不能是普通词汇组合
		if (/^[a-zA-Z]+$/.test(code)) {
			// 若全为小写且不是在明确验证码引导词下，可能只是普通英文单词
			if (/^[a-z]+$/.test(code) && code.length >= 4) {
				const strongAlphaPattern = new RegExp('(?:验证码|code|otp|pin)[\\s:：为是is]*[【\\["“\'‘`\\s]*' + code + '[】\\]"”\'’`\\s]*', 'i');
				if (!strongAlphaPattern.test(contextText)) {
					return false;
				}
			}
		}

		return true;
	}
};

export default codeExtractor;
