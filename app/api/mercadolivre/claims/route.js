import {admin,validConnection,meli} from '../../../../lib/server.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const API='https://api.mercadolibre.com';
const digits=v=>typeof v==='string'&&/^[0-9]{1,20}$/.test(v);
const safeError=e=>Response.json({error:e?.message||'Falha ao consultar reclamações'},{status:502,headers:{'Cache-Control':'no-store'}});
function available(claim,sellerId,action){
 const seller=(claim.players||[]).find(p=>p.role==='respondent'&&String(p.user_id)===String(sellerId));
 return !!seller && (seller.available_actions||[]).some(x=>typeof x==='string'?x===action:x?.action===action);
}
async function claimGet(path,token){
 const r=await fetch(API+path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!r.ok)throw Error('Mercado Livre indisponível para '+path.split('?')[0]+' (HTTP '+r.status+')');
 return r.json();
}
function classify(messages,reason){
 const content=[...(Array.isArray(messages)?messages:[]).map(m=>m.message||''),reason?.description||'',reason?.name||''].join(' ').toLowerCase();
 const broken=/quebrad|quebrou|estilhaç|trincad|avariad|danificad|partid|rachad|caco|amassad|rompid/.test(content);
 const transport=/transporte|entrega|frete|transportadora|caixa amassad|embalagem amassad|pacote amassad/.test(content);
 const packaging=/sem proteção|mal embalad|embalagem inadequad|sem plástico bolha|sem enchimento/.test(content);
 return {possible_breakage:broken,transport_indicators:transport,packaging_risk:packaging,classification:packaging?'avaliar_embalagem':broken&&transport?'possivel_avaria_logistica':broken?'quebra_origem_indeterminada':'outra_reclamacao',note:'Classificação preliminar; não determina responsabilidade da transportadora'};
}
export async function GET(req){
 try{
  if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
  const p=new URL(req.url).searchParams,sellerId=p.get('seller_id'),claimId=p.get('claim_id');
  if(!digits(sellerId))return Response.json({error:'seller_id inválido'},{status:400});
  const c=await validConnection(sellerId);
  if(claimId){
   if(!digits(claimId))return Response.json({error:'claim_id inválido'},{status:400});
   const base='/post-purchase/v1/claims/'+encodeURIComponent(claimId);
   const claim=await claimGet(base,c.accessToken);
   if(!(claim.players||[]).some(x=>String(x.user_id)===String(sellerId)&&x.role==='respondent'))return Response.json({error:'Reclamação não pertence a esta conta'},{status:403});
   const optional=await Promise.allSettled([claimGet(base+'/messages',c.accessToken),claimGet(base+'/actions-history',c.accessToken),claim.reason_id?claimGet('/post-purchase/v1/claims/reasons/'+encodeURIComponent(String(claim.reason_id)),c.accessToken):Promise.resolve(null)]);
   const [messages,history,reason]=optional.map(x=>x.status==='fulfilled'?x.value:null);
   return Response.json({seller_id:sellerId,claim, messages,actions_history:history, reason,analysis:classify(messages,reason),allowed_message_recipients:['complainant','mediator'].filter(role=>available(claim,sellerId,'send_message_to_'+role)),source:'mercadolivre_live',checked_at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
  }
  const status=p.get('status')||'opened',limit=Number(p.get('limit')||30),offset=Number(p.get('offset')||0);
  if(!['opened','closed'].includes(status)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset+limit>=10000)return Response.json({error:'Filtros ou paginação inválidos'},{status:400});
  const qs=new URLSearchParams({'players.user_id':sellerId,'players.role':'respondent',status,limit:String(limit),offset:String(offset),sort:'last_updated:desc'});
  const found=await claimGet('/post-purchase/v1/claims/search?'+qs.toString(),c.accessToken);
  if(!Array.isArray(found.data))throw Error('Resposta inesperada do Mercado Livre');
  return Response.json({seller_id:sellerId,status,paging:found.paging||{},claims:found.data.map(x=>({id:x.id,resource:x.resource,resource_id:x.resource_id,reason_id:x.reason_id,type:x.type,stage:x.stage,status:x.status,date_created:x.date_created,last_updated:x.last_updated,fulfilled:x.fulfilled,available_actions:(x.players||[]).find(t=>t.role==='respondent'&&String(t.user_id)===sellerId)?.available_actions||[]})),source:'mercadolivre_live',checked_at:new Date().toISOString(),notice:'A listagem não prova culpa logística nem exclusão da reputação. Consulte detalhes e evidências.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return safeError(e)}
}
export async function POST(req){
 try{
  if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
  const b=await req.json().catch(()=>null);
  if(!b||!digits(String(b.seller_id||''))||!digits(String(b.claim_id||''))||!['complainant','mediator'].includes(b.receiver_role)||typeof b.message!=='string'||b.message.trim().length<3||b.message.length>1000||b.confirm_send!==true)return Response.json({error:'Envio requer conta, reclamação, destinatário, mensagem e confirmação explícita'},{status:400});
  const c=await validConnection(String(b.seller_id));
  const base='/post-purchase/v1/claims/'+encodeURIComponent(String(b.claim_id));
  const claim=await claimGet(base,c.accessToken);
  const action='send_message_to_'+b.receiver_role;
  if(claim.status!=='opened'||!available(claim,b.seller_id,action))return Response.json({error:'Envio não está permitido na reclamação neste momento'},{status:409});
  const response=await fetch(API+base+'/actions/send-message',{method:'POST',headers:{Authorization:'Bearer '+c.accessToken,'Content-Type':'application/json'},body:JSON.stringify({receiver_role:b.receiver_role,message:b.message.trim(),attachments:[]}),cache:'no-store'});
  if(!response.ok)return Response.json({error:'Mercado Livre recusou a mensagem',http_status:response.status},{status:502});
  return Response.json({sent:true,claim_id:String(b.claim_id),receiver_role:b.receiver_role,ml_http_status:response.status,checked_at:new Date().toISOString()});
 }catch(e){return safeError(e)}
}
