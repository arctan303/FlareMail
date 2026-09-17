import BizError from '../error/biz-error';
import userService from './user-service';
import { isDel, userConst } from '../const/entity-const';
import cryptoUtils from '../utils/crypto-utils';
import sessionService from './session-service';
import recentAuthService from './recent-auth-service';
import confirmationPolicyService, { ConfirmationUpgradeRequired } from './confirmation-policy-service';
import { dbInit } from '../init/init';
import { t } from '../i18n/i18n';

const loginService = {
	async createLoginSession(c, userRow) {
		if (!userRow || userRow.isDel === isDel.DELETE || userRow.status === userConst.status.BAN) {
			throw new BizError(t('IncorrectPwd') || '账号或密码错误', 401);
		}
		let confirmationAvailable = true;
		try {
			await confirmationPolicyService.read(c);
		} catch (error) {
			if (!(error instanceof ConfirmationUpgradeRequired)) throw error;
			const status = await dbInit.setupStatus(c);
			if (status.setupRequired || status.upgradeBlocking !== false || !status.upgradeSupported) throw error;
			confirmationAvailable = false;
		}
		await userService.updateUserInfo(c, userRow.userId);
		const session = await sessionService.create(
			c,
			userRow.userId,
			await cryptoUtils.hashSecret(userRow.password),
		);
		// A compatible pending patch permits login but never grants a confirmation
		// proof. Protected mutations still require the real persisted policy.
		if (confirmationAvailable) await recentAuthService.grant(c, session, userRow.userId);
	},

	async login(c, params, noVerifyPwd = false) {

		const { email, password } = params;
		const authError = () => new BizError(t('IncorrectPwd') || '账号或密码错误', 401);

		if ((!email || !password) && !noVerifyPwd) {
			throw authError();
		}
		if (!noVerifyPwd && cryptoUtils.passwordLength(password) > 256) {
			throw authError();
		}

		const userRow = await userService.selectByEmailIncludeDel(c, email);

		if (!userRow) {
			throw authError();
		}

		if(userRow.isDel === isDel.DELETE) {
			throw authError();
		}

		if(userRow.status === userConst.status.BAN) {
			throw authError();
		}
		if (!noVerifyPwd) {
			const verification = await cryptoUtils.verifyPasswordDetailed(password, userRow.salt, userRow.password);
			if (!verification.valid) throw authError();
			if (verification.needsUpgrade) {
				const upgradedHash = await userService.upgradePasswordHash(
					c, userRow.userId, password, userRow.password, userRow.salt,
				);
				if (!upgradedHash) throw authError();
				userRow.password = upgradedHash;
			}
		}

		await this.createLoginSession(c, userRow);
	},

	async logout(c) {
		await sessionService.revokeCurrent(c);
	}

};

export default loginService;
