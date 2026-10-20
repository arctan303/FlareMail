import http from '@/axios/index.js'
export const contactTimeline = (email,beforeId) => http.get('/contact/timeline',{params:{email,size:50,...(beforeId?{beforeId}:{})},noMsg:true})
