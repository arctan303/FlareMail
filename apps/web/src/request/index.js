import http from '@/axios/index.js';

// Account APIs
export function accountList(accountId = 0, size = 30, lastSort) {
    const params = { accountId, size };
    if (lastSort !== undefined && lastSort !== null && lastSort !== '') {
        params.lastSort = lastSort;
    }
    return http.get('/account/list', { params });
}

export function accountAdd(email) {
    return http.post('/account/add', { email });
}

export function accountSetName(accountId, name) {
    return http.put('/account/setName', { name, accountId });
}

export function accountDelete(accountId) {
    return http.delete('/account/delete', { params: { accountId } });
}

export function accountSetAllReceive(accountId) {
    return http.put('/account/setAllReceive', { accountId });
}

export function accountSetForward(accountId, forwardStatus) {
    return http.put('/account/setForward', { accountId, forwardStatus });
}

export function accountSetAsTop(accountId) {
    return http.put('/account/setAsTop', { accountId });
}

export function accountSetDefaultSend(accountId) {
    return http.put('/account/setDefaultSend', { accountId });
}

export function accountGetDefaultSend() {
    return http.get('/account/getDefaultSend');
}

// Contact APIs
export function contactList(params) {
    return http.get('/contact/list', { params });
}

export function contactGroups() {
    return http.get('/contact/groups');
}

export function contactDetail(contactId) {
    return http.get('/contact/detail', { params: { contactId } });
}

export function contactAdd(data) {
    return http.post('/contact/add', data);
}

export function contactUpdate(data) {
    return http.put('/contact/update', data);
}

export function contactDelete(data) {
    return http.delete('/contact/delete', { data });
}

// Email APIs
export function emailList(accountId, allReceive, emailId, timeSort, size, type, keyword, filter, offset, view) {
    return http.get('/email/list', {
        params: { accountId, allReceive, emailId, timeSort, size, type, keyword: keyword || undefined, filter: filter || undefined, offset, view }
    });
}

export function emailDelete(emailIds) {
    return http.delete('/email/delete?emailIds=' + emailIds);
}

export function emailLatest(emailId, accountId, allReceive) {
    return http.get('/email/latest', {
        params: { emailId, accountId, allReceive },
        noMsg: true,
        timeout: 35 * 1000
    });
}

export function emailConversation(emailId, size = 20, before) {
    return http.get('/email/conversation', { params: { emailId, size, before: before || undefined }, noMsg: true });
}

export function emailConversationRead(emailId, readThroughEmailId) {
    return http.put('/email/conversation/read', { emailId, readThroughEmailId });
}

export function emailConversationState(emailIds, action, view) {
    return http.put('/email/conversation/state', { emailIds, action, view });
}

export function emailRead(emailIds) {
    return http.put('/email/read', { emailIds });
}

export function emailUnread(emailIds) {
    return http.put('/email/unread', { emailIds });
}

export function emailSend(form, progress) {
    return http.post('/email/send', form, {
        onUploadProgress: (e) => {
            if (progress) progress(e);
        },
        noMsg: true
    });
}

// Login & Auth APIs
export function login(email, password, turnstileToken = '') {
    return http.post('/login', { email, password, turnstileToken });
}

export function logout() {
    return http.delete('/logout');
}

export function setupStatus() {
    return http.get('/setup/status', { noMsg: true });
}

export function setupVerify(setupToken) {
    return http.post('/setup/verify', { setupToken }, { noMsg: true });
}

export function setupAdmin(setupSession, email, password, domains) {
    return http.post('/setup', { setupSession, email, password, domains });
}

export function setupUpgrade(setupToken) {
    return http.post('/setup/upgrade', { setupToken });
}

export function loginSecurity() {
    return http.get('/login/security', { noMsg: true });
}

// OAuth APIs
export function oauthBindStart(config = {}) {
    return http.get('/oauth/bind/start', {
        ...config,
        params: { ...config.params, response: 'json' },
    });
}

export function oauthUnbind(config = {}) {
    return http.post('/oauth/unbind', undefined, config);
}

// My APIs
export function loginUserInfo(config = {}) {
    return http.get('/my/loginUserInfo', config);
}

export function settingsConfirmationStatus() {
    return http.get('/setting/confirmation/status', { noMsg: true });
}

export function confirmationSettings() {
    return http.get('/setting/confirmation', { noMsg: true });
}

export function confirmationSettingsSet(data) {
    return http.put('/setting/confirmation', data, { noMsg: true });
}

export function recentAuthStatus() {
    return http.get('/my/reauth/status', { noMsg: true });
}

export function recentAuthPassword(password) {
    return http.post('/my/reauth/password', { password }, { noMsg: true });
}

export function resetPassword(password, config = {}) {
    return http.put('/my/resetPassword', { password }, config);
}

export function setForward(forwardStatus, mainForwardStatus, forwardEmail) {
    return http.put('/my/forward', { forwardStatus, mainForwardStatus, forwardEmail });
}

export function setUserLocale(locale, config = {}) {
    return http.put('/my/locale', { locale }, config);
}

export function genCliToken(config = {}) {
    return http.post('/my/genCliToken', undefined, config);
}

export function revokeCliToken(config = {}) {
    return http.post('/my/revokeCliToken', undefined, config);
}

// Setting APIs
export function settingSet(setting) {
    return http.put('/setting/set', setting);
}

export function settingQuery() {
    return http.get('/setting/query');
}

export function websiteConfig() {
    return http.get('/setting/websiteConfig');
}

export function brandAssetUpload(formData, config = {}) {
    return http.post('/setting/brand-assets', formData, config);
}

export function oauthProviderConfig() {
    return http.get('/setting/oauth-provider');
}

export function oauthProviderSetEnabled(enabled, revision) {
    return http.put('/setting/oauth-provider/enabled', { enabled, revision });
}

export function oauthProviderSetClients(revision, clients) {
    return http.put('/setting/oauth-provider/clients', { revision, clients });
}

export function upgradeDatabase() {
    return http.post('/admin/upgrade');
}

export function adminSchemaStatus() {
    return http.get('/admin/schema');
}

export function migratePrimaryEmail(targetEmail) {
    return http.post('/admin/migrate-primary-email', { targetEmail });
}

export function adminDomains() {
    return http.get('/admin/domains');
}

export function adminDomainsAdd(domains, revision) {
    return http.post('/admin/domains', { domains, revision });
}

// Runtime business configuration APIs
export function runtimeConfigQuery() {
    return http.get('/setting/runtime', { noMsg: true });
}

export function runtimeConfigSet(config) {
    return http.put('/setting/runtime', config);
}

export function revealOauthSecret(password) {
    return http.post('/setting/runtime/oauth-secret', { password }, { noMsg: true });
}


// Star APIs
export function starAdd(emailId) {
    return http.post('/star/add', { emailId });
}

export function starCancel(emailId) {
    return http.delete('/star/cancel', { params: { emailId } });
}

export function starList(emailId, size, keyword, offset, accountId, view) {
    return http.get('/star/list', { params: { emailId, size, keyword: keyword || undefined, offset, accountId, view } });
}

// Unmatched APIs
export function unmatchedList(page, size) {
    return http.get('/unmatched/list', { params: { page, size } });
}

export function unmatchedDetail(emailId) {
    return http.get('/unmatched/detail', { params: { emailId } });
}

export function unmatchedDelete(emailId) {
    return http.delete('/unmatched/delete', { params: { emailId } });
}

export function unmatchedGetPolicy() {
    return http.get('/setting/unmatched-policy');
}

export function unmatchedSetPolicy(policy) {
    return http.put('/setting/unmatched-policy', { policy });
}

// User APIs
export function userList(params) {
    return http.get('/user/list', { params: { ...params } });
}

export function userSetPwd(params) {
    return http.put('/user/setPwd', params);
}

export function userSetStatus(params) {
    return http.put('/user/setStatus', params);
}

export function userDelete(userIds) {
    return http.delete('/user/delete', { params: { userIds: userIds + '' } });
}

export function userAdd(form) {
    return http.post('/user/add', form);
}

export function userRestSendCount(userId) {
    return http.put('/user/resetSendCount', { userId });
}

export function userRestore(userId, type) {
    return http.put('/user/restore', { userId, type });
}

export function userAllAccount(userId, num, size) {
    return http.get('/user/allAccount', { params: { userId, num, size } });
}

export function userDeleteAccount(accountId) {
    return http.delete('/user/deleteAccount', { params: { accountId } });
}

export function userAddAccount(userId, email) {
    return http.post('/user/addAccount', { userId, email });
}

export function userUpdateSendLimit(userId, sendLimit) {
    return http.put('/user/updateSendLimit', { userId, sendLimit });
}

export function userUpdateAccountLimit(userId, accountLimit) {
    return http.put('/user/updateAccountLimit', { userId, accountLimit });
}
