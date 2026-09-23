import test from 'node:test';
import assert from 'node:assert/strict';
import { sendFeedback } from '../src/utils/send-feedback.js';
import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';

const metadataWarnings = [
  'The provider accepted the message, but its Message-ID could not be retrieved.',
  'The provider accepted the message, but did not return an RFC Message-ID.',
];

test('accepted metadata-only lookup failures show localized sent feedback, including replays', () => {
  for (const locale of [zh, en]) {
    for (const deliveryWarning of metadataWarnings) {
      for (const status of [1, 2]) {
        const feedback = sendFeedback({ status, deliveryWarning, idempotentReplay: true }, key => locale[key]);
        assert.equal(feedback.title, locale.sendSuccessMsg);
        assert.equal(feedback.type, 'info');
        assert.equal(feedback.message, locale.sendThreadingUnavailable);
        assert.ok(feedback.duration > 0);
      }
    }
  }
});

test('uncertain delivery, combined persistence failures and demo sends remain persistent warnings', () => {
  for (const email of [
    { status: 5, deliveryWarning: metadataWarnings[0] },
    { status: 1, deliveryWarning: `${metadataWarnings[0]} Delivery was accepted, but local status persistence was incomplete.` },
    { status: 1, deliveryWarning: '1 internal recipient(s) could not be stored.' },
    { status: 5, deliveryWarning: 'The provider response was not confirmed; do not resend this message automatically.' },
    { status: 1, deliveryWarning: 'Simulated send. No email was delivered.' },
    { deliveryWarning: metadataWarnings[0] },
  ]) {
    const feedback = sendFeedback(email, key => zh[key]);
    assert.equal(feedback.title, zh.deliveryWarningTitle);
    assert.equal(feedback.type, 'warning');
    assert.equal(feedback.message, email.deliveryWarning);
    assert.equal(feedback.duration, 0);
  }
});

test('ordinary accepted sends retain success feedback and plain subject text', () => {
  assert.deepEqual(sendFeedback({ status: 1, subject: '<b>subject</b>' }, key => en[key]), {
    title: en.sendSuccessMsg, type: 'success', message: '<b>subject</b>', duration: 4500,
  });
});
