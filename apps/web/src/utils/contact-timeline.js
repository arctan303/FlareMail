export function createContactTimelinePager(fetchPage,onChange) {
  let epoch=0;
  let removed=new Set();
  let state={email:'',items:[],beforeId:null,hasMore:false,loading:false,error:null};
  const emit=()=>onChange({...state,items:[...state.items]});
  async function more(){
    if(state.loading||!state.email||(!state.hasMore&&state.items.length))return;
    const current=epoch,email=state.email,beforeId=state.beforeId;
    state.loading=true;state.error=null;emit();
    try{
      const page=await fetchPage(email,beforeId);
      if(current!==epoch)return;
      const existing=new Set(state.items.map(row=>row.emailId));
      state.items.push(...page.list.filter(row=>!existing.has(row.emailId)&&!removed.has(row.emailId)));
      state.beforeId=page.nextBeforeId;state.hasMore=!!page.hasMore;
    }catch(error){if(current===epoch)state.error=error;}
    finally{if(current===epoch){state.loading=false;emit();}}
  }
  return {more,remove(emailId){removed.add(emailId);state.items=state.items.filter(row=>row.emailId!==emailId);emit();},reset(email){epoch++;removed=new Set();state={email:email||'',items:[],beforeId:null,hasMore:false,loading:false,error:null};emit();return email?more():Promise.resolve();},dispose(){epoch++;}};
}
