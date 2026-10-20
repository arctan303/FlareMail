import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import userContext from '../security/user-context';
import verify from '../utils/verify-utils';
import emailService from '../service/email-service';

export async function contactTimeline(c,params,userId) {
  const address=String(params.email||'').trim().toLowerCase();
  const before=params.beforeId===undefined?Number.MAX_SAFE_INTEGER:Number(params.beforeId);
  const size=params.size===undefined?50:Number(params.size);
  if(!verify.isEmail(address)||address.length>254||!Number.isSafeInteger(before)||before<1||!Number.isInteger(size)||size<1||size>50)throw new BizError('Invalid contact history query.',400);
  const [local,domain]=address.split('@');const base=local.split('+')[0]+'@'+domain;
  const escape=value=>value.replace(/[\\%_]/g,'\\$&');const tagged=escape(local.split('+')[0])+'+%@'+escape(domain);
  const matches=field=>`(lower(${field})=? OR lower(${field}) LIKE ? ESCAPE '\\')`;
  const jsonMatches=field=>`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(e.${field}) THEN e.${field} ELSE '[]' END) j WHERE ${matches("CASE WHEN j.type='object' THEN json_extract(j.value,'$.address') ELSE j.value END")})`;
  const fields=['e.send_email','e.to_email'];
  const predicates=[...fields.map(matches),...['recipient','cc'].map(jsonMatches),`(e.type=1 AND ${jsonMatches('bcc')})`];
  const bindings=predicates.flatMap(()=>[base,tagged]);
  const rows=(await c.env.db.prepare(`SELECT e.* FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id WHERE e.user_id=? AND e.is_del=0 AND e.status<>6 AND a.is_del=0 AND e.email_id<? AND (${predicates.join(' OR ')}) ORDER BY e.email_id DESC LIMIT ?`).bind(userId,before,...bindings,size+1).all()).results||[];
  const hasMore=rows.length>size;
  const list=rows.slice(0,size).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),value])));
  await emailService.emailAddAtt(c,list);
  return {list:list.map(row=>({...row,direction:row.type===0?'in':'out'})),hasMore,nextBeforeId:list.at(-1)?.emailId||null};
}
app.get('/contact/timeline',async c=>c.json(result.ok(await contactTimeline(c,c.req.query(),userContext.getUserId(c)))));
