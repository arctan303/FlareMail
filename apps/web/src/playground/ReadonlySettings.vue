<template>
  <div ref="root" class="pages-readonly" @click.capture="guard" @keydown.capture="guard">
    <p class="pages-readonly-note">{{ lang === 'en' ? 'Settings are shown for reference. Language can be changed.' : '设置仅供查看，语言可以切换。' }}</p>
    <component :is="view" />
  </div>
</template>
<script setup>
import {computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref} from 'vue';
import {useSettingStore} from '@/store/setting.js';
const props=defineProps({kind:String});
const root=ref(), settings=useSettingStore(), lang=computed(()=>settings.lang);
const views={setting:()=>import('@/views/setting/index.vue'),system:()=>import('@/views/sys-setting/index.vue'),users:()=>import('@/views/user/index.vue')};
const components=Object.fromEntries(Object.entries(views).map(([key,loader])=>[key,defineAsyncComponent(loader)]));
const view=computed(()=>components[props.kind]);
const allowed='[data-pages-language], a[href], summary, .preview-launch-btn, .sub-action-btn';
function guard(event){
  if(event.target.closest(allowed))return;
  if(event.type==='keydown'&&!['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
  if(event.target.closest('button, input, textarea, select, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], .el-switch, .el-select, .el-checkbox, .el-radio, [contenteditable]')){
    event.preventDefault();event.stopImmediatePropagation();
  }
}
function lock(){
  root.value?.querySelectorAll('input, textarea, select, button').forEach(control=>{
    if(!control.closest(allowed)&&!control.disabled)control.disabled=true;
  });
}
let observer;
onMounted(()=>{lock();observer=new MutationObserver(lock);observer.observe(root.value,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});});
onBeforeUnmount(()=>observer?.disconnect());
</script>
<style scoped>
.pages-readonly{height:100%;min-height:0;display:flex;flex-direction:column;}
.pages-readonly-note{margin:0;padding:8px 24px;font-size:12px;color:var(--muted);background:var(--bg);border-bottom:1px solid var(--border);}
.pages-readonly > :deep(.el-scrollbar){flex:1;min-height:0;height:auto;}
</style>
