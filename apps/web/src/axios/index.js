import axios from 'axios';
import i18n from '@/i18n/index.js';
import { useSettingStore } from '@/store/setting.js';
import { setAuthenticatedSession } from '@/utils/session-state.js';
import { invalidateUserScopedStateAcrossTabs } from '@/utils/sensitive-state.js';

const http = axios.create({
    baseURL: import.meta.env.VITE_BASE_URL,
    withCredentials: true,
});

http.interceptors.request.use(config => {
    const { lang } = useSettingStore();
    config.headers['accept-language'] = lang;
    return config;
});

function rejectApiFailure(data, config = {}) {
    if (data.code === 401) {
        setAuthenticatedSession(false);
        invalidateUserScopedStateAcrossTabs();
        if (window.location.pathname !== '/login') {
            window.location.replace('/login');
        }
    }

    if (config.noMsg) {
        return Promise.reject(data);
    }

    ElMessage({
        message: data.message || i18n.global.t('requestFailedMsg'),
        type: data.code === 403 ? 'warning' : 'error',
        plain: true,
    });

    return Promise.reject(data);
}

http.interceptors.response.use(
    response => {
        const data = response.data;
        return data.code === 200 ? data.data : rejectApiFailure(data, response.config);
    },
    error => {
        if (error.response?.data?.code) {
            return rejectApiFailure(error.response.data, error.config);
        }

        if (error.config?.noMsg) {
            return Promise.reject(error);
        }

        if (error.message.includes('Network Error')) {
            ElMessage({
                message: i18n.global.t('networkErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true,
                repeatNum: -4,
            });
        } else if (error.code === 'ECONNABORTED') {
            ElMessage({
                message: i18n.global.t('timeoutErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true,
            });
        } else if (error.response) {
            ElMessage({
                message: i18n.global.t('serverBusyErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true,
                repeatNum: -4,
            });
        } else {
            ElMessage({
                message: i18n.global.t('reqFailErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true,
                repeatNum: -4,
            });
        }
        return Promise.reject(error);
    },
);

export default http;
