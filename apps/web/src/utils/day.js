import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const DAYJS_LOCALES = { zh: 'zh-cn', en: 'en' }

// The format string itself carries Chinese literals, so English needs its own.
const DETAIL_FORMATS = {
    zh: 'YYYY年M月D日 ddd AH:mm',
    en: 'ddd, MMM D, YYYY h:mm A',
}

let activeLocale = 'zh'

dayjs.locale(DAYJS_LOCALES.zh)

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function setDayjsLocale(locale) {
    activeLocale = DAYJS_LOCALES[locale] ? locale : 'zh'
    dayjs.locale(DAYJS_LOCALES[activeLocale])
}

export function formatDetailDate(time) {
    const d = dayjs.utc(time).tz(timeZone);
    return d.format(DETAIL_FORMATS[activeLocale] || DETAIL_FORMATS.zh);
}

export function tzDayjs(time) {
    return dayjs.utc(time).tz(timeZone);
}

export function toUtc(time) {
    return dayjs(time).utc();
}
