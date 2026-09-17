export const RECENT_AUTH_REQUIRED_CODE = 428;

export function isRecentAuthRequired(error) {
    return Number(error?.code) === RECENT_AUTH_REQUIRED_CODE;
}

export async function runConfirmedAction(confirmAction, action) {
    try {
        await confirmAction();
    } catch {
        return { status: 'cancelled' };
    }

    return {
        status: 'completed',
        value: await action(),
    };
}

export function createRecentAuthCoordinator({ getStatus, requestAuthentication }) {
    if (typeof getStatus !== 'function' || typeof requestAuthentication !== 'function') {
        throw new TypeError('Recent authentication coordinator requires status and authentication functions.');
    }

    let operationActive = false;
    let challengePromise = null;

    async function challenge(purpose, status) {
        if (!challengePromise) {
            challengePromise = Promise.resolve()
                .then(() => requestAuthentication(purpose, status))
                .then(result => result === true)
                .finally(() => {
                    challengePromise = null;
                });
        }
        return challengePromise;
    }

    async function ensure(purpose, force = false) {
        const status = await getStatus();
        if (status?.enabled === false || (!force && status?.valid === true)) return true;
        return challenge(purpose, status);
    }

    async function run(purpose, action) {
        if (operationActive) return { status: 'busy' };
        if (typeof action !== 'function') throw new TypeError('Sensitive action must be a function.');

        operationActive = true;
        try {
            if (!await ensure(purpose)) return { status: 'cancelled' };

            let retried = false;
            while (true) {
                try {
                    return {
                        status: 'completed',
                        value: await action(),
                    };
                } catch (error) {
                    if (retried || !isRecentAuthRequired(error)) throw error;
                    retried = true;
                    if (!await ensure(purpose, true)) return { status: 'cancelled' };
                }
            }
        } finally {
            operationActive = false;
        }
    }

    return { run };
}
