<template>
  <el-config-provider :locale="elLocale">
    <router-view :key="$route.matched[0]?.path || $route.path" />
  </el-config-provider>
</template>
<script setup>
import {useSettingStore} from "@/store/setting.js";
import { elLocale } from '@/utils/locale.js';
const settingStore = useSettingStore();
import('@/icons/index.js');
</script>
