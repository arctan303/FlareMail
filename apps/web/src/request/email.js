export { emailList, emailDelete, emailLatest, emailConversation, emailConversationRead, emailConversationState, emailRead, emailUnread, emailSend } from './index.js';
import http from '@/axios/index.js';
export const mailIdentities = () => http.get('/mail/identities', { noMsg: true });
