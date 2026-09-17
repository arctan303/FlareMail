import {createRouter,createWebHistory} from 'vue-router';
import {useUiStore} from '@/store/ui.js';
import {useEmailStore} from '@/store/email.js';
import {useSettingStore} from '@/store/setting.js';
import {applyBrandToDocument} from '@/utils/brand.js';
import i18n from '@/i18n/index.js';
import ReadonlySettings from './ReadonlySettings.vue';

const mail=(path,name,title,component)=>({path,name,component,meta:{title,name,menu:true}});
const router=createRouter({
    history:createWebHistory('/'),
    routes:[
        {path:'/',name:'layout',redirect:'/inbox',component:()=>import('@/layout/index.vue'),children:[
            mail('/inbox','email','inbox',()=>import('@/views/email/index.vue')),
            mail('/message','content','message',()=>import('@/views/content/index.vue')),
            mail('/sent','send','sent',()=>import('@/views/send/index.vue')),
            mail('/drafts','draft','drafts',()=>import('@/views/draft/index.vue')),
            mail('/starred','star','star',()=>import('@/views/star/index.vue')),
            mail('/contacts','contact','contacts',()=>import('@/views/contacts/index.vue')),
            {...mail('/settings','setting','settings',ReadonlySettings),props:{kind:'setting'}},
            {...mail('/all-users','user','allUsers',ReadonlySettings),props:{kind:'users'}},
            {...mail('/system-setting','sys-setting','SystemSettings',ReadonlySettings),props:{kind:'system'}},
            mail('/unmatched','unmatched','unmatchedTitle',()=>import('@/views/UnmatchedView.vue')),
        ]},
        {path:'/login',name:'login',meta:{title:'loginBtn'},component:()=>import('@/views/login/index.vue')},
        {path:'/brand-preview',name:'brand-preview',component:()=>import('@/views/brand-preview/index.vue'),meta:{title:'brandPreview'}},
        {path:'/docs',redirect:()=>'/docs/'+useSettingStore().lang+'/introduction'},
        {path:'/docs/:lang(zh|en)/:slug?',name:'docs',component:()=>import('./Docs.vue')},
        {path:'/:pathMatch(.*)*',name:'404',component:()=>import('./NotFound.vue')},
    ],
    scrollBehavior(to,from,saved){return saved||(to.hash?{el:to.hash,top:24}:{top:0});},
});
router.beforeEach(to=>{if(to.name==='content'&&!useEmailStore().contentData.email?.emailId)return '/inbox';});
router.afterEach(to=>{
    const ui=useUiStore(),settings=useSettingStore();
    ui.accountShow=false;
    applyBrandToDocument(settings.settings,to.name==='docs'?(settings.lang==='en'?'Documentation':'文档'):i18n.global.t(to.meta.title||'inbox'));
});
export default router;
