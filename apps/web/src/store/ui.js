import { defineStore } from 'pinia'
import { getStoredThemeMode } from '@/utils/theme.js'

export const useUiStore = defineStore('ui', {
    state: () => ({
        asideShow: window.innerWidth > 1024,
        accountShow: false,
        contactSplitWidth: 350,
        backgroundLoading: true,
        changeNotice: 0,
        writerRef: null,
        changePreview: 0,
        previewData: {},
        key: 0,
        dark: typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
        themeMode: typeof localStorage !== 'undefined' ? getStoredThemeMode() : 'system',
        asideCount: {
            email: 0,
            send: 0,
            sysEmail: 0
        }
    }),
    actions: {
        showNotice() {
            this.changeNotice ++
        },
        previewNotice(data) {
            this.previewData = data
            this.changePreview ++
        },
        setContactSplitWidth(width) {
            this.contactSplitWidth = Math.max(0, Math.min(width, 1000));
        }
    },
    persist: {
        pick: ['accountShow', 'contactSplitWidth'],
    },
})
