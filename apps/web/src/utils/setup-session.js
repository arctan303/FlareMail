// Installation authorization is intentionally process memory only. Do not move this state into browser persistence.
let setupSession = null;
let expiresAt = null;
export function setSetupSession(session, expiry) {
    if (typeof session !== 'string' || !session.trim()) throw new TypeError('A setup session is required.');
    setupSession = session; expiresAt = expiry ?? null;
}
export function getSetupSession() { return { setupSession, expiresAt }; }
export function clearSetupSession() { setupSession = null; expiresAt = null; }
export function hasSetupSession() { return typeof setupSession === 'string' && setupSession.length > 0; }
