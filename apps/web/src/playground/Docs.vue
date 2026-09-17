<template>
  <div class="docs-layout">
    <div class="docs-mobile-heading">
      <button type="button" :aria-expanded="menuOpen" aria-controls="docs-directory" @click="menuOpen=!menuOpen">{{ en ? '☰  Contents' : '☰  文档目录' }}</button>
      <span>{{ current?.[lang] || (en?'Documentation':'文档') }}</span>
    </div>
    <aside id="docs-directory" class="docs-sidebar" :class="{open:menuOpen}">
      <router-link to="/inbox" class="docs-back">← {{ en ? 'Mailbox' : '返回邮箱' }}</router-link>
      <div class="docs-sidebar-title">{{ en ? 'Documentation' : '文档' }}</div>
      <nav :aria-label="en?'Documentation directory':'文档目录'">
        <section v-for="group in DOC_GROUPS" :key="group.en">
          <h2>{{ group[lang] }}</h2>
          <router-link v-for="item in group.items" :key="item.slug" :to="docLocation(item.slug)" :aria-current="slug===item.slug?'page':undefined" :class="{active:slug===item.slug}" @click="menuOpen=false">{{ item[lang] }}</router-link>
        </section>
      </nav>
      <div class="docs-preferences"><button type="button" @click="changeLanguage">{{ en ? '简体中文' : 'English' }}</button><button type="button" @click="toggleTheme">{{ en ? 'Light / dark' : '浅色 / 深色' }}</button></div>
    </aside>
    <div ref="reading" class="docs-reading" @click="handleArticleClick">
      <article v-if="current && source" class="docs-article">
        <p class="docs-breadcrumb">{{ en?'Docs':'文档' }} <span>/</span> {{ current.group[lang] }}</p>
        <form v-if="slug==='cli'" class="docs-instance" @submit.prevent="applyInstance">
          <label for="cli-instance">{{ en?'Your mailbox URL':'你的邮箱站点地址' }}</label>
          <div class="docs-instance-row"><input id="cli-instance" v-model="instanceInput" type="url" spellcheck="false" autocomplete="off" :placeholder="CLI_EXAMPLE_ORIGIN" :aria-invalid="instanceInvalid" aria-describedby="cli-instance-hint"><button type="submit">{{ en?'Apply':'应用' }}</button></div>
          <p id="cli-instance-hint" :class="{invalid:instanceInvalid}">{{ instanceInvalid ? (en?'Enter an HTTP(S) origin without a path or credentials.':'请输入 HTTP(S) 站点地址，不包含路径或账号密码。') : (instanceOrigin ? (en?'Examples below use your mailbox address.':'以下接口与命令已使用你的邮箱地址。') : (en?'Using an example address. Replace it with your deployed mailbox.':'当前使用示例地址，请填入已部署的邮箱站点。')) }}</p>
          <code>{{ apiBaseUrl }}</code>
        </form>
        <div class="docs-body" v-html="rendered.html"></div>
        <nav class="docs-pagination" :aria-label="en?'Previous and next article':'前后文档'">
          <router-link v-if="previous" :to="docLocation(previous.slug)"><span>← {{ en?'Previous':'上一篇' }}</span><strong>{{ previous[lang] }}</strong></router-link>
          <router-link v-if="next" :to="docLocation(next.slug)" class="next"><span>{{ en?'Next':'下一篇' }} →</span><strong>{{ next[lang] }}</strong></router-link>
        </nav>
        <footer class="docs-footer"><a :href="'https://github.com/arctan303/FlareMail/blob/main/apps/web/docs/'+lang+'/'+slug+'.md'" target="_blank" rel="noopener noreferrer">{{ en?'View source ↗':'查看文档源文件 ↗' }}</a><span>FlareMail</span></footer>
      </article>
      <article v-else class="docs-article"><h1>{{ en?'Document not found':'找不到这篇文档' }}</h1><router-link :to="docLocation('introduction')">{{ en?'Back to introduction':'返回项目介绍' }}</router-link></article>
    </div>
  </div>
</template>
<script setup>
import {computed,nextTick,ref,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {ElMessage} from 'element-plus';
import {useSettingStore} from '@/store/setting.js';
import {useUiStore} from '@/store/ui.js';
import {setThemeMode} from '@/utils/theme.js';
import {applyBrandToDocument} from '@/utils/brand.js';
import {DOC_GROUPS,DOC_ITEMS,getDoc} from './docs.js';
import {renderMarkdown} from './markdown.js';
import {normalizeInstanceOrigin,personalizeCliDocs,CLI_EXAMPLE_ORIGIN} from '@/utils/cli-docs.js';
const route=useRoute(),router=useRouter(),settings=useSettingStore(),ui=useUiStore();
function changeLanguage(){router.push({name:'docs',params:{lang:lang.value==='en'?'zh':'en',slug:slug.value},query:instanceQuery.value,hash:route.hash});}
function toggleTheme(){setThemeMode(ui.dark?'light':'dark');}
const lang=computed(()=>route.params.lang==='en'?'en':'zh'),en=computed(()=>lang.value==='en');
const slug=computed(()=>route.params.slug||'introduction');
const current=computed(()=>DOC_ITEMS.find(item=>item.slug===slug.value));
const index=computed(()=>DOC_ITEMS.findIndex(item=>item.slug===slug.value));
const previous=computed(()=>DOC_ITEMS[index.value-1]),next=computed(()=>index.value>=0?DOC_ITEMS[index.value+1]:null);
const instanceOrigin=computed(()=>normalizeInstanceOrigin(route.query.instance));
const instanceQuery=computed(()=>instanceOrigin.value?{instance:instanceOrigin.value}:{});
const instanceInput=ref(''),instanceInvalid=ref(false);
const apiBaseUrl=computed(()=>(instanceOrigin.value||CLI_EXAMPLE_ORIGIN)+'/api');
watch(()=>route.query.instance,value=>{instanceInput.value=typeof value==='string'?value:'';instanceInvalid.value=value!==undefined&&!normalizeInstanceOrigin(value);},{immediate:true});
function docLocation(article){return {name:'docs',params:{lang:lang.value,slug:article},query:instanceQuery.value};}
function applyInstance(){
  const raw=instanceInput.value.trim(),origin=normalizeInstanceOrigin(raw);
  if(raw&&!origin){instanceInvalid.value=true;return;}
  instanceInvalid.value=false;
  router.replace({name:'docs',params:{lang:lang.value,slug:slug.value},query:origin?{instance:origin}:{},hash:route.hash});
}
const source=computed(()=>{
  const text=getDoc(lang.value,slug.value);
  return slug.value==='cli'?personalizeCliDocs(text,instanceOrigin.value,lang.value):text;
});
const rendered=computed(()=>renderMarkdown(source.value,lang.value));
const menuOpen=ref(false),reading=ref(null);
watch(()=>route.fullPath,async()=>{
  settings.setLang(lang.value);menuOpen.value=false;
  applyBrandToDocument(settings.settings,(current.value?.[lang.value]||'404')+' · '+(en.value?'Docs':'文档'));
  await nextTick();
  if(route.hash)document.getElementById(route.hash.slice(1))?.scrollIntoView({block:'start'});
  else reading.value?.scrollTo({top:0});
},{immediate:true});
async function handleArticleClick(event){
  const button=event.target.closest('[data-copy-code]');
  if(button){
    const text=button.closest('.docs-code')?.querySelector('code')?.textContent||'';
    try{await navigator.clipboard.writeText(text);ElMessage.success(en.value?'Copied':'已复制');}
    catch{ElMessage.warning(en.value?'Select and copy the code manually.':'请选中代码手动复制。');}
    return;
  }
  const anchor=event.target.closest('a[href^="#"]');
  if(anchor){event.preventDefault();router.push({query:instanceQuery.value,hash:anchor.getAttribute('href')});}
}
</script>
<style>
.docs-layout{height:100%;display:grid;grid-template-columns:260px minmax(0,1fr);background:var(--surface);}
.docs-sidebar{overflow:auto;padding:30px 18px 36px;border-right:1px solid var(--line);background:var(--paper);box-sizing:border-box;}
.docs-sidebar .docs-back{margin-bottom:16px;font-size:12px;}
.docs-preferences{display:flex;gap:8px;padding:24px 12px 0;}
.docs-preferences button{background:transparent;border:0;color:var(--muted);font:inherit;font-size:12px;cursor:pointer;padding:4px;}
.docs-sidebar-title{font-size:15px;font-weight:650;padding:0 12px 14px;color:var(--text-strong);}
.docs-sidebar section{margin:18px 0 0;}
.docs-sidebar h2{font-size:12px;font-weight:600;letter-spacing:.02em;margin:0 12px 8px;color:var(--muted);}
.docs-sidebar a{display:block;margin:2px 0;padding:8px 12px;border-radius:6px;font-size:13px;line-height:1.5;color:var(--text);text-decoration:none;}
.docs-sidebar a:hover{background:var(--base-fill);}
.docs-sidebar a.active{color:var(--accent);font-weight:600;background:color-mix(in srgb,var(--accent) 9%,transparent);}
.docs-sidebar a:focus-visible,.docs-reading a:focus-visible,.docs-mobile-heading button:focus-visible,.docs-code button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.docs-reading{overflow:auto;min-width:0;scroll-behavior:auto;}
.docs-article{max-width:800px;padding:40px 48px 32px;margin:0 auto;box-sizing:content-box;}
.docs-instance{margin:0 0 28px;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--paper);font-size:13px;}
.docs-instance label{display:block;margin-bottom:8px;font-weight:600;color:var(--text-strong);}
.docs-instance-row{display:flex;gap:8px;}
.docs-instance input{flex:1;min-width:0;padding:8px 10px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--text);font:inherit;}
.docs-instance button{padding:8px 12px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--accent);font:inherit;cursor:pointer;}
.docs-instance p{margin:8px 0;color:var(--muted);line-height:1.6;font-size:12px;}
.docs-instance p.invalid{color:var(--el-color-danger);}
.docs-instance code{font-size:12px;color:var(--accent);overflow-wrap:anywhere;}
.docs-breadcrumb{margin:0 0 26px;font-size:12px;color:var(--muted);}
.docs-breadcrumb span{padding:0 8px;color:var(--line);}
.docs-body{font-size:15px;line-height:1.85;color:var(--text);overflow-wrap:anywhere;}
.docs-body h1{font-size:30px;line-height:1.3;font-weight:650;color:var(--text-strong);margin:0 0 24px;letter-spacing:-.025em;}
.docs-body h2{font-size:21px;line-height:1.45;font-weight:600;color:var(--text-strong);margin:40px 0 16px;padding-top:8px;border-top:1px solid var(--line);}
.docs-body h3{font-size:17px;line-height:1.5;font-weight:600;margin:28px 0 12px;color:var(--text-strong);}
.docs-body p{margin:14px 0;}
.docs-body a,.docs-footer a{color:var(--accent);text-underline-offset:3px;}
.docs-body li{margin:6px 0;}
.docs-body ul,.docs-body ol{padding-left:24px;}
.docs-body blockquote{margin:22px 0;padding:4px 16px;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,var(--paper));border-radius:0 6px 6px 0;color:var(--text);}
.docs-body :not(pre)>code{font-family:var(--font-mono,monospace);font-size:.86em;border-radius:4px;padding:2px 5px;background:var(--paper-soft);border:1px solid var(--line);}
.docs-code{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:20px 0;background:var(--paper);}
.docs-code-heading{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted);}
.docs-code button{border:0;background:transparent;font:inherit;color:var(--text);padding:4px 8px;cursor:pointer;border-radius:4px;}
.docs-code button:hover{background:var(--base-fill);}
.docs-code pre{margin:0;padding:16px;overflow:auto;font-size:12px;line-height:1.8;font-family:var(--font-mono,monospace);tab-size:2;}
.docs-body table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;margin:20px 0;font-size:13px;line-height:1.7;}
.docs-body th,.docs-body td{border:1px solid var(--line);padding:10px 12px;text-align:left;min-width:90px;}
.docs-body th{background:var(--paper-soft);font-weight:600;}
.docs-body hr{border:0;border-top:1px solid var(--line);margin:30px 0;}
.docs-body [id]{scroll-margin-top:24px;}
.docs-pagination{display:flex;gap:16px;margin-top:48px;padding-top:24px;border-top:1px solid var(--line);}
.docs-pagination a{flex:1;display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);border-radius:8px;padding:14px 16px;text-decoration:none;min-width:0;}
.docs-pagination a:hover{border-color:var(--accent);}
.docs-pagination span{font-size:12px;color:var(--muted);}
.docs-pagination strong{font-size:14px;font-weight:500;color:var(--accent);}
.docs-pagination .next{text-align:right;margin-left:auto;}
.docs-footer{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:12px;padding:26px 0 0;}
.docs-footer a{text-decoration:none;}
.docs-mobile-heading{display:none;}
@media(max-width:767px){
  .docs-layout{display:flex;flex-direction:column;position:relative;}
  .docs-mobile-heading{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);}
  .docs-mobile-heading button{background:transparent;border:0;color:var(--text);font:inherit;padding:4px;cursor:pointer;}
  .docs-sidebar{display:none;position:absolute;top:44px;bottom:0;left:0;width:260px;z-index:10;box-shadow:12px 0 30px #0002;}
  .docs-sidebar.open{display:block;}
  .docs-reading{flex:1;min-height:0;}
  .docs-article{padding:26px 20px;}
  .docs-body{font-size:14px;}
  .docs-body h1{font-size:26px;}
  .docs-body h2{font-size:19px;}
  .docs-code pre{font-size:11px;}
  .docs-pagination{gap:10px;}
}
</style>
