import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createRecentAuthCoordinator,
    runConfirmedAction,
} from '../src/utils/recent-auth.js';

test('cancelling recent authentication never calls the sensitive action', async () => {
    let actionCalls = 0;
    const coordinator = createRecentAuthCoordinator({
        getStatus: async () => ({ valid: false }),
        requestAuthentication: async () => false,
    });

    const result = await coordinator.run('解绑 Google 账号', async () => {
        actionCalls += 1;
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(actionCalls, 0);
});

test('a 428 response triggers one new challenge and one retry', async () => {
    let actionCalls = 0;
    let challengeCalls = 0;
    const coordinator = createRecentAuthCoordinator({
        getStatus: async () => ({ valid: true }),
        requestAuthentication: async () => {
            challengeCalls += 1;
            return true;
        },
    });

    const result = await coordinator.run('轮换 CLI Token', async () => {
        actionCalls += 1;
        if (actionCalls === 1) throw { code: 428 };
        return 'new-token';
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.value, 'new-token');
    assert.equal(actionCalls, 2);
    assert.equal(challengeCalls, 1);
});

test('a second 428 is returned without another challenge or retry', async () => {
    let actionCalls = 0;
    let challengeCalls = 0;
    const coordinator = createRecentAuthCoordinator({
        getStatus: async () => ({ valid: true }),
        requestAuthentication: async () => {
            challengeCalls += 1;
            return true;
        },
    });

    await assert.rejects(
        coordinator.run('修改密码', async () => {
            actionCalls += 1;
            throw { code: 428 };
        }),
        error => error?.code === 428,
    );

    assert.equal(actionCalls, 2);
    assert.equal(challengeCalls, 1);
});

test('cancelling a confirmation never calls the confirmed action', async () => {
    let actionCalls = 0;
    const result = await runConfirmedAction(
        async () => { throw 'cancel'; },
        async () => { actionCalls += 1; },
    );

    assert.equal(result.status, 'cancelled');
    assert.equal(actionCalls, 0);
});
