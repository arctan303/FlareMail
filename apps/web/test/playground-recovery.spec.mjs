import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaygroundApi } from '../src/playground/api.js';

test('preview Trash restores and permanently removes mail while retaining local attachments until reset', async () => {
  const api = createPlaygroundApi('en');
  await api.handle('DELETE', '/email/delete', {}, { emailIds: '1000,996' });
  const list = await api.handle('GET', '/mail-recovery/list', {}, { page: 1, size: 20 });
  assert.equal(list.total, 2); assert.ok(list.list.every(row => row.canRestore && row.deletedAt && row.expiresAt));
  const detail = await api.handle('GET', '/mail-recovery/detail', {}, { emailId: 996 });
  assert.equal(detail.attachments.length, 1);
  assert.match(await (await fetch(api.attachmentUrl(detail.attachments[0].key))).text(), /sample project brief/);
  await api.handle('POST', '/mail-recovery/restore', { emailIds: [1000] });
  assert.equal(api.state.emails.find(row => row.emailId === 1000).isDel, 0);
  assert.equal(api.state.emails.find(row => row.emailId === 1000).deletedAt, null);
  await api.handle('POST', '/mail-recovery/purge', { emailIds: [996] });
  assert.equal(api.state.emails.some(row => row.emailId === 996), false);
  assert.equal((await api.handle('GET', '/mail-recovery/list')).total, 0);
  assert.equal(createPlaygroundApi().state.emails.length, 87);
  api.dispose();
});

test('preview restores aliases independently and updates the default sender safely', async () => {
  const api = createPlaygroundApi('en');
  const message = api.state.emails.find(row => row.accountId === 2);
  await api.handle('PUT', '/account/setDefaultSend', { accountId: 2 });
  await api.handle('DELETE', '/email/delete', {}, { emailIds: String(message.emailId) });
  await api.handle('DELETE', '/account/delete', {}, { accountId: 2 });
  assert.equal(api.userInfo().accountCount, 2);
  assert.equal((await api.handle('GET', '/account/getDefaultSend')).accountId, 1);
  assert.equal((await api.handle('GET', '/mail-recovery/aliases')).list[0].accountId, 2);
  assert.equal((await api.handle('GET', '/mail-recovery/list')).list[0].canRestore, false);
  await assert.rejects(api.handle('POST', '/mail-recovery/restore', { emailIds: [message.emailId] }), error => error.code === 409);
  await assert.rejects(api.handle('PUT', '/account/setDefaultSend', { accountId: 12 }));
  await api.handle('POST', '/mail-recovery/restore-alias', { accountId: 2 });
  await api.handle('POST', '/mail-recovery/restore', { emailIds: [message.emailId] });
  assert.equal(api.userInfo().accountCount, 3);
  assert.equal((await api.handle('GET', '/account/getDefaultSend')).accountId, 2);
});

test('preview empty Trash processes a stable snapshot in bounded chunks and preserves later deletions', async () => {
  const api = createPlaygroundApi('en');
  const selected = api.state.emails.slice(0, 41).map(row => row.emailId);
  await api.handle('DELETE', '/email/delete', {}, { emailIds: selected.join(',') });
  const plan = await api.handle('POST', '/mail-recovery/empty-preview');
  assert.equal(plan.count, 41);
  const later = api.state.emails[41].emailId;
  await api.handle('DELETE', '/email/delete', {}, { emailIds: String(later) });
  await api.handle('POST', '/mail-recovery/restore', { emailIds: [selected[0]] });
  const first = await api.handle('POST', '/mail-recovery/empty', { token: plan.token, offset: 0 });
  assert.ok(first.deletedCount <= 40); assert.equal(first.nextOffset, 40);
  const last = await api.handle('POST', '/mail-recovery/empty', { token: plan.token, offset: 40 });
  assert.equal(last.nextOffset, null); assert.equal(first.deletedCount + last.deletedCount, 40);
  assert.equal((await api.handle('GET', '/mail-recovery/list')).list[0].emailId, later);
  assert.equal((await api.handle('POST', '/mail-recovery/empty', { token: plan.token, offset: 0 })).deletedCount, 0);
});

test('preview Trash generations prevent same-second restore/re-delete ABA and old token replay', async () => {
  const api = createPlaygroundApi('en');
  await api.handle('DELETE', '/email/delete', {}, { emailIds: '1000' });
  const message = api.state.emails.find(row => row.emailId === 1000), timestamp = message.deletedAt, revision = message.trashRevision;
  const plan = await api.handle('POST', '/mail-recovery/empty-preview');
  await api.handle('POST', '/mail-recovery/restore', { emailIds: [1000] });
  await api.handle('DELETE', '/email/delete', {}, { emailIds: '1000,999' });
  message.deletedAt = timestamp;
  assert.equal(message.trashRevision, revision + 1);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await api.handle('POST', '/mail-recovery/empty', { token: plan.token })).deletedCount, 0);
  assert.equal((await api.handle('GET', '/mail-recovery/list')).total, 2);
  const nextPlan = await api.handle('POST', '/mail-recovery/empty-preview');
  assert.equal((await api.handle('POST', '/mail-recovery/empty', { token: nextPlan.token })).deletedCount, 2);
});

test('preview Trash redacts historical received Bcc and retains only the owner sent copy', async () => {
  const api = createPlaygroundApi('en'), bcc = '[{"address":"private@hidden.test"}]';
  api.state.emails.find(row => row.emailId === 1000).bcc = bcc;
  api.state.emails.find(row => row.emailId === 1100).bcc = bcc;
  await api.handle('DELETE', '/email/delete', {}, { emailIds: '1000,1100' });
  assert.equal((await api.handle('GET', '/mail-recovery/detail', {}, { emailId: 1000 })).bcc, '[]');
  assert.equal((await api.handle('GET', '/mail-recovery/detail', {}, { emailId: 1100 })).bcc, bcc);
  assert.equal((await api.handle('GET', '/mail-recovery/list')).list.find(row => row.emailId === 1000).bcc, '[]');
});

test('preview hides expired and unfinished Trash and uses exact, owned contact correspondence with paging', async () => {
  const api = createPlaygroundApi('en');
  await api.handle('DELETE', '/email/delete', {}, { emailIds: '1000' });
  const expired = api.state.emails.find(row => row.emailId === 1000);
  expired.deletedAt = new Date(Date.now() - 31 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  api.state.emails.push({ ...expired, emailId: 3001, status: 6, deletedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  assert.equal((await api.handle('GET', '/mail-recovery/list')).total, 0);
  await assert.rejects(api.handle('POST', '/mail-recovery/restore', { emailIds: [1000] }), error => error.code === 409);
  const first = await api.handle('GET', '/contact/timeline', {}, { email: 'MAYA@example.net', size: 2 });
  assert.equal(first.list.length, 2); assert.equal(first.hasMore, true);
  assert.ok(first.list.some(row => row.direction === 'out'));
  const older = await api.handle('GET', '/contact/timeline', {}, { email: 'maya@example.net', size: 50, beforeId: first.nextBeforeId });
  assert.ok(older.list.every(row => row.emailId < first.nextBeforeId));
  api.state.emails.push({ ...api.state.emails[1], emailId: 4001, userId: 2, sendEmail: 'maya@example.net' });
  assert.ok(!(await api.handle('GET', '/contact/timeline', {}, { email: 'maya@example.net' })).list.some(row => row.emailId === 4001));
  assert.equal((await api.handle('GET', '/contact/timeline', {}, { email: 'aya@example.net' })).list.length, 0);
});
