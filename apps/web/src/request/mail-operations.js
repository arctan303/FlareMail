import http from '@/axios/index.js'
export const deliveryConfig = () => http.get('/admin/mail-delivery', { noMsg:true })
export const saveDeliveryConfig = data => http.put('/admin/mail-delivery',data,{noMsg:true})
export const deliveryEvents = emailId => http.get('/email/delivery',{params:{emailId},noMsg:true})
export const inspectMail = (domain,selector) => http.get('/admin/mail-diagnostics',{params:{domain,selector},noMsg:true})
export const testMailSend = data => http.post('/admin/mail-diagnostics/send',data,{noMsg:true})
export const startReceiveTest = accountId => http.post('/admin/mail-diagnostics/receive',{accountId},{noMsg:true})
export const checkReceiveTest = id => http.get('/admin/mail-diagnostics/receive/'+id,{noMsg:true})
