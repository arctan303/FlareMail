<template><div class="experience-not-found"><h1>404</h1><p>{{en?'This page could not be found.':'找不到这个页面。'}}</p><router-link to="/inbox">{{en?'Back to experience':'返回体验'}}</router-link> · <router-link to="/docs">{{en?'Read the docs':'阅读文档'}}</router-link></div></template>
<script setup>
import {computed} from 'vue';
import {useSettingStore} from '@/store/setting.js';
const en=computed(()=>useSettingStore().lang==='en');
</script>
<style scoped>.experience-not-found{max-width:680px;margin:100px auto;padding:24px;text-align:center;}a{color:var(--accent);}</style>
