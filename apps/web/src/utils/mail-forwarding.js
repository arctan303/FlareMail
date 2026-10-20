export function hasInternalForwardFailure(email) {
  if (Number(email?.type) !== 0) return false
  try { return JSON.parse(email.message || '{}').code === 'INTERNAL_FORWARD_FAILED' }
  catch { return false }
}
