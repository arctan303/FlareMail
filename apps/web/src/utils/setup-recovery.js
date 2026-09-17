export function resolveSetupFailure(errorCode, status) {
    if (status && status.setupRequired === false) return 'installed';
    if ([401, 403, 409, 410].includes(Number(errorCode))) return 'credentials';
    return 'retry';
}
