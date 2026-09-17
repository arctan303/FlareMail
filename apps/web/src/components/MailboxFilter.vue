<template>
  <select v-if="hasPerm('account:query')" v-model.number="accountStore.mailboxFilterId" class="mailbox-filter" :aria-label="$t('mailboxFilter')" :title="$t('mailboxFilter')" @focus="load">
    <option :value="0">{{ $t('allMailboxes') }}</option>
    <option v-for="account in accounts" :key="account.accountId" :value="account.accountId">{{ account.email }}</option>
  </select>
</template>
<script setup>
import {computed,onMounted,ref} from 'vue';
import {useAccountStore} from '@/store/account.js';
import {useUserStore} from '@/store/user.js';
import {accountList} from '@/request/account.js';
import {hasPerm} from '@/perm/perm.js';
const accountStore=useAccountStore(),userStore=useUserStore(),loading=ref(false);
const accounts=computed(()=>[...new Map([userStore.user.account,...accountStore.accountList].filter(Boolean).map(a=>[a.accountId,a])).values()]);
async function load(){
  if(loading.value||!hasPerm('account:query'))return;
  loading.value=true;
  try{
    const list=[];let cursor=0,lastSort;
    while(true){
      const page=await accountList(cursor,100,lastSort);list.push(...page);
      if(page.length<100)break;
      const last=page.at(-1);if(last.accountId===cursor&&last.sort===lastSort)break;
      cursor=last.accountId;lastSort=last.sort;
    }
    accountStore.accountList=list;
    if(accountStore.mailboxFilterId&&!list.some(a=>a.accountId===accountStore.mailboxFilterId))accountStore.mailboxFilterId=0;
  }catch{/* The request layer reports errors; focusing retries loading. */}
  finally{loading.value=false;}
}
onMounted(load);
</script>
<style scoped>
.mailbox-filter{width:180px;max-width:100%;height:32px;padding:0 26px 0 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);font:inherit;font-size:12px;text-overflow:ellipsis;cursor:pointer;}
.mailbox-filter:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
@media(max-width:767px){.mailbox-filter{width:142px;}}
</style>
