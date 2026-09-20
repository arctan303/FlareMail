import {useUserStore} from "@/store/user.js";
import {useSettingStore} from "@/store/setting.js";
import {useAccountStore} from "@/store/account.js";
import {loginUserInfo} from "@/request/my.js";
import {permsToRouter} from "@/perm/perm.js";
import router from "@/router";
import {websiteConfig} from "@/request/setting.js";
import { resolveLocale } from "@/utils/locale.js";
import i18n from "@/i18n/index.js";
import {setupStatus} from "@/request/login.js";
import {hasAuthenticatedSession, setAuthenticatedSession} from "@/utils/session-state.js";
import {
    clearUserScopedStorage,
    installUserScopedStateSync,
    invalidateUserScopedStateAcrossTabs,
} from "@/utils/sensitive-state.js";
import {runAfterSetupGate} from "@/utils/setup-gate.js";
import {shouldProbeAuthenticatedSession} from "@/utils/oauth-return.js";
import {DEFAULT_BRAND, applyBrandToDocument, cacheBrand, getCachedBrand, normalizeBrand} from "@/utils/brand.js";
import { applyThemeAccent } from "@/utils/theme-accent.js";

export async function init() {
    applyThemeAccent();
    installUserScopedStateSync();
    // The brand only arrives with /setting/websiteConfig, two round trips from here.
    // Reapplying the cached one keeps the tab title and the splash logo from snapping
    // back to the default while that request is in flight.
    const cachedBrand = getCachedBrand()
    applyBrandToDocument(cachedBrand || DEFAULT_BRAND)

    const settingStore = useSettingStore();
    const userStore = useUserStore();
    const accountStore = useAccountStore();
    const currentUrl = new URL(window.location.href);
    const oauthJustLoggedIn = currentUrl.searchParams.get('oauth') === '1';
    const shouldProbeSession = shouldProbeAuthenticatedSession({
        hasSessionHint: hasAuthenticatedSession(),
        oauthJustLoggedIn,
        redirect: currentUrl.searchParams.get('redirect'),
        origin: currentUrl.origin,
    });

    if (!hasAuthenticatedSession() || oauthJustLoggedIn) {
        clearUserScopedStorage();
    }

    // Resolved before the first await so the initial paint is already in the right
    // language. An account preference, when one exists, overrides this after login.
    settingStore.setLang(resolveLocale(''))

    const setupGate = await runAfterSetupGate({
        getStatus: setupStatus,
        readyAction: async () => {
            const userPromise = shouldProbeSession
                ? loginUserInfo({noMsg: true}).catch(() => null)
                : Promise.resolve(null);
            return Promise.all([websiteConfig(), userPromise]);
        },
    });
    const setup = setupGate.status;
    settingStore.setupStatus = setup;

    if (!setupGate.ready) {
        settingStore.settings = {
            ...(cachedBrand || DEFAULT_BRAND),
            setupRequired: setup.setupRequired === true,
            upgradeRequired: setup.upgradeRequired === true,
            upgradeBlocking: setup.upgradeBlocking !== false,
            upgradeSupported: setup.upgradeSupported !== false,
        }
        settingStore.domainList = []
        applyBrandToDocument(settingStore.settings, setup.upgradeRequired ? i18n.global.t('dbUpgradeTitle') : i18n.global.t('serviceInitDocTitle'))
        setAuthenticatedSession(false)
        return
    }

    const [setting, user] = setupGate.value;
    settingStore.settings = {...setting, ...normalizeBrand(setting), ...setup};
    applyBrandToDocument(settingStore.settings);
    cacheBrand(settingStore.settings);
    settingStore.domainList = setting.domainList;

    setAuthenticatedSession(!!user);
    if (user) {
        // The account preference is authoritative; an empty value means "never chosen",
        // in which case the cached/browser locale resolved above stays in effect.
        if (user.locale) settingStore.setLang(user.locale);
        accountStore.currentAccountId = user.account.accountId;
        accountStore.currentAccount = user.account;
        userStore.user = user;

        const routers = permsToRouter(user.permKeys);
        routers.forEach(routerData => {
            router.addRoute('layout', routerData);
        });

        if (oauthJustLoggedIn) {
            invalidateUserScopedStateAcrossTabs();
        }
    }
}
