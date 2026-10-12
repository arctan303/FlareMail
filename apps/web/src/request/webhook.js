import http from '@/axios/index.js'

const path = id => `/my/webhooks/${id}`
const quiet = { noMsg: true }
export const getWebhook = id => http.get(path(id), quiet)
export const saveWebhook = (id, data) => http.put(path(id), data, quiet)
export const deleteWebhook = (id, revision) => http.delete(path(id), { ...quiet, params: { revision } })
export const rotateWebhookSecret = (id, revision) => http.post(`${path(id)}/secret`, { revision }, quiet)
export const testWebhook = id => http.post(`${path(id)}/test`, {}, { ...quiet, timeout: 15000 })
export const webhookDeliveries = (id, before) => http.get(`${path(id)}/deliveries`, { ...quiet, params: { before } })
export const retryWebhook = (id, eventId) => http.post(`${path(id)}/deliveries/${encodeURIComponent(eventId)}/retry`, {}, quiet)
