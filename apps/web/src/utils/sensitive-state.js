const USER_SCOPED_STORAGE_KEYS = [
    'email',
    'writer',
    'user-params',
];

const USER_STATE_INVALIDATION_KEY = 'mail-user-state-epoch';
let syncInstalled = false;

export function clearUserScopedStorage() {
    try {
        for (const key of USER_SCOPED_STORAGE_KEYS) {
            localStorage.removeItem(key);
        }
    } catch {
        // A page reload still clears in-memory state when browser storage is unavailable.
    }
}

export function invalidateUserScopedStateAcrossTabs() {
    clearUserScopedStorage();
    try {
        localStorage.setItem(
            USER_STATE_INVALIDATION_KEY,
            `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
    } catch {
        // The current tab is still cleared even when cross-tab notification is unavailable.
    }
}

export function installUserScopedStateSync() {
    if (syncInstalled || typeof window === 'undefined') return;
    syncInstalled = true;

    window.addEventListener('storage', event => {
        if (event.key !== USER_STATE_INVALIDATION_KEY || !event.newValue) return;

        clearUserScopedStorage();
        window.addEventListener('pagehide', clearUserScopedStorage, { once: true });
        window.location.reload();
    });
}
