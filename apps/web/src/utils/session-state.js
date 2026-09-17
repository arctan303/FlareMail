const SESSION_HINT_KEY = 'mail_session_hint';

function readSessionHint() {
    try {
        return localStorage.getItem(SESSION_HINT_KEY) === '1';
    } catch {
        return false;
    }
}

let authenticated = readSessionHint();

export function hasAuthenticatedSession() {
    return authenticated;
}

export function setAuthenticatedSession(value) {
    authenticated = value === true;
    try {
        if (authenticated) {
            localStorage.setItem(SESSION_HINT_KEY, '1');
        } else {
            localStorage.removeItem(SESSION_HINT_KEY);
        }
    } catch {
        // The in-memory hint is sufficient when storage is unavailable.
    }
}
