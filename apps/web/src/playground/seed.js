export function createSeed(locale = 'zh') {
    const en = locale === 'en';
    const ago = hours => new Date(Date.now() - hours * 3600000).toISOString().replace('T', ' ').slice(0, 19);
    const accounts = [
        { accountId: 1, email: 'alex@example.com', name: 'Alex', allReceive: 0, isDefaultSend: 1 },
        { accountId: 2, email: 'work@example.com', name: en ? 'Work' : '工作邮箱', allReceive: 0, isDefaultSend: 0 },
        { accountId: 3, email: 'hello@example.org', name: en ? 'Personal' : '个人邮箱', allReceive: 0, isDefaultSend: 0 },
    ].map((a, index) => ({ ...a, userId: 1, sort: 100-index, status: 0, isDel: 0, forwardStatus: 0, createTime: ago(240), latestEmailTime: ago(index) }));
    const topics = en ? [
        ['FlareMail', 'Welcome to your mailbox', 'Read a message, reply to a friend, or compose something new. Everything here is sample data. Refresh to start again.'],
        ['Maya Chen', 'A few ideas for our next project', 'I put together a small moodboard. Could you share your thoughts? We can go over the details on Friday.'],
        ['Design Weekly', 'Less noise, more room for ideas', 'A little inspiration for your week: readable typography, thoughtful spacing, and interfaces that feel familiar.'],
        ['Jordan Lee', 'Coffee on Friday?', 'There is a new cafe near the studio. Shall we meet at 10? Looking forward to catching up.'],
        ['Studio North', 'Your project brief is ready', 'The brief is attached. It includes the schedule, deliverables, and a few notes for our next conversation.'],
        ['Paper & Post', 'Your order is on its way', 'Your notebook and postcards are packed and ready. Thank you for supporting our small studio.'],
        ['Example Account', 'Your verification code: 482916', 'Your sample verification code is 482916. This email is part of the online experience.'],
        ['Open Source Notes', 'A small update worth sharing', 'This week we shipped better keyboard navigation and a clearer settings page. Thanks for trying it out.'],
    ] : [
        ['FlareMail', '欢迎来到你的邮箱', '打开一封邮件、回复朋友，或写一封新邮件。这里全部是示例数据，刷新页面即可重新开始体验。'],
        ['Maya Chen', '关于下一个项目的一些想法', '我整理了一份小小的灵感板，想听听你的建议。周五可以一起聊聊细节吗？'],
        ['Design Weekly', '减少噪音，为灵感留一点空间', '本周的设计小记：清晰的排版、恰当的留白，以及让人感到熟悉的交互。'],
        ['Jordan Lee', '周五一起喝杯咖啡？', '工作室附近开了一家新咖啡馆。上午十点见怎么样？期待聊聊最近的生活。'],
        ['Studio North', '项目简报已经整理好了', '附件是这次的项目简报，包含时间安排、交付内容，以及下次讨论前需要留意的事项。'],
        ['Paper & Post', '你的包裹正在路上', '笔记本和明信片已经打包完成。谢谢你支持我们的小工作室，祝今天也有好心情。'],
        ['Example Account', '你的示例验证码：482916', '本次验证码为 482916。这是一封用于在线体验的模拟邮件。'],
        ['Open Source Notes', '一些值得分享的小更新', '这周我们优化了键盘导航和设置页面。欢迎体验，也欢迎分享你的想法。'],
    ];
    const emails = Array.from({length:86}, (_,index) => {
        const [name,subject,text] = topics[index%topics.length];
        const accountId = index<66 ? 1 : index<76 ? 2 : 3;
        return {
            emailId: 1000-index, userId:1, accountId, type:0, name,
            sendEmail: ['team@flaremail.example','maya@example.net','weekly@example.net','jordan@example.net','studio@example.net','hello@example.net','account@example.net','notes@example.net'][index%8],
            subject: index<8 ? subject : subject+' · '+(index+1), text,
            content: '<div style="font-family:system-ui;line-height:1.8;max-width:660px"><p>'+(en?'Hi Alex,':'你好，Alex：')+'</p><p>'+text+'</p><p>'+(en?'Have a lovely day,':'祝你今天愉快，')+'<br>'+name+'</p></div>',
            recipient: JSON.stringify([{address:accounts.find(a=>a.accountId===accountId).email,name:'Alex'}]),
            cc:'[]',bcc:'[]',unread:index%3===0?0:1,isStar:index%7===1?1:0,
            status:2,isDel:0,createTime:ago(index*3),messageId:'<sample-'+index+'@example.net>',code:index%8===6?'482916':'',
            attachments:index%8===4?[{filename:'project-brief.txt',key:'sample/project-brief.txt',size:144,contentType:'text/plain'}]:[],
        };
    });
    emails.push({...emails[1],emailId:1100,accountId:1,type:1,name:'Alex',sendEmail:accounts[0].email,subject:en?'Re: A few ideas for our next project':'回复：关于下一个项目的一些想法',recipient:'[{"address":"maya@example.net"}]',text:en?'Thanks Maya, Friday works for me!':'谢谢 Maya，周五见！',content:en?'<p>Thanks Maya, Friday works for me!</p>':'<p>谢谢 Maya，周五见！</p>',createTime:ago(2),unread:1,isStar:0});
    // A real four-message example spanning received/sent mail, not merely
    // matching subjects. Keep the original list counts and independent rows.
    const root=emails[17],middle=emails[9],latest=emails[1],sent=emails.at(-1);
    root.subject=latest.subject;
    middle.subject=`Re: ${root.subject}`;
    middle.inReplyTo=root.messageId;middle.relation=root.messageId;
    latest.inReplyTo=middle.messageId;latest.relation=`${root.messageId} ${middle.messageId}`;
    sent.messageId='<sample-project-reply@example.com>';sent.inReplyTo=latest.messageId;
    sent.relation=`${latest.relation} ${latest.messageId}`;
    const quote=(sender,html)=>`<div class="gmail_quote flaremail_quote"><p>${sender}:</p><blockquote type="cite" style="margin-left:24px;padding-left:12px;border-left:2px solid #cbd5e1">${html}</blockquote></div>`;
    middle.content+=quote(root.name,root.content);
    latest.content+=quote(middle.name,middle.content);
    sent.content+=quote(latest.name,latest.content);
    emails.forEach(email=>{email.toEmail=JSON.parse(email.recipient)[0]?.address||'';email.attList=email.attachments.map((att,index)=>({...att,attId:email.emailId+'-'+index}));});
    const contacts = [
        {contactId:1,name:'Maya Chen',email:'maya@example.net',groupName:en?'Work':'工作',remark:en?'Product designer':'产品设计师',phone:''},
        {contactId:2,name:'Jordan Lee',email:'jordan@example.net',groupName:en?'Friends':'朋友',remark:en?'Coffee on Fridays':'周五的咖啡搭子',phone:''},
        {contactId:3,name:'Studio North',email:'studio@example.net',groupName:en?'Work':'工作',remark:'',phone:''},
        {contactId:4,name:'Paper & Post',email:'hello@example.net',groupName:'',remark:'',phone:''},
    ];
    const users = [
        {userId:1,email:accounts[0].email,name:'Alex',type:0,status:0,isDel:0},
        {userId:2,email:'sam@example.com',name:'Sam',type:1,status:0,isDel:0},
        {userId:3,email:'riley@example.org',name:'Riley',type:1,status:1,isDel:0},
    ].map(u=>({...u,accountCount:u.userId===1?3:1,accountNum:u.userId===1?3:1,delAccountCount:0,delSendEmailCount:0,delReceiveEmailCount:0,sendCount:2,sendNum:2,sendEmailCount:2,sendLimit:50,accountLimit:10,receiveCount:66,receiveNum:66,receiveEmailCount:66,emailCount:66,createTime:ago(240),activeTime:ago(1),browser:'Chrome',os:'Windows',createIp:'192.0.2.10',activeIp:'192.0.2.10',forwardStatus:1,mainForwardStatus:0,forwardEmail:'',googleEmail:'',hasCliToken:false,locale:''}));
    for(const u of users.slice(1)) accounts.push({...accounts[0],accountId:u.userId+10,userId:u.userId,email:u.email,name:u.name,isDefaultSend:1});
    return {
        accounts,emails,contacts,users,unmatched:[{...emails[4],emailId:8001,toEmail:'missing@example.com'},{...emails[5],emailId:8002,toEmail:'archived@example.org'}],domains:['example.com','example.org'],domainsRevision:0,
        settings:{title:'FlareMail',siteDescription:'A private mailbox for your domain.',siteLogo:'',siteFavicon:'',sitePwaIcons:{},loginCopy:{},domainList:['@example.com','@example.org'],receive:0,send:0,loginDomain:0,autoRefresh:0,r2Domain:'',background:'',blackFrom:'',blackSubject:'',blackContent:'',googleOauthEnabled:0,googleClientId:'',googleClientSecret:'',resendTokens:{},mailProvider:'resend',hasR2:true,hasCfEmail:true,storageType:'R2',mailProviderUpgradeRequired:false},
        confirmation:{enabled:false,windowMinutes:1440,revision:0},
        runtime:{revision:0,allowedOrigins:[],turnstile:{siteKey:'',secretConfigured:false},oauth:{issuer:'https://mail.example.com',secretConfigured:true}},
        provider:{enabled:false,revision:0,issuerReady:true,secretReady:true,clients:[{clientId:'personal-site',displayName:en?'Personal website':'个人网站',enabled:true,redirects:[{redirectUri:'https://site.example.com/auth/callback',silentFrameAncestor:''}]}]},
        policy:'quarantine',nextId:2000,reauthUntil:0,oauthSecret:'sample-only-not-a-real-secret',
    };
}
