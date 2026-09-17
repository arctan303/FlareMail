const SETUP_GATE_READY = 'ready';
const SETUP_GATE_SETUP = 'setup';
const SETUP_GATE_UPGRADE = 'upgrade';

export function isBlockingUpgrade(status) {
    return status?.upgradeRequired === true && !(status.upgradeBlocking === false && status.upgradeSupported === true);
}

function classifySetupStatus(status) {
    if (!status || typeof status !== 'object') throw new TypeError('Setup status response is missing.');
    if (typeof status.setupRequired !== 'boolean' || typeof status.upgradeRequired !== 'boolean') {
        throw new TypeError('Setup status response does not contain valid gate fields.');
    }
    if (status.setupRequired) return SETUP_GATE_SETUP;
    if (isBlockingUpgrade(status)) return SETUP_GATE_UPGRADE;
    return SETUP_GATE_READY;
}

export async function runAfterSetupGate({ getStatus, readyAction, onAutomaticError = () => {} } = {}) {
    if (typeof getStatus !== 'function' || typeof readyAction !== 'function' || typeof onAutomaticError !== 'function') {
        throw new TypeError('Setup gate requires status, ready action and error handler functions.');
    }
    const status = await getStatus();
    const state = classifySetupStatus(status);
    const resolution = {
        state,
        status,
        ready: state === SETUP_GATE_READY,
        automaticAttempted: false,
        automaticError: null,
    };
    if (!resolution.ready) return resolution;
    return { ...resolution, value: await readyAction(status) };
}

export { SETUP_GATE_READY, SETUP_GATE_SETUP, SETUP_GATE_UPGRADE };
