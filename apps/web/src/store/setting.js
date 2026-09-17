import { defineStore } from 'pinia'
import { applyBrandToDocument, cacheBrand } from '@/utils/brand.js'
import { applyLocale, cacheLocale } from '@/utils/locale.js'

export const useSettingStore = defineStore('setting', {
    state: () => ({
        domainList: [],
        settings: {},
        setupStatus: null,
        // Active interface locale; utils/locale.js owns the localStorage hint so the
        // signed-out pages can resolve it before the store exists.
        lang: '',
    }),
    actions: {
        applyPublicBrand(brand) {
            this.settings = {...this.settings, ...brand};
            this.domainList = brand?.domainList || this.domainList;
            // Every brand update funnels through here, so the next cold start already
            // has the new title and logo.
            cacheBrand(this.settings);
            if (typeof document !== 'undefined') {
                const marker = ' | ';
                const currentTitle = String(document.title || '');
                const markerIndex = currentTitle.indexOf(marker);
                const pageTitle = markerIndex >= 0 ? currentTitle.slice(markerIndex + marker.length) : '';
                applyBrandToDocument(this.settings, pageTitle);
            }
        },
        // Single entry point so the store, the cache and every locale-aware library
        // (vue-i18n, Element Plus, dayjs) move together.
        setLang(locale) {
            const next = applyLocale(locale);
            this.lang = next;
            cacheLocale(next);
            return next;
        },
    },
})
