import crypto from 'node:crypto';
import {admin,db,checked,hash,seal,unseal,config,oauth,meli,connection,validConnection,normalize} from '../../../../lib/server.js';
export const runtime='nodejs';
const errorResponse=e=>Response.json({error:e.message||'Erro interno'},{status:500});
export async function GET(req,{params}){const {action}=await params;
 if(action==='callback'){
  const u=new URL(req.url);const dest=x=>{const t=new URL('/',process.env.APP_URL||u.origin);t.searchParams.set('meli',x);return Response.redirect(t,303)};
  try{const state=u.searchParams.get('state'),code=u.searchParams.get('code');if(!state||!code)return dest('autorizacao_cancelada');
   const s=await checked(db().from('meli_oauth_states').select('*').eq('state_hash',hash(state)).limit(1)),row=s?.[0];
   if(!row||new Date(row.expires_at).getTime()<Date.now())return dest('estado_invalido');
   const removed=await checked(db().from('meli_oauth_states').delete().eq('state_hash',row.state_hash).select('state_hash'));if(removed.length!==1)return dest('estado_utilizado');
   const cfg=config(),t=await oauth({grant_type:'authorization_code',client_id:cfg.id,client_secret:cfg.secret,code,redirect_uri:cfg.redirect,code_verifier:unseal(row.verifier_cipher)});
   if(!t.access_token||!t.refresh_token||!t.expires_in)throw Error('Tokens incompletos');
   const profile=await meli('/users/me',t.access_token),seller_id=Number(profile.id);if(!seller_id)throw Error('Identificação do vendedor ausente');
   await checked(db().from('meli_connections').upsert({seller_id,access_token_cipher:seal(t.access_token),refresh_token_cipher:seal(t.refresh_token),expires_at:new Date(Date.now()+Number(t.expires_in)*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'seller_id'}));return dest('conectado');
  }catch(e){return dest('erro_autorizacao')}
 }
 try{if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
  if(action==='status'){const stores=await checked(db().from('meli_connections').select('seller_id,connected_at').order('connected_at',{ascending:true}));return Response.json({connected:stores.length>0,stores,credentialsConfigured:!!(process.env.MELI_CLIENT_ID&&process.env.MELI_CLIENT_SECRET&&process.env.MELI_REDIRECT_URI&&process.env.TOKEN_ENCRYPTION_KEY),mercadoPagoConfigured:!!process.env.MP_ACCESS_TOKEN})}
  if(action==='orders'){
   const sellerId=new URL(req.url).searchParams.get('seller_id');
   if(!/^[0-9]+$/.test(sellerId||''))return Response.json({error:'Selecione uma conta Mercado Livre'},{status:400});
   if(!await connection(sellerId))return Response.json({error:'Conta Mercado Livre não vinculada'},{status:404});
   const qs=new URL(req.url).searchParams;
   const start=qs.get('dateStart'),end=qs.get('dateEnd');
   const validDates=start&&end&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)&&start<=end;
   if((start||end)&&!validDates)return Response.json({error:'Datas inválidas para consultar pedidos'},{status:400});
   const first=validDates?start+'T00:00:00.000Z':null,last=validDates?new Date(Date.parse(end+'T00:00:00Z')+86400000-1).toISOString():null;
   let orderQuery=db().from('meli_orders').select('order_id,status,created_at,gross_amount,sale_fees,payment_status,payout_status,raw').eq('seller_id',sellerId);
   let countQuery=db().from('meli_orders').select('id',{count:'exact',head:true}).eq('seller_id',sellerId);
   if(validDates){orderQuery=orderQuery.gte('created_at',first).lte('created_at',last);countQuery=countQuery.gte('created_at',first).lte('created_at',last)}
   const orders=await checked(orderQuery.order('created_at',{ascending:false}).limit(500));
   const {count,error}=await countQuery;if(error)throw Error(error.message);
   const rows=orders.map(o=>{
    const raw=o.raw||{}, payments=Array.isArray(raw.payments)?raw.payments:[];
    const paymentNet=payments.length&&payments.every(p=>Number.isFinite(Number(p.transaction_details?.net_received_amount))&&p.transaction_details?.net_received_amount!==null)
      ?payments.reduce((s,p)=>s+Number(p.transaction_details.net_received_amount),0):null;
    const gross=o.gross_amount===null?null:Number(o.gross_amount);
    const fee=o.sale_fees===null?null:Number(o.sale_fees);
    const preview=gross!==null&&Number.isFinite(gross)&&fee!==null&&Number.isFinite(fee)?Math.round((gross-fee)*100)/100:null;
    const mp=raw.__concilia_mp;
    const shipping=raw.__concilia_shipping;
    const shippingCost=shipping?.status==='ok'&&Number.isFinite(Number(shipping.cost))?Number(shipping.cost):null;
    const netAfterShipping=preview!==null&&shippingCost!==null?Math.round((preview-shippingCost)*100)/100:null;
    const {raw:ignored,...publicOrder}=o;
    return {...publicOrder,estimated_net:preview,shipping_cost:shippingCost,net_after_shipping:netAfterShipping,shipping_status:shipping?.status||'pendente',net_basis:netAfterShipping===null?'incompleto':'venda_menos_tarifa_e_frete',payment_net_reference:paymentNet,mp_status:mp?.status||'nao_consultado',mp_payment_status:mp?.payment_status||null,mp_net:mp?.net_amount??null,mp_release_date:mp?.release_date||null,mp_release_status:mp?.release_status||null,mp_payment_count:mp?.payment_count??null,mp_checked_at:mp?.checked_at||null};
   });
   return Response.json({orders:rows,totalStored:count??rows.length});
  }
  return Response.json({error:'Rota não encontrada'},{status:404});
 }catch(e){return errorResponse(e)}
}
export async function POST(req,{params}){const {action}=await params;if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 try{
  if(action==='start'){const cfg=config(),verifier=crypto.randomBytes(48).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url'),state=crypto.randomBytes(32).toString('hex');
   await checked(db().from('meli_oauth_states').insert({state_hash:hash(state),verifier_cipher:seal(verifier),expires_at:new Date(Date.now()+600000).toISOString()}));
   const url=new URL('https://auth.mercadolivre.com.br/authorization');for(const [k,v] of Object.entries({response_type:'code',client_id:cfg.id,redirect_uri:cfg.redirect,state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(k,v);return Response.json({url:url.toString()})}
  if(action==='mercadopago'){
   const body=await req.json().catch(()=>({}));
   const c=await validConnection(body.seller_id);
   const token=process.env.MP_ACCESS_TOKEN?.trim();
   if(!token)return Response.json({error:'Cadastre MP_ACCESS_TOKEN (produção) como Secret na Vercel para consultar pagamentos.'},{status:400});
   const offset=Number(body.offset??0);
   if(!Number.isInteger(offset)||offset<0||offset>=10000)return Response.json({error:'Offset inválido'},{status:400});
   const start=body.dateStart,end=body.dateEnd;
   if(typeof start!=='string'||typeof end!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)||start>end||Date.parse(end+'T00:00:00Z')>Date.now())return Response.json({error:'Selecione datas válidas para conferir o período.'},{status:400});
   const periodEnd=new Date(Date.parse(end+'T00:00:00.000Z')+86400000-1).toISOString();
   // Consulta controlada de 10 pedidos para evitar bloqueio e timeout.
   const orders=await checked(db().from('meli_orders').select('order_id,seller_id,raw').eq('seller_id',c.seller_id).gte('created_at',start+'T00:00:00.000Z').lte('created_at',periodEnd).order('created_at',{ascending:false}).order('order_id',{ascending:false}).range(offset,offset+9));
   let confirmed=0,partial=0,unavailable=0;
   for(const o of orders){
    const raw=o.raw||{},payments=(Array.isArray(raw.payments)?raw.payments:[]).filter(p=>p?.id);
    const ids=[...new Set(payments.map(p=>String(p.id)))];
    let snapshot={status:'sem_pagamento',net_amount:null,release_date:null,release_status:null,payment_status:null,payment_count:ids.length,checked_at:new Date().toISOString()};
    if(ids.length){
     let amounts=[],details=[],inaccessible=false;
     for(const id of ids){
      // Permitir somente IDs numéricos, nunca URL remota.
      if(!/^[0-9]+$/.test(id)){inaccessible=true;continue}
      const response=await fetch('https://api.mercadopago.com/v1/payments/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if(response.status===429)throw Error('Mercado Pago limitou as consultas (HTTP 429). Tente mais tarde.');
      if(response.status===401||response.status===403)throw Error('Credencial Mercado Pago sem acesso (HTTP '+response.status+'). Confira o Access Token de produção da conta vendedora.');
      if(!response.ok){inaccessible=true;continue}
      const p=await response.json();
      const amount=p.transaction_details?.net_received_amount;
      if(amount===null||amount===undefined||!Number.isFinite(Number(amount))){inaccessible=true;continue}
      amounts.push(Number(amount));
      details.push({id,status:p.status||null,money_release_status:p.money_release_status||null,money_release_date:p.money_release_date||null,amount:Number(amount)});
     }
     const available=amounts.length===ids.length&&!inaccessible;
     snapshot={...snapshot,status:available?'consultado':'incompleto',net_amount:available?Math.round(amounts.reduce((a,b)=>a+b,0)*100)/100:null,
      release_date:available&&details.every(p=>p.money_release_date)?details.map(p=>p.money_release_date).sort().at(-1):null,
      release_status:available&&details.every(p=>p.money_release_status===details[0].money_release_status)?details[0].money_release_status:null,
      payment_status:available&&details.every(p=>p.status===details[0].status)?details[0].status:null,
      payment_count:ids.length};
     if(available)confirmed++;else partial++;
    }else unavailable++;
    await checked(db().from('meli_orders').update({raw:{...raw,__concilia_mp:snapshot}}).eq('seller_id',c.seller_id).eq('order_id',o.order_id));
   }
   return Response.json({processed:orders.length,confirmed,partial,unavailable,offset:offset+orders.length,complete:orders.length<10,notice:'Valor do pagamento Mercado Pago não comprova saque bancário; podem existir ajustes posteriores'});
  }
  if(action==='shipping'){
   const body=await req.json().catch(()=>({}));
   const c=await validConnection(body.seller_id);const offset=Number(body.offset??0);
   if(!Number.isInteger(offset)||offset<0||offset>=10000)return Response.json({error:'Offset inválido'},{status:400});
   const start=body.dateStart,end=body.dateEnd;
   if(typeof start!=='string'||typeof end!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)||start>end||Date.parse(end+'T00:00:00Z')>Date.now())return Response.json({error:'Selecione datas válidas para conferir o período.'},{status:400});
   const periodEnd=new Date(Date.parse(end+'T00:00:00.000Z')+86400000-1).toISOString();
   // Lotes pequenos evitam timeout e permitem apresentar progresso.
   const orders=await checked(db().from('meli_orders').select('order_id,seller_id,raw').eq('seller_id',c.seller_id).gte('created_at',start+'T00:00:00.000Z').lte('created_at',periodEnd).order('created_at',{ascending:false}).order('order_id',{ascending:false}).range(offset,offset+14));
   const results=[];let updated=0,missing=0,failed=0;
   for(const o of orders){
    const raw=o.raw||{},shippingId=raw.shipping?.id;
    let shipping;
    if(!shippingId){shipping={status:'sem_id',cost:null,checked_at:new Date().toISOString()};missing++}
    else try{
     const r=await fetch('https://api.mercadolibre.com/shipments/'+encodeURIComponent(String(shippingId))+'/costs',{headers:{Authorization:'Bearer '+c.accessToken,'x-format-new':'true'},cache:'no-store'});
     if(r.status===429)throw Error('Limite de consultas da API atingido (429). Tente novamente mais tarde.');
     if(!r.ok){shipping={status:'indisponivel',cost:null,http_status:r.status,checked_at:new Date().toISOString()};failed++}
     else{
      const data=await r.json(),sender=(data.senders||[]).find(x=>String(x.user_id)===String(c.seller_id));
      if(sender&&sender.cost!==null&&sender.cost!==undefined&&Number.isFinite(Number(sender.cost))){
       shipping={status:'ok',cost:Number(sender.cost),shipment_id:String(shippingId),checked_at:new Date().toISOString()};updated++;
      }else{shipping={status:'sem_custo_vendedor',cost:null,checked_at:new Date().toISOString()};missing++}
     }
    }catch(e){if(e.message.includes('429'))throw e;shipping={status:'erro',cost:null,checked_at:new Date().toISOString()};failed++}
    await checked(db().from('meli_orders').update({raw:{...raw,__concilia_shipping:shipping}}).eq('seller_id',c.seller_id).eq('order_id',o.order_id));
    results.push({order_id:o.order_id,status:shipping.status});
   }
   return Response.json({processed:orders.length,updated,missing,failed,offset:offset+orders.length,complete:orders.length<15,notice:'Frete consultado; ajustes financeiros extras e liberações não verificados'});
  }
  if(action==='sync'){
   const body=await req.json().catch(()=>({}));
   const c=await validConnection(body.seller_id);
   const offset=Number(body.offset??0);
   const from=body.from,to=body.to;
   if(!Number.isInteger(offset)||offset<0||offset>=10000)return Response.json({error:'Offset inválido ou limite de paginação alcançado. Divida o período em janelas menores.'},{status:400});
   const f=Date.parse(from),t=Date.parse(to);
   if(typeof from!=='string'||typeof to!=='string'||!Number.isFinite(f)||!Number.isFinite(t)||t<f||t-f>7*86400000||f>Date.now()+60000||t>Date.now()+86400000) return Response.json({error:'Período inválido. Utilize uma janela de até 7 dias, sem datas futuras.'},{status:400});
   const inserted=await checked(db().from('meli_sync_runs').insert({seller_id:c.seller_id,status:'running'}).select('id').single());
   const run=inserted.id;
   try{
    let processed=0,current=offset,total=null,complete=false;
    // Até quatro páginas por requisição para reduzir risco de timeout na Vercel.
    for(let page=0;page<4;page++){
     const qs=new URLSearchParams({seller:String(c.seller_id),limit:'50',offset:String(current),'order.date_created.from':from,'order.date_created.to':to,sort:'date_desc'});
     const response=await meli('/orders/search?'+qs,c.accessToken);
     const results=response.results||[];
     if(Number.isFinite(Number(response.paging?.total)))total=Number(response.paging.total);
     if(results.length){
      const ids=results.map(o=>String(o.id));
      const existing=await checked(db().from('meli_orders').select('order_id,raw').eq('seller_id',c.seller_id).in('order_id',ids));
      const oldMap=new Map((existing||[]).map(o=>[o.order_id,{shipping:o.raw?.__concilia_shipping,mp:o.raw?.__concilia_mp}]));
      await checked(db().from('meli_orders').upsert(results.map(o=>{
       const row=normalize(o),previous=oldMap.get(row.order_id);
       return {...row,seller_id:c.seller_id,raw:previous?{...o,...(previous.shipping?{__concilia_shipping:previous.shipping}:{}),...(previous.mp?{__concilia_mp:previous.mp}:{})}:o};
      }),{onConflict:'seller_id,order_id'}));
      processed+=results.length;
     }
     current+=results.length;
     if(results.length<50||(total!==null&&current>=total)){complete=true;break}
     if(current>=10000)break;
    }
    await checked(db().from('meli_sync_runs').update({status:'ok',processed,finished_at:new Date().toISOString()}).eq('id',run));
    return Response.json({processed,total,offset:current,complete,limitReached:!complete&&current>=10000,notice:'Liberação financeira não verificada'});
   }catch(e){
    await db().from('meli_sync_runs').update({status:'erro',error_message:e.message.slice(0,300),finished_at:new Date().toISOString()}).eq('id',run);
    throw e;
   }
  }
  return Response.json({error:'Rota não encontrada'},{status:404})
 }catch(e){return errorResponse(e)}
}
