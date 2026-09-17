import { createI18n } from 'vue-i18n';
import zh from './zh.js'
import en from './en.js'

// Locale selection lives in utils/locale.js; this file only wires the messages in.
// fallbackLocale keeps a not-yet-translated key readable instead of printing the raw
// key name; the parity test in test/i18n-parity.spec.mjs is what catches the gap.
const i18n = createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'zh',
    missingWarn: import.meta.env.DEV,
    fallbackWarn: import.meta.env.DEV,
    messages: {
        zh,
        en
    },
});

export default i18n;
