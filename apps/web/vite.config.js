import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'node:fs'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'
import {VitePWA} from 'vite-plugin-pwa';

const DEV_WORKER_TARGET = 'http://localhost:8787'

function configureDevWorkerProxy(proxy) {
    proxy.on('proxyReq', (proxyReq, req) => {
        const host = String(req.headers.host || '')
        const browserOrigin = String(req.headers.origin || '')
        if (!host || !browserOrigin) return

        let expectedOrigin
        try {
            const expectedUrl = new URL('http://' + host)
            if (!['localhost', '127.0.0.1'].includes(expectedUrl.hostname)
                || expectedUrl.pathname !== '/' || expectedUrl.search || expectedUrl.hash
                || expectedUrl.username || expectedUrl.password) return
            expectedOrigin = expectedUrl.origin
        } catch {
            return
        }

        // Only same-origin browser requests may be translated to the Worker origin.
        // Foreign and opaque origins keep their original header and remain rejected by Worker same-origin protection.
        if (browserOrigin !== expectedOrigin) return
        proxyReq.setHeader('Origin', new URL(DEV_WORKER_TARGET).origin)
    })
}

function devWorkerProxy() {
    return {
        target: DEV_WORKER_TARGET,
        changeOrigin: true,
        configure: configureDevWorkerProxy,
    }
}

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), 'VITE')
    return {
        server: {
            host: '127.0.0.1',
            port: 3001,
            hmr: true,
            proxy: {
                '/api': devWorkerProxy(),
                '/login/oauth': devWorkerProxy(),
                '/oauth': devWorkerProxy(),
                '/.well-known/oauth-authorization-server': devWorkerProxy(),
                '/manifest.webmanifest': devWorkerProxy(),
            },
        },
        base: env.VITE_STATIC_URL || '/',
        plugins: [vue(),
            {
                name: 'distribution-notices',
                generateBundle() {
                    const notices = [
                        ['license.txt', path.resolve(import.meta.dirname, '../..', 'LICENSE')],
                        ['third-party-notices.txt', path.resolve(import.meta.dirname, '../..', 'THIRD-PARTY-NOTICES.md')],
                        ['fluent-icons-license.txt', path.resolve(import.meta.dirname, 'src/playground/fluent-icons-license.txt')],
                    ];
                    for (const [fileName, file] of notices) {
                        this.emitFile({type: 'asset', fileName, source: fs.readFileSync(file, 'utf8')});
                    }
                },
            },
            VitePWA({
                injectRegister: 'script-defer',
                manifest: false,
                workbox: {
                    disableDevLogs: true,
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
                    runtimeCaching: [],
                    navigateFallback: null,
                    cleanupOutdatedCaches: true,
                }
            }),
            AutoImport({
                resolvers: [ElementPlusResolver()],
            }),
            Components({
                resolvers: [ElementPlusResolver()],
            })
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src')
            }
        },
        build: {
            target: 'es2022',
            outDir: env.VITE_OUT_DIR || 'dist',
            emptyOutDir: true,
            assetsInclude: ['**/*.json']
        }
    }
})
