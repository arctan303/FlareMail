<template>
  <el-config-provider :locale="elLocale">
    <router-view :key="$route.matched[0]?.path || $route.path" />
  </el-config-provider>
</template>
<script setup>
import {onBeforeUnmount,onMounted,watch} from 'vue';
import {useRoute} from 'vue-router';
import {useSettingStore} from '@/store/setting.js';
import {useUiStore} from '@/store/ui.js';
import {applyBrandToDocument} from '@/utils/brand.js';
import i18n from '@/i18n/index.js';
import {elLocale} from '@/utils/locale.js';
import {switchDark} from '@/utils/theme.js';
const route=useRoute(),settings=useSettingStore(),ui=useUiStore();
watch(()=>settings.lang,()=>{if(route.name!=='docs')applyBrandToDocument(settings.settings,i18n.global.t(route.meta.title||'inbox'));});
const media=window.matchMedia('(prefers-color-scheme: dark)');
function systemTheme(event){if(ui.themeMode==='system')switchDark(event.matches,document.documentElement,'system');}
onMounted(()=>media.addEventListener('change',systemTheme));
onBeforeUnmount(()=>media.removeEventListener('change',systemTheme));
</script>
<style>
html,body,#app{margin:0;width:100%;height:100%;}
body{font-family:var(--font-sans);font-size:14px;}
.brand-preview-page{width:100%;}
</style>
