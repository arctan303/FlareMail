import {createRouter, createWebHistory} from 'vue-router'
import NProgress from 'nprogress';
import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {cvtR2Url} from "@/utils/convert.js";
import {hasAuthenticatedSession} from "@/utils/session-state.js";
import {authenticatedLoginTarget} from "@/utils/oauth-return.js";
import {applyBrandToDocument} from '@/utils/brand.js';
import i18n from '@/i18n/index.js';

const routes = [
    {
        path: '/',
        name: 'layout',
        redirect: '/inbox',
        component: () => import('@/layout/index.vue'),
        children: [
            {
                path: '/inbox',
                name: 'email',
                component: () => import('@/views/email/index.vue'),
                meta: {
                    title: 'inbox',
                    name: 'email',
                    menu: true
                }
            },
            {
                path: '/message',
                name: 'content',
                component: () => import('@/views/content/index.vue'),
                meta: {
                    title: 'message',
                    name: 'content',
                    menu: false
                }
            },
            {
                path: '/settings',
                name: 'setting',
                component: () => import('@/views/setting/index.vue'),
                meta: {
                    title: 'settings',
                    name: 'setting',
                    menu: true
                }
            },
            {
                path: '/starred',
                name: 'star',
                component: () => import('@/views/star/index.vue'),
                meta: {
                    title: 'starred',
                    name: 'star',
                    menu: true
                }
            },
            {
                path: '/contacts',
                name: 'contact',
                component: () => import('@/views/contacts/index.vue'),
                meta: {
                    title: 'contacts',
                    name: 'contact',
                    menu: true
                }
            },
            {
                path: '/unmatched',
                name: 'unmatched',
                component: () => import('@/views/UnmatchedView.vue'),
                meta: {
                    title: 'unmatched',
                    name: 'unmatched',
                    menu: true
                }
            },
        ]

    },
    {
        path: '/login',
        name: 'login',
        component: () => import('@/views/login/index.vue')
    },
    {
        path: '/brand-preview',
        name: 'brand-preview',
        component: () => import('@/views/brand-preview/index.vue'),
        meta: {
            title: 'brandPreview',
            name: 'brand-preview',
            menu: false
        }
    },
    {
        path: '/:pathMatch(.*)*',
        name: '404',
        component: () => import('@/views/404/index.vue')
    }
]


const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes
})

NProgress.configure({
    showSpinner: false,   // 不显示旋转图标
    trickleSpeed: 50,    // 自动递增速度
    minimum: 0.1          // 最小百分比
});

let timer
let first = true

router.beforeEach((to, from, next) => {

    if (timer) {
        clearTimeout(timer)
    }

    if (!first) {
        timer = setTimeout(() => {
            NProgress.start()
        }, 100)
    }

    const authenticated = hasAuthenticatedSession()

    if (!authenticated && to.name !== 'login') {
        const redirect = to.fullPath && to.fullPath !== '/' && to.fullPath !== '/inbox' ? to.fullPath : undefined
        return next({ path: '/login', query: redirect ? { redirect } : {} })
    }

    if (!authenticated && to.name === 'login') {
        loadBackground(next)
        return
    }

    if (authenticated && to.name === 'login') {
        const target = authenticatedLoginTarget(to.query?.redirect, window.location.origin)
        if (target !== '/') {
            window.location.replace(target)
            return
        }
        return next({ path: '/' })
    }

    next()

})

function loadBackground(next) {

    const settingStore = useSettingStore();

    if (settingStore.settings.background) {

        const src = cvtR2Url(settingStore.settings.background);

        const img = new Image();
        img.src = src;

        img.onload = () => {
            next()
        };

        img.onerror = () => {
            console.warn("背景图片加载失败:", img.src);
            next()
        };

        setTimeout(() => {
            console.warn("背景加载超时，已放行");
            next()
        }, 3000)

    } else {
        next()
    }

}

router.afterEach((to) => {

    clearTimeout(timer)
    if (first) {
        removeLoading()
    } else {
        NProgress.done();
    }

    const uiStore = useUiStore()
    const settingStore = useSettingStore()
    if (to.meta.menu) {
        if (['content', 'email', 'send'].includes(to.meta.name)) {
            uiStore.accountShow = false;
        } else {
            uiStore.accountShow = false
        }
    }

    // Route meta titles are i18n keys; this used to hold a second copy of the
    // Chinese page-title dictionary that also lived in zh.js.
    const titleKey = to.meta?.title || to.meta?.name || to.name
    const pageTitle = i18n.global.t(titleKey || 'inbox')
    applyBrandToDocument(settingStore.settings, pageTitle)

    first = false
})

function removeLoading() {
    const doc = document.getElementById('loading-first');
    if (!doc) {
        return;
    }

    doc.remove()
}

export default router
