import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

const MONTH_DAY = { zh: 'M月D日', en: 'MMM D' };
const FULL_DATE = { zh: 'YYYY年M月D日', en: 'MMM D, YYYY' };

let activeLocale = 'zh';

// Kept as a module-level locale so callers do not have to thread it through,
// and so this module stays free of app aliases (it is unit-tested directly).
export function setMailListLocale(locale) {
  activeLocale = MONTH_DAY[locale] ? locale : 'zh';
}

// Stored mail dates are UTC; day/year boundaries follow the reader's local time.
export function formatMailListTime(value, now = new Date(), locale = activeLocale) {
  if (!value) return '';
  const date = dayjs.utc(value).local();
  const current = dayjs(now);
  if (!date.isValid()) return '';
  if (date.isSame(current, 'day')) return date.format('HH:mm');
  return date.year() === current.year()
    ? date.format(MONTH_DAY[locale] || MONTH_DAY.zh)
    : date.format(FULL_DATE[locale] || FULL_DATE.zh);
}
