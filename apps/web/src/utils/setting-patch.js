const SECTION_FIELDS = {
    core: ['receive', 'send', 'loginDomain', 'r2Domain'],
    channels: ['mailProvider'],
    mail: ['blackFrom', 'blackSubject', 'blackContent'],
    auth: ['googleOauthEnabled', 'googleClientId'],
    brand: ['title', 'siteDescription', 'siteLogo', 'siteFavicon', 'sitePwaIcons', 'loginCopy'],
};
const SENSITIVE_FIELDS = new Set(['googleOauthEnabled', 'googleClientId', 'googleClientSecret', 'resendTokens', 'mailProvider']);

export function needsSettingConfirmation(payload) {
    return Object.keys(payload).some(key => SENSITIVE_FIELDS.has(key));
}

export function buildSettingPatch(section, form, baseline, extras = {}) {
    const current = section === 'brand' ? extras.brand : form;
    const previous = section === 'brand' ? extras.brandBaseline : baseline;
    const result = {};
    for (const key of SECTION_FIELDS[section] || []) {
        const normalize = value => ['googleClientId', 'r2Domain'].includes(key) ? String(value || '').trim() : value;
        const value = normalize(current?.[key]);
        if (value !== undefined && JSON.stringify(value) !== JSON.stringify(normalize(previous?.[key]))) result[key] = value;
    }
    if (section === 'auth' && extras.googleClientSecret?.trim()) result.googleClientSecret = extras.googleClientSecret.trim();
    if (section === 'mail' || section === 'channels') {
        const tokens = Object.fromEntries(Object.entries(extras.resendTokens || {}).filter(([, value]) => value));
        if (Object.keys(tokens).length) result.resendTokens = tokens;
    }
    return result;
}
