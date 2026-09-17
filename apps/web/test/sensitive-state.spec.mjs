import test from 'node:test';
import assert from 'node:assert/strict';
import {
    installUserScopedStateSync,
    invalidateUserScopedStateAcrossTabs,
} from '../src/utils/sensitive-state.js';

test('clears sensitive state locally and invalidates other tabs without removing theme', () => {
    const values = new Map([
        ['email', 'old email'],
        ['writer', 'old recipients'],
        ['user-params', 'old filters'],
        ['arc-theme', 'dark'],
    ]);
    const listeners = new Map();
    let reloads = 0;

    globalThis.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    globalThis.window = {
        addEventListener: (type, listener) => listeners.set(type, listener),
        location: { reload: () => { reloads += 1; } },
    };

    installUserScopedStateSync();
    invalidateUserScopedStateAcrossTabs();

    assert.equal(values.has('email'), false);
    assert.equal(values.has('writer'), false);
    assert.equal(values.has('user-params'), false);
    assert.equal(values.get('arc-theme'), 'dark');

    const epochKey = [...values.keys()].find(key => key.startsWith('mail-user-state-epoch'));
    assert.ok(epochKey);

    values.set('email', 'stale tab write');
    listeners.get('storage')({ key: epochKey, newValue: values.get(epochKey) });
    assert.equal(values.has('email'), false);
    assert.equal(reloads, 1);

    values.set('writer', 'write during unload');
    listeners.get('pagehide')();
    assert.equal(values.has('writer'), false);
    assert.equal(values.get('arc-theme'), 'dark');
});
