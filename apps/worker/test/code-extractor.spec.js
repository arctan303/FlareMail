import { describe, it, expect } from 'vitest';
import codeExtractor from '../src/utils/code-extractor';

describe('codeExtractor Verification Code Recognition', () => {
	describe('1. Global Major Platforms', () => {
		it('extracts Google verification code with G- prefix', () => {
			const email = {
				subject: '【Google】G-492108 是您的 Google 验证码',
				text: 'G-492108 是您的 Google 验证码。请勿与任何人分享此验证码。'
			};
			expect(codeExtractor.extract(email)).toBe('G-492108');
		});

		it('extracts GitHub device verification code', () => {
			const email = {
				subject: '[GitHub] Please verify your device',
				text: 'A sign in attempt requires further verification. Verification code: 829143'
			};
			expect(codeExtractor.extract(email)).toBe('829143');
		});

		it('extracts Steam Guard alphanumeric code', () => {
			const email = {
				subject: 'Your Steam account: Access from new computer',
				text: 'Here is the standard Steam Guard code: H9KJ2\nThis code expires in 15 minutes.'
			};
			expect(codeExtractor.extract(email)).toBe('H9KJ2');
		});

		it('extracts Microsoft account security code', () => {
			const email = {
				subject: 'Microsoft account security code',
				text: 'Please use the security code 892301 to verify your Microsoft account.'
			};
			expect(codeExtractor.extract(email)).toBe('892301');
		});

		it('extracts Apple ID verification code', () => {
			const email = {
				subject: 'Your Apple ID Code',
				text: 'Your Apple ID Code is: 582910. Don\'t share it with anyone.'
			};
			expect(codeExtractor.extract(email)).toBe('582910');
		});

		it('extracts Telegram login code', () => {
			const email = {
				subject: 'Telegram login code',
				text: 'Telegram code: 49201. You can also tap this link to log in.'
			};
			expect(codeExtractor.extract(email)).toBe('49201');
		});

		it('extracts Discord verification code', () => {
			const email = {
				subject: 'Verify your Discord account',
				text: 'Your Discord verification code is: 938472'
			};
			expect(codeExtractor.extract(email)).toBe('938472');
		});

		it('extracts Amazon OTP with suffix descriptor', () => {
			const email = {
				subject: 'Amazon password assistance',
				text: '492019 is your Amazon OTP. Do not share it with anyone.'
			};
			expect(codeExtractor.extract(email)).toBe('492019');
		});

		it('extracts Stripe spaced grouping code and normalizes it', () => {
			const email = {
				subject: 'Your Stripe verification code',
				text: 'Your verification code is 382 194. It expires in 10 minutes.'
			};
			expect(codeExtractor.extract(email)).toBe('382194');
		});

		it('extracts Notion login code', () => {
			const email = {
				subject: 'Login code for Notion',
				text: 'Temporary login code for Notion: 749102\nValid for 15 minutes.'
			};
			expect(codeExtractor.extract(email)).toBe('749102');
		});
	});

	describe('2. Domestic Platforms (China)', () => {
		it('extracts Bilibili verification code', () => {
			const email = {
				subject: '【哔哩哔哩】邮箱验证码',
				text: '【哔哩哔哩】验证码：849201，5分钟内有效，请勿泄露给他人。'
			};
			expect(codeExtractor.extract(email)).toBe('849201');
		});

		it('extracts Alibaba Cloud verification code', () => {
			const email = {
				subject: '阿里云身份验证',
				text: '【阿里云】验证码为：492103，您正在进行身份验证，请在10分钟内填写。'
			};
			expect(codeExtractor.extract(email)).toBe('492103');
		});

		it('extracts Tencent Cloud dynamic code', () => {
			const email = {
				subject: '腾讯云账号安全验证',
				text: '【腾讯云】您的动态验证码是 729104 (5分钟有效)，请勿将验证码泄露给他人。'
			};
			expect(codeExtractor.extract(email)).toBe('729104');
		});

		it('extracts Zhihu code with brackets', () => {
			const email = {
				subject: '知乎账号验证',
				text: '【知乎】849102（登录验证码），请在30分钟内完成填写。'
			};
			expect(codeExtractor.extract(email)).toBe('849102');
		});

		it('extracts Huawei account code with quotes', () => {
			const email = {
				subject: '华为账号安全通知',
				text: '尊敬的用户，您的华为账号验证码是“392014”，用于修改安全邮箱。'
			};
			expect(codeExtractor.extract(email)).toBe('392014');
		});
	});

	describe('3. Multi-language & Special Formats', () => {
		it('extracts Japanese confirmation code', () => {
			const email = {
				subject: 'アカウント確認',
				text: '確認コード: 849201\nこのコードは10分間有効です。'
			};
			expect(codeExtractor.extract(email)).toBe('849201');
		});

		it('extracts Korean authentication code', () => {
			const email = {
				subject: '인증 번호 안내',
				text: '인증번호: 394820\n타인에게 노출하지 마세요.'
			};
			expect(codeExtractor.extract(email)).toBe('394820');
		});

		it('extracts code directly from Subject', () => {
			const email = {
				subject: '【GitHub】Your device verification code is 918234',
				text: 'Hello user, please see the subject for the code.'
			};
			expect(codeExtractor.extract(email)).toBe('918234');
		});

		it('extracts bracketed code from Subject', () => {
			const email = {
				subject: '【738291】是您的验证码',
				text: '如非本人操作请忽略。'
			};
			expect(codeExtractor.extract(email)).toBe('738291');
		});
	});

	describe('4. HTML DOM Visual Heuristics', () => {
		it('extracts code styled with large font in HTML', () => {
			const email = {
				subject: 'Your security code',
				text: '',
				html: `
					<html>
						<body>
							<p>Please enter the following security code:</p>
							<div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; text-align: center;">
								849201
							</div>
							<p>This code will expire in 10 minutes.</p>
						</body>
					</html>
				`
			};
			expect(codeExtractor.extract(email)).toBe('849201');
		});

		it('extracts code in class-marked table cell', () => {
			const email = {
				subject: 'One-time verification',
				text: '',
				html: `
					<html>
						<body>
							<table>
								<tr>
									<td class="code-box">938471</td>
								</tr>
							</table>
							<p>Valid within 5 minutes. Do not share.</p>
						</body>
					</html>
				`
			};
			expect(codeExtractor.extract(email)).toBe('938471');
		});
	});

	describe('5. Fallback Context & Proximity Search', () => {
		it('extracts standalone code near expiration notice', () => {
			const email = {
				subject: 'Security Notice',
				text: 'Your temporary access key is 648291. It is valid for 10 minutes. Do not share this.'
			};
			expect(codeExtractor.extract(email)).toBe('648291');
		});
	});

	describe('6. Negative Tests (Ensuring No False Positives)', () => {
		it('returns empty string for empty inputs', () => {
			expect(codeExtractor.extract({})).toBe('');
			expect(codeExtractor.extract({ subject: '', text: '', html: '' })).toBe('');
		});

		it('does not falsely extract year in normal notification email', () => {
			const email = {
				subject: 'Meeting Schedule for 2026',
				text: 'Hello John, let us meet on 2026-08-19 to discuss Q3 targets. Copyright 2026 Acme Corp.'
			};
			expect(codeExtractor.extract(email)).toBe('');
		});

		it('does not falsely extract long order tracking numbers', () => {
			const email = {
				subject: 'Your order has been shipped',
				text: 'Your order #1982738491823 is on its way. Delivery estimate: 3 days.'
			};
			expect(codeExtractor.extract(email)).toBe('');
		});

		it('does not falsely extract HTTP status or port numbers', () => {
			const email = {
				subject: 'Server Alert: Port 8080 down',
				text: 'The worker on port 8080 returned HTTP 500. Please check status.'
			};
			expect(codeExtractor.extract(email)).toBe('');
		});

		it('does not falsely extract generic english words like POST, NULL, CODE', () => {
			const email = {
				subject: 'API Update: POST endpoint added',
				text: 'Please review the NULL handling in the CODE repository.'
			};
			expect(codeExtractor.extract(email)).toBe('');
		});
	});
});
