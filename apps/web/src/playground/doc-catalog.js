export const DOC_GROUPS = [
    {zh:'开始使用',en:'Start here',items:[
        {slug:'introduction',zh:'认识 FlareMail',en:'Meet FlareMail'},
        {slug:'experience',zh:'在线体验',en:'Online experience'},
        {slug:'costs',zh:'费用与准备',en:'Costs & preparation'},
        {slug:'deployment',zh:'部署邮箱',en:'Deploy your mailbox'},
    ]},
    {zh:'使用场景',en:'Use cases',items:[
        {slug:'personal-mailbox',zh:'个人域名邮箱',en:'Your personal domain mailbox'},
        {slug:'assistant-mailbox',zh:'给助手一个邮箱',en:'A mailbox for your assistant'},
    ]},
    {zh:'配置',en:'Configuration',items:[
        {slug:'receiving',zh:'收信配置',en:'Receiving setup'},
        {slug:'sending',zh:'发信配置',en:'Sending setup'},
        {slug:'configuration',zh:'配置与存储',en:'Configuration & storage'},
        {slug:'administration',zh:'管理员配置',en:'Administrator setup'},
    ]},
    {zh:'使用与集成',en:'Usage & integrations',items:[
        {slug:'usage',zh:'日常使用',en:'Everyday use'},
        {slug:'cli',zh:'CLI / Agent',en:'CLI / Agent'},
        {slug:'oauth',zh:'OAuth 接入',en:'OAuth integration'},
    ]},
    {zh:'维护与帮助',en:'Maintenance & help',items:[
        {slug:'updates',zh:'更新与恢复',en:'Updates & recovery'},
        {slug:'faq',zh:'常见问题',en:'FAQ'},
        {slug:'licenses',zh:'开源与许可',en:'Open source & licenses'},
    ]},
    {zh:'开发',en:'Development',items:[
        {slug:'getting-started',zh:'本地开发',en:'Local development'},
        {slug:'pages',zh:'部署体验站',en:'Deploy the experience'},
    ]},
];
export const DOC_ITEMS = DOC_GROUPS.flatMap(group=>group.items.map(item=>({...item,group})));
