<template><details class="delivery-events" @toggle="opened"><summary>{{t('capabilities.deliveryEvents')}}</summary><p v-if="error" role="alert">{{error}}</p><p v-else-if="data && !data.events.length">{{t(data.provider==='unavailable'?'capabilities.deliveryUnavailable':'capabilities.noDeliveryEvents')}}</p><ul v-if="data?.events?.length"><li v-for="event in data.events" :key="event.eventId"><strong>{{t('capabilities.eventTypes.'+event.type)}}</strong> · {{event.occurredAt}}<p>{{event.recipients.join(', ')}}</p><p v-if="event.detail">{{event.detail}}</p></li></ul><p v-if="data?.hasMore">{{t('capabilities.latestDeliveryEvents')}}</p><el-button link :loading="loading" @click="load">{{t('capabilities.refresh')}}</el-button></details></template>
<script setup>
import {ref,watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {deliveryEvents} from '@/request/mail-operations.js'
const props=defineProps({emailId:{type:Number,required:true}})
const {t}=useI18n(),data=ref(null),error=ref(''),loading=ref(false)
let epoch=0
watch(()=>props.emailId,()=>{epoch++;data.value=null;error.value='';loading.value=false})
async function load(){if(loading.value)return;const current=++epoch,id=props.emailId;loading.value=true;error.value='';try{const result=await deliveryEvents(id);if(current===epoch)data.value=result}catch(failure){if(current===epoch)error.value=failure?.message||t('requestFailedMsg')}finally{if(current===epoch)loading.value=false}}
function opened(event){if(event.target.open&&!data.value)load()}
</script>
<style scoped>.delivery-events{padding:12px 0;font-size:12px;overflow-wrap:anywhere;color:var(--muted)}summary{cursor:pointer}li{margin:12px 0}p{margin:5px 0}</style>
