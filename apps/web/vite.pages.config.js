import { defineConfig } from 'vite';
import path from 'node:path';
import baseConfig from './vite.config.js';

// Only Pages substitutes the request, routing and storage layers.
export default defineConfig(async context => {
    const config = await baseConfig(context);
    const local = file => path.resolve(import.meta.dirname, 'src/playground', file);
    return {
        ...config,
        base: '/',
        plugins: [
            ...config.plugins.filter(plugin => !Array.isArray(plugin) && !plugin.name?.includes('pwa')),
            {
                name: 'pages-entry',
                enforce: 'pre',
                transform(source,id) {
                    if(id.split('?')[0].endsWith('/layout/aside/index.vue')) return source
                        .replace('<template v-if="hasPerm', "<router-link class=\"nav-item\" :to=\"'/docs/'+pagesSettings.lang+'/introduction'\" @click=\"closeAsideIfMobile\"><div class=\"nav-icon-box\"><Icon icon=\"solar:document-text-linear\" width=\"16\" height=\"16\" /></div><span class=\"nav-label\">{{ pagesSettings.lang === 'en' ? 'Docs' : '文档' }}</span></router-link>\n          <template v-if=\"hasPerm")
                        .replace('const uiStore = useUiStore();', "const uiStore = useUiStore();\nconst pagesSettings = useSettingStore();")
                        .replace('import { hasPerm }', "import { useSettingStore } from '@/store/setting.js';\nimport { hasPerm }");
                    if(id.split('?')[0].endsWith('/views/setting/components/LanguageCard.vue')) return source.replace('<div class="setting-card arc-card">','<div class="setting-card arc-card" data-pages-language>');
                    if(id.split('?')[0].endsWith('/views/setting/components/ThemeCard.vue')) return source.replace('<div class="setting-card arc-card">','<div class="setting-card arc-card" data-pages-appearance>');
                    if(id.split('?')[0].endsWith('/views/UnmatchedView.vue')) return source.replace('@click="handleDelete(row)"',':disabled="true"');
                    if(id.split('?')[0].endsWith('/views/brand-preview/index.vue')) return source.replace(/\n\s*editable\n/g,'\n          :editable="false"\n').replace(':disabled="saving || !baseline || isDefault"',':disabled="true"').replace(':disabled="!baseline || !dirty"',':disabled="true"');
                },
                transformIndexHtml: { order: 'pre', handler(html) {
                    return html.replace('/src/main.js', '/src/playground/main.js')
                        .replace(/\s*<link rel="manifest"[^>]*>/, '')
                        .replace('noindex, nofollow, noarchive, nosnippet', 'index, follow');
                } },
                generateBundle() {
                    this.emitFile({ type: 'asset', fileName: '_headers', source: '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' });
                },
            },
        ],
        server: { host: '127.0.0.1', port: 3002, strictPort: true },
        preview: { host: '127.0.0.1', port: 4174, strictPort: true },
        resolve: { alias: [
            { find: /^@\/axios\/index\.js$/, replacement: local('http.js') },
            { find: /^@\/db\/db\.js$/, replacement: local('db.js') },
            { find: /^@\/router(?:\/index\.js)?$/, replacement: local('router.js') },
            { find: /^@\/utils\/convert\.js$/, replacement: local('convert.js') },
            { find: /^@\/utils\/html-sanitizer\.js$/, replacement: local('html-sanitizer.js') },
            { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
        ] },
        build: { ...config.build, outDir: 'dist-pages' },
    };
});
