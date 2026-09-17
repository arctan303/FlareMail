import {useUserStore} from "@/store/user.js";

export default {
    mounted(el, binding) {
        const userStore = useUserStore();
        const permKeys = Array.isArray(userStore.user.permKeys) ? userStore.user.permKeys : [];
        const value = binding.value;

        if (permKeys.includes('*')) {
            return;
        }

        const hasPermission = Array.isArray(value)
            ? value.some(key => permKeys.includes(key))
            : permKeys.includes(value);

        if (!hasPermission) {
            el.parentNode && el.parentNode.removeChild(el);
        }
    }
}

export function hasPerm(permKey) {
    const permKeys = useUserStore().user.permKeys;
    if (!Array.isArray(permKeys)) {
        return false;
    }
    return permKeys.includes('*') || permKeys.includes(permKey);
}


export function permsToRouter(permKeys) {
    if (!Array.isArray(permKeys)) {
        return [];
    }
    const routerList = []
    Object.keys(routers).forEach(perm => {
        if (permKeys.includes(perm) || permKeys.includes('*')) {
            routerList.push(...routers[perm])
        }
    })
    return routerList;
}

const routers = {
    'email:send': [
        {
            path: '/sent',
            name: 'send',
            component: () => import('@/views/send/index.vue'),
            meta: {
                title: 'sent',
                name: 'send',
                menu: true
            }
        },
        {
            path: '/drafts',
            name: 'draft',
            component: () => import('@/views/draft/index.vue'),
            meta: {
                title: 'drafts',
                name: 'draft',
                menu: true
            }
        }
    ],
    'user:query': [{
        path: '/all-users',
        name: 'user',
        component: () => import('@/views/user/index.vue'),
        meta: {
            title: 'allUsers',
            name: 'user',
            menu: true
        }
    }],
    'setting:query': [{
        path: '/system-setting',
        name: 'sys-setting',
        component: () => import('@/views/sys-setting/index.vue'),
        meta: {
            title: 'SystemSettings',
            name: 'sys-setting',
            menu: true
        }
    }],

}
