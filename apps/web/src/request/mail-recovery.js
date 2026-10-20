import http from '@/axios/index.js';

export const trashList = params => http.get('/mail-recovery/list', { params });
export const trashDetail = emailId => http.get('/mail-recovery/detail', { params: { emailId } });
export const trashRestore = emailIds => http.post('/mail-recovery/restore', { emailIds });
export const trashPurge = emailIds => http.post('/mail-recovery/purge', { emailIds });
export const trashEmptyPreview = () => http.post('/mail-recovery/empty-preview');
export const trashEmpty = (token, offset = 0) => http.post('/mail-recovery/empty', { token, offset });
export const deletedAliases = (page = 1, size = 20) => http.get('/mail-recovery/aliases', { params: { page, size } });
export const restoreAlias = accountId => http.post('/mail-recovery/restore-alias', { accountId });
