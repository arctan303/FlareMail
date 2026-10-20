<template>
  <div class="setting-card arc-card">
    <div class="card-header"><div><h3 class="card-title">{{t('capabilities.operations')}}</h3><p class="card-desc">{{t('capabilities.operationsDesc')}}</p></div></div>
    <div class="card-body operations-body" :aria-busy="busy">
      <label>{{t('capabilities.domain')}}<el-select v-model="domain" :disabled="busy"><el-option v-for="item in domains" :key="item" :label="item" :value="item" /></el-select></label>
      <label>{{t('capabilities.selector')}}<el-input v-model="selector" :disabled="busy" maxlength="63" /></label>
      <el-button :disabled="busy || !domain" :loading="busy" @click="run(async()=>{ inspection=await inspectMail(domain,selector) })">{{t('capabilities.inspect')}}</el-button>
      <div v-if="inspection" class="inspection">
        <p>{{inspection.domain}} · {{t(inspection.enabled?'capabilities.enabled':'capabilities.disabled')}}</p>
        <div v-for="(check,key) in inspection.checks" :key="key"><strong>{{key.toUpperCase()}}: {{t('capabilities.'+check.status)}}</strong><pre v-if="check.records.length">{{check.records.join('\n')}}</pre></div>
        <p>{{t('capabilities.provider')}}: {{inspection.provider}} · {{t('capabilities.credentials')}}: {{t(inspection.credentialsConfigured?'capabilities.configured':'capabilities.notConfigured')}} · {{t('capabilities.binding')}}: {{t(inspection.cloudflareBound?'capabilities.configured':'capabilities.notConfigured')}}</p>
      </div>
      <p class="hint">{{t('capabilities.routingHint')}}</p>
      <label>{{t('capabilities.sender')}}<el-select v-model="accountId" :disabled="busy"><el-option v-for="item in accounts" :key="item.accountId" :label="item.email" :value="item.accountId" /></el-select></label>
      <label>{{t('capabilities.testTo')}}<el-input v-model="to" type="email" :disabled="busy" /></label>
      <p class="hint">{{t('capabilities.sendHint')}}</p>
      <div class="buttons"><el-button :disabled="busy || !accountId || !to" @click="sendTest">{{t('capabilities.sendTest')}}</el-button><el-button :disabled="busy || !accountId" @click="run(async()=>{ probe=await startReceiveTest(accountId); receiveResult=null })">{{t('capabilities.receiveTest')}}</el-button></div>
      <div v-if="probe"><p>{{t('capabilities.receiveHint',{email:probe.email})}}</p><pre>{{probe.subject}}</pre><el-button :disabled="busy" @click="run(async()=>{ receiveResult=await checkReceiveTest(probe.id) })">{{t('capabilities.checkReceive')}}</el-button><p v-if="receiveResult" role="status">{{t(receiveResult.received?'capabilities.received':'capabilities.notReceived')}}</p></div>
      <h4>{{t('capabilities.deliveryTitle')}}</h4><p class="hint">{{t('capabilities.deliveryHint')}}</p>
      <template v-if="config">
        <label>{{t('capabilities.webhookUrl')}}<el-input :model-value="config.webhookUrl" readonly /></label>
        <p>{{t(config.secretConfigured?'capabilities.configured':'capabilities.notConfigured')}}</p>
        <label>{{t('capabilities.signingSecret')}}<el-input v-model="secret" type="password" show-password :disabled="busy" :placeholder="t('capabilities.keepSecret')" /></label>
        <div class="buttons"><el-button :disabled="busy || !secret" @click="saveSecret(false)">{{t('capabilities.save')}}</el-button><el-button :disabled="busy || !config.secretConfigured" type="danger" plain @click="saveSecret(true)">{{t('capabilities.clearSecret')}}</el-button></div>
      </template>
      <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p>
      <el-button link :disabled="busy" @click="load">{{t('capabilities.refresh')}}</el-button>
    </div>
  </div>
</template>
<script setup>
import {ref,onMounted,watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {accountList} from '@/request/index.js'
import {deliveryConfig,saveDeliveryConfig,inspectMail,testMailSend,startReceiveTest,checkReceiveTest} from '@/request/mail-operations.js'
const props=defineProps({domains:{type:Array,default:()=>[]},runSensitive:{type:Function,required:true}})
const emit=defineEmits(['busy','dirty-change'])
const {t}=useI18n()
const domain=ref(''),selector=ref('resend'),accounts=ref([]),accountId=ref(null),to=ref(''),inspection=ref(null),probe=ref(null),receiveResult=ref(null),config=ref(null),secret=ref(''),busy=ref(false),error=ref(''),message=ref('')
watch(()=>props.domains,list=>{if(!list.includes(domain.value))domain.value=list[0]||''},{immediate:true})
watch(secret,value=>emit('dirty-change',!!value))
watch(accountId,()=>{probe.value=null;receiveResult.value=null})
watch([domain,selector],()=>{inspection.value=null})
async function run(action){if(busy.value)return;busy.value=true;emit('busy',true);error.value='';message.value='';try{await action()}catch(failure){error.value=failure?.message||t('requestFailedMsg')}finally{busy.value=false;emit('busy',false)}}
async function load(){await run(async()=>{const result=await Promise.allSettled([deliveryConfig(),accountList(0,100)]);if(result[0].status==='fulfilled')config.value=result[0].value;else error.value=result[0].reason?.message||t('requestFailedMsg');if(result[1].status==='fulfilled'){accounts.value=result[1].value;if(!accounts.value.some(a=>a.accountId===accountId.value))accountId.value=accounts.value[0]?.accountId||null}else error.value=result[1].reason?.message||t('requestFailedMsg')})}
async function sendTest(){await run(async()=>{const id=crypto.randomUUID();const result=await props.runSensitive(t('capabilities.sendTest'),()=>testMailSend({accountId:accountId.value,to:to.value,requestId:id}));if(result?.status==='completed')message.value=t('capabilities.accepted')})}
async function saveSecret(clear){await run(async()=>{const result=await props.runSensitive(t('capabilities.save'),()=>saveDeliveryConfig({revision:config.value.revision,secretAction:clear?'clear':'replace',...(!clear?{secret:secret.value}:{})}));if(result?.status==='completed'){config.value=result.value;secret.value='';message.value=t('capabilities.saved')}})}
onMounted(load)
</script>
<style scoped lang="scss">
@use './card' as *;
.operations-body {display:flex;flex-direction:column;gap:14px}label{display:flex;flex-direction:column;gap:7px;font-size:13px}.hint{color:var(--muted);font-size:13px;line-height:1.65;margin:0}.buttons{display:flex;flex-wrap:wrap;gap:10px}.buttons :deep(.el-button){margin:0}.inspection{display:grid;gap:10px}.error{color:var(--el-color-danger)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:150px;overflow:auto;font-size:12px}h4{margin:12px 0 0}
</style>
