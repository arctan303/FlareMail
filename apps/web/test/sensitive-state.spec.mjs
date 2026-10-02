import test from 'node:test';
import assert from 'node:assert/strict';
import {
    installUserScopedStateSync,
    invalidateUserScopedStateAcrossTabs,
    clearUserScopedStorage,
} from '../src/utils/sensitive-state.js';

test('clears sensitive state locally and invalidates other tabs without removing theme', () => {
    const values = new Map([
        ['email', 'old email'],
        ['writer', 'old recipients'],
        ['user-params', 'old filters'],
        ['tinymce-url-history', 'https://private.example/token'],
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
    assert.equal(values.has('tinymce-url-history'), false);
    assert.equal(values.get('arc-theme'), 'dark');

    const epochKey = [...values.keys()].find(key => key.startsWith('mail-user-state-epoch'));
    assert.ok(epochKey);

    values.set('email', 'stale tab write');
    values.set('tinymce-url-history', 'stale private URL');
    listeners.get('storage')({ key: epochKey, newValue: values.get(epochKey) });
    assert.equal(values.has('email'), false);
    assert.equal(values.has('tinymce-url-history'), false);
    assert.equal(reloads, 1);

    values.set('writer', 'write during unload');
    values.set('tinymce-url-history', 'late editor write');
    listeners.get('pagehide')();
    assert.equal(values.has('writer'), false);
    assert.equal(values.has('tinymce-url-history'), false);
    assert.equal(values.get('arc-theme'), 'dark');
});

test('a failed cache deletion does not leave editor history uncleared', () => {
    const removed = [];
    globalThis.localStorage = { removeItem(key) { if (key === 'email') throw new Error('unavailable'); removed.push(key); } };
    clearUserScopedStorage();
    assert.ok(removed.includes('tinymce-url-history'));
    delete globalThis.localStorage;
});
