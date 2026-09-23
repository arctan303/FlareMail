// Exact legacy API warnings, including persisted idempotent replays. Do not
// soften combined or unknown warnings: they may describe a real delivery issue.
const THREADING_WARNINGS = new Set([
  'The provider accepted the message, but its Message-ID could not be retrieved.',
  'The provider accepted the message, but did not return an RFC Message-ID.',
]);

export function sendFeedback(email, t) {
  const warning = email?.deliveryWarning || '';
  // Wire status 1 = SENT, 2 = DELIVERED. An uncertain outcome stays a warning.
  if ([1, 2].includes(email?.status) && THREADING_WARNINGS.has(warning)) {
    return {
      title: t('sendSuccessMsg'),
      type: 'info',
      message: t('sendThreadingUnavailable'),
      duration: 8000,
    };
  }
  return {
    title: t(warning ? 'deliveryWarningTitle' : 'sendSuccessMsg'),
    type: warning ? 'warning' : 'success',
    message: warning || email?.subject,
    duration: warning ? 0 : 4500,
  };
}
