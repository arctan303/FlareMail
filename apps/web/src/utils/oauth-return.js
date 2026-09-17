export function safeAuthorizationReturn(value, origin = window.location.origin) {
    if (typeof value !== 'string' || !value.startsWith('/oauth/authorize?')) return ''
    try {
        const target = new URL(value, origin)
        return target.origin === origin && target.pathname === '/oauth/authorize'
            ? `${target.pathname}${target.search}`
            : ''
    } catch {
        return ''
    }
}

export function authenticatedLoginTarget(redirect, origin = window.location.origin) {
    return safeAuthorizationReturn(redirect, origin) || '/'
}

export function shouldProbeAuthenticatedSession({
    hasSessionHint,
    oauthJustLoggedIn,
    redirect,
    origin = window.location.origin,
}) {
    return hasSessionHint === true
        || oauthJustLoggedIn === true
        || safeAuthorizationReturn(redirect, origin) !== ''
}
