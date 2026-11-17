import {admin,validConnection,meli,checked,db} from '../../../../lib/server.js';

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
   const orderId=String(claim.resource_id||'');
   const safeOrder=digits(orderId)?meli('/orders/'+encodeURIComponent(orderId),c.accessToken).then(order=>({
     id:String(order.id),status:order.status||null,
     items:(Array.isArray(order.order_items)?order.order_items:[]).slice(0,15).map(x=>({title:String(x.item?.title||'').slice(0,180),quantity:x.quantity||null})),
     shipping:order.shipping?.id?{shipment_id:String(order.shipping.id)}:null
   })).catch(()=>null):Promise.resolve(null);
   const optional=await Promise.allSettled([
     claimGet(base+'/messages',c.accessToken),
     claimGet(base+'/actions-history',c.accessToken),
     claim.reason_id?claimGet('/post-purchase/v1/claims/reasons/'+encodeURIComponent(String(claim.reason_id)),c.accessToken):Promise.resolve(null),
     claimGet(base+'/detail',c.accessToken),
     safeOrder
   ]);
   const [messages,history,reason,claimDetail,order]=optional.map(x=>x.status==='fulfilled'?x.value:null);
   const messageList=Array.isArray(messages)?messages:Array.isArray(messages?.messages)?messages.messages:Array.isArray(messages?.data)?messages.data:[];
   return Response.json({seller_id:sellerId,claim,claim_detail:claimDetail,order,messages,actions_history:history,reason,
     analysis:classify(messageList,reason),allowed_message_recipients:['complainant','mediator'].filter(role=>available(claim,sellerId,'send_message_to_'+role)),
     source:'mercadolivre_live',checked_at:new Date().toISOString(),
     notice:'Dados do pedido e envio limitados. Comprovantes e fotos precisam ser apresentados separadamente.'},
     {headers:{'Cache-Control':'no-store'}});
  }
  // Busca direta por ID do pedido, independente da paginação ou status das listas.
  const searchedOrder=p.get('order_id');
  if(searchedOrder!==null){
   if(!digits(searchedOrder))return Response.json({error:'Informe um número de pedido válido (somente dígitos)'},{status:400});
   // Checa a associação sem reduzir as reclamações a um único tipo de recurso.
   let order=null,orderLookupError=null;
   try{order=await meli('/orders/'+encodeURIComponent(searchedOrder),c.accessToken)}
   catch(e){orderLookupError=e.message||'Consulta do pedido indisponível';}
   if(order&&String(order.seller?.id)!==String(sellerId)){
     return Response.json({error:'Pedido vinculado a outra conta vendedora. Confira a conta selecionada no Concilia.',code:'ORDER_SELLER_MISMATCH'}, {status:409});
   }
   // order_id é o filtro oficial que agrega recursos relacionados ao pedido.
   // A segunda busca cobre casos vinculados diretamente ao recurso order.
   const searches=[
     {kind:'order_id',query:new URLSearchParams({order_id:searchedOrder,limit:'100',offset:'0'})},
     {kind:'resource',query:new URLSearchParams({resource:'order',resource_id:searchedOrder,limit:'100',offset:'0'})}
   ];
   const results=await Promise.allSettled(searches.map(async ({kind,query})=>{
     const response=await claimGet('/post-purchase/v1/claims/search?'+query,c.accessToken);
     if(!Array.isArray(response.data))throw Error('Resposta inválida da busca '+kind);
     return {kind,data:response.data,paging:response.paging||{}};
   }));
   const successes=results.flatMap((r,i)=>r.status==='fulfilled'?[r.value]:[]);
   const failures=results.flatMap((r,i)=>r.status==='rejected'?[{source:searches[i].kind,message:String(r.reason?.message||'Falha de consulta').slice(0,180)}]:[]);
   if(!successes.length) return Response.json({
     error:'Não foi possível consultar reclamações por pedido ou por recurso na API.',
     code:'CLAIMS_LOOKUP_UNAVAILABLE',search_errors:failures,order_found:!!order,order_lookup_error:orderLookupError
   },{status:502});
   // Diagnóstico auxiliar dos pedidos previamente sincronizados nesta mesma conta.
   // Não consulta nem expõe tokens. Uma venda ausente pode indicar conta errada ou falta de permissão.
   let orderInConcilia=null;
   try {
     const rows=await checked(db().from('meli_orders').select('order_id,seller_id').eq('order_id',searchedOrder).limit(20));
     orderInConcilia={
       found:rows.length>0,
       connected_sellers:[...new Set(rows.map(x=>String(x.seller_id)))],
       matches_selected_account:rows.some(x=>String(x.seller_id)===String(sellerId))
     };
   } catch { orderInConcilia={available:false}; }
   const unique=new Map();
   for(const group of successes)for(const entry of group.data)if(entry?.id&&!unique.has(String(entry.id)))unique.set(String(entry.id),entry);
   const inspected=[],accountMismatch=[];
   const items=[...unique.values()];
   for(let i=0;i<items.length;i+=6){
     await Promise.all(items.slice(i,i+6).map(async x=>{
       const claimId=String(x.id);
       let full=x;
       // O search pode omitir players. Buscar reclamação completa em vez de descartá-la.
       try{full=await claimGet('/post-purchase/v1/claims/'+encodeURIComponent(claimId),c.accessToken)}
       catch{ if(!Array.isArray(x.players)||!x.players.length)return; }
       const players=Array.isArray(full.players)?full.players:[];
       const confirmed=players.some(t=>t.role==='respondent'&&String(t.user_id)===String(sellerId));
       if(!confirmed){accountMismatch.push(claimId);return;}
       const base={id:full.id,resource_id:full.resource_id||x.resource_id||searchedOrder,
         resource:full.resource||x.resource||null,stage:full.stage||x.stage,
         status:full.status||x.status,reason_id:full.reason_id||x.reason_id,
         last_updated:full.last_updated||x.last_updated,date_created:full.date_created||x.date_created};
       let role=null,due=null;
       try{
         const detail=await claimGet('/post-purchase/v1/claims/'+encodeURIComponent(claimId)+'/detail',c.accessToken);
         role=detail?.action_responsible||null;due=detail?.due_date||null;
       }catch{}
       const group=['respondent','seller'].includes(role)?'seller':['complainant','buyer'].includes(role)?'buyer':['mediator','mercadolibre','mercado_libre'].includes(role)?'meli':'unknown';
       inspected.push({...base,responsibility:base.status==='closed'?'closed':group,action_responsible:role,due_date:due});
     }));
   }
   inspected.sort((a,b)=>Date.parse(b.last_updated||0)-Date.parse(a.last_updated||0));
   return Response.json({
     seller_id:sellerId,order_id:searchedOrder,
     order:order?{id:String(order.id),status:order.status||null,items:(order.order_items||[]).slice(0,20).map(x=>({title:String(x.item?.title||'').slice(0,180),quantity:x.quantity||null}))}:null,
     claims:inspected,
     diagnostics:{order_found:!!order,order_lookup_error:orderLookupError,order_in_concilia:orderInConcilia,searches:successes.map(x=>({source:x.kind,count:x.data.length,paging:x.paging})),search_errors:failures,unverified_or_other_seller:accountMismatch.length,raw_matched_claims:items.length,complete:failures.length===0&&successes.every(x=>x.data.length<100)},
     source:'mercadolivre_live',checked_at:new Date().toISOString(),
     notice:'Reputação é um indicador separado: a API de reclamações pode não refletir todos os problemas de reputação. Confirme a conta vendedora e utilize o painel oficial para impacto e exclusão.'
   },{headers:{'Cache-Control':'no-store'}});
  }
  const status=p.get('status')||'opened',limit=Number(p.get('limit')||30),offset=Number(p.get('offset')||0);
  if(!['opened','closed'].includes(status)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset+limit>=10000)return Response.json({error:'Filtros ou paginação inválidos'},{status:400});
  // Consulta geral restrita aos 60 dias anteriores, usando a data de criação da reclamação.
  // Busca específica por order_id (acima) continua independente do período.
  const endDate=new Date(),startDate=new Date(endDate.getTime()-60*86400000);
  const dateRange='date_created:after:'+startDate.toISOString()+',before:'+endDate.toISOString();
  const qs=new URLSearchParams({'players.user_id':sellerId,'players.role':'respondent',status,limit:String(limit),offset:String(offset),sort:'last_updated:desc',range:dateRange});
  const found=await claimGet('/post-purchase/v1/claims/search?'+qs.toString(),c.accessToken);
  if(!Array.isArray(found.data))throw Error('Resposta inesperada do Mercado Livre');
  if(p.get('filter')==='responsibility'){
   // A responsabilidade vigente é fornecida pelo endpoint /detail do Mercado Livre.
   // available_actions, status e etapa NÃO substituem action_responsible.
   const inspected=[];
   for(let start=0;start<found.data.length;start+=6){
    const batch=found.data.slice(start,start+6);
    inspected.push(...await Promise.all(batch.map(async x=>{
      const base={id:x.id,resource_id:x.resource_id,stage:x.stage,status:x.status,
        last_updated:x.last_updated,date_created:x.date_created,reason_id:x.reason_id};
      try{
       const detail=await claimGet('/post-purchase/v1/claims/'+encodeURIComponent(String(x.id))+'/detail',c.accessToken);
       const responsible=detail?.action_responsible;
       const group=['respondent','seller'].includes(responsible)?'seller':['complainant','buyer'].includes(responsible)?'buyer':['mediator','mercadolibre','mercado_libre'].includes(responsible)?'meli':'unknown';
       return {...base,responsibility:group,action_responsible:responsible||null,
        due_date:detail?.due_date||null,detail_title:detail?.title||null,
        problem:detail?.problem||null,description:detail?.description||null};
      }catch{return {...base,responsibility:'unknown',action_responsible:null,detail_unavailable:true};}
    })));
   }
   const counts={seller:0,buyer:0,meli:0,unknown:0};
   for(const x of inspected)counts[x.responsibility]++;
   return Response.json({seller_id:sellerId,filter:'responsibility',status,
      claims:inspected,counts,scanned:inspected.length,paging:found.paging||{},period:{days:60,from:startDate.toISOString(),to:endDate.toISOString(),field:'date_created'},
      source:'mercadolivre_live',checked_at:new Date().toISOString(),
      notice:'Responsável conforme /claims/{id}/detail. Contadores apenas das reclamações desta página; não equivalem necessariamente aos cartões do site Mercado Livre. Casos sem detalhe permanecem em A verificar.'},
      {headers:{'Cache-Control':'no-store'}});
  }
  if(p.get('filter')==='unanswered'){
   // Inspeciona a última interação de cada reclamação; não interpreta "aberta" como "sem resposta".
   const inspected=[];
   for(let start=0;start<found.data.length;start+=5){
    const batch=found.data.slice(start,start+5);
    inspected.push(...await Promise.all(batch.map(async x=>{
     const actionList=(x.players||[]).find(t=>t.role==='respondent'&&String(t.user_id)===sellerId)?.available_actions||[];
     const canReply=actionList.some(a=>['send_message_to_complainant','send_message_to_mediator'].includes(typeof a==='string'?a:a?.action));
     const id=String(x.id),base='/post-purchase/v1/claims/'+encodeURIComponent(id);
     const summary={id:x.id,resource_id:x.resource_id,stage:x.stage,status:x.status,last_updated:x.last_updated,can_reply:canReply};
     try{
      const response=await claimGet(base+'/messages',c.accessToken);
      // A API pode fornecer lista direta ou objeto com a propriedade messages.
      const messages=Array.isArray(response)?response:Array.isArray(response?.messages)?response.messages:null;
      if(!messages)return {...summary,response_state:'nao_verificado',reason:'Formato inesperado do histórico'};
      const ordered=[...messages].filter(m=>m&&m.status!=='rejected').sort((a,b)=>Date.parse(a.message_date||a.date_created||a.last_updated||0)-Date.parse(b.message_date||b.date_created||b.last_updated||0));
      const last=ordered.at(-1);
      if(!last)return {...summary,response_state:canReply?'sem_mensagem_do_vendedor':'nao_verificado',reason:'Histórico sem mensagens',last_sender:null};
      const sender=last.sender_role;
      const state=sender==='respondent'?'respondida':(sender==='complainant'||sender==='mediator')?(canReply?'resposta_pendente':'aguardando_outra_parte'):'nao_verificado';
      return {...summary,response_state:state,last_sender:sender,last_message_date:last.message_date||last.date_created||null,reason:sender==='respondent'?'Última mensagem do vendedor':canReply?'Última mensagem recebida e envio permitido':'Ação de envio não permitida agora'};
     }catch(e){return {...summary,response_state:'nao_verificado',reason:'Histórico indisponível'};}
    })));
   }
   return Response.json({seller_id:sellerId,status,filter:'unanswered',period:{days:60,from:startDate.toISOString(),to:endDate.toISOString(),field:'date_created'},claims:inspected.filter(x=>['resposta_pendente','sem_mensagem_do_vendedor'].includes(x.response_state)),not_verified:inspected.filter(x=>x.response_state==='nao_verificado'),scanned:inspected.length,paging:found.paging||{},checked_at:new Date().toISOString(),source:'mercadolivre_live',notice:'Filtro por histórico de mensagens da página consultada. Ações comerciais podem estar pendentes mesmo sem nova mensagem; a ausência de ação de resposta exige conferir o caso no ML.'},{headers:{'Cache-Control':'no-store'}});
  }
  return Response.json({seller_id:sellerId,status,paging:found.paging||{},period:{days:60,from:startDate.toISOString(),to:endDate.toISOString(),field:'date_created'},claims:found.data.map(x=>({id:x.id,resource:x.resource,resource_id:x.resource_id,reason_id:x.reason_id,type:x.type,stage:x.stage,status:x.status,date_created:x.date_created,last_updated:x.last_updated,fulfilled:x.fulfilled,available_actions:(x.players||[]).find(t=>t.role==='respondent'&&String(t.user_id)===sellerId)?.available_actions||[]})),source:'mercadolivre_live',checked_at:new Date().toISOString(),notice:'A listagem não prova culpa logística nem exclusão da reputação. Consulte detalhes e evidências.'},{headers:{'Cache-Control':'no-store'}});
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
