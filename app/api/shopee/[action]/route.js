import {receiptTiming} from '../../../../lib/shopeeReceiptTiming.js';
import {syncOrderPage} from '../../../../lib/shopeeSync.js';
import crypto from 'node:crypto';
import {admin,db,checked,hash,seal} from '../../../../lib/server.js';
import {configured,cfg,urlFor,publicPost,shopConnection,activeShop,shopGet,round} from '../../../../lib/shopee.js';
export const runtime='nodejs';
function fail(e){return Response.json({error:e.message||'Erro inesperado'},{status:500})}
export async function GET(req,{params}){
 const {action}=await params;
 if(action==='callback'){
  // Redirect sempre usa a origem pública da rota; configuração APP_URL inválida não deve causar HTTP 500.
  const u=new URL(req.url);
  const back=code=>{const home=new URL('/',u.origin);home.searchParams.set('shopee',code);const response=Response.redirect(home,303);response.headers.append('Set-Cookie','shopee_oauth=; Path=/api/shopee; Max-Age=0; HttpOnly; Secure; SameSite=Lax');return response};
  try{
   const cookie=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('shopee_oauth='))?.split('=')[1];
   const code=u.searchParams.get('code'),shopId=u.searchParams.get('shop_id');
   if(!cookie||!code||!/^\d+$/.test(shopId||''))return back('autorizacao_incompleta');
   const rows=await checked(db().from('shopee_auth_states').delete().eq('state_hash',hash(cookie)).gt('expires_at',new Date().toISOString()).select('state_hash'));
   if(rows.length!==1)return back('autorizacao_expirada');
   const c=cfg(),t=await publicPost('/api/v2/auth/token/get',{code,partner_id:c.id,shop_id:Number(shopId)});
   if(!t.access_token||!t.refresh_token)return back('token_invalido');
   // A resposta do endpoint auth/token/get pode não incluir shop_id_list.
   const shops=Array.isArray(t.shop_id_list)?t.shop_id_list.map(String):null;
   if(shops&&!shops.includes(shopId))return back('loja_divergente');
   await checked(db().from('shopee_connections').upsert({shop_id:Number(shopId),access_token_cipher:seal(t.access_token),refresh_token_cipher:seal(t.refresh_token),expires_at:new Date(Date.now()+(Number(t.expire_in)||14400)*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'shop_id'}));
   return back('conectado');
  }catch(e){
   console.error('[Shopee callback]',String(e?.message||e).slice(0,200));
   return back('falha_autorizacao')
  }
 }
 if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 try{
  if(action==='status'){
   let shops=[],migrationReady=true;
   try{shops=await checked(db().from('shopee_connections').select('shop_id,connected_at').order('connected_at',{ascending:true}))}catch(e){migrationReady=false}
   let releasesReady=false;
   try{await checked(db().from('shopee_releases').select('shop_id').limit(1));releasesReady=true}catch(e){}
   return Response.json({configured:configured(),connected:shops.length>0,shops,migrationReady,releasesReady});
  }
  if(action==='receipt-timing'){
   const p=new URL(req.url).searchParams,shopId=p.get('shop_id'),start=p.get('dateStart'),end=p.get('dateEnd');
   const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
   if(!/^[0-9]+$/.test(shopId||'')||!validDate(start)||!validDate(end)||start>end)return Response.json({error:'Selecione uma loja e datas válidas'},{status:400});
   if(!await shopConnection(shopId))return Response.json({error:'Loja Shopee não vinculada'},{status:404});
   const releases=[];
   for(let offset=0;offset<=100000;offset+=1000){
    const page=await checked(db().from('shopee_releases').select('order_sn,released_amount,released_at').eq('shop_id',shopId).gte('released_at',start+'T00:00:00Z').lte('released_at',new Date(Date.parse(end+'T00:00:00Z')+86400000-1).toISOString()).order('released_at',{ascending:false}).order('order_sn',{ascending:false}).range(offset,offset+999));
    releases.push(...page);if(page.length<1000)break;
    if(offset===100000)throw Error('Período muito extenso para calcular o prazo; reduza as datas');
   }
   const ids=[...new Set(releases.map(r=>r.order_sn))],orders=[];
   for(let offset=0;offset<ids.length;offset+=100)orders.push(...await checked(db().from('shopee_orders').select('order_sn,create_time').eq('shop_id',shopId).in('order_sn',ids.slice(offset,offset+100))));
   return Response.json({...receiptTiming(releases,orders),dateStart:start,dateEnd:end,basis:'criacao_pedido_ate_credito_carteira'});
  }
  if(action==='credits'){
   const p=new URL(req.url).searchParams,shopId=p.get('shop_id'),start=p.get('dateStart'),end=p.get('dateEnd'),offset=Number(p.get('offset')||0);
   if(!/^[0-9]+$/.test(shopId||'')||!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||'')||start>end||!Number.isInteger(offset)||offset<0||offset>100000)return Response.json({error:'Loja, período ou página inválida'},{status:400});
   if(!await shopConnection(shopId))return Response.json({error:'Loja Shopee não vinculada'},{status:404});
   const {data,error,count}=await db().from('shopee_releases').select('order_sn,released_amount,released_at',{count:'exact'}).eq('shop_id',shopId).gte('released_at',start+'T00:00:00Z').lte('released_at',new Date(Date.parse(end+'T00:00:00Z')+86400000-1).toISOString()).order('released_at',{ascending:false}).order('order_sn',{ascending:false}).range(offset,offset+99);
   if(error)throw Error('Não foi possível carregar os créditos armazenados');
   const ids=(data||[]).map(x=>x.order_sn);
   const orders=ids.length?await checked(db().from('shopee_orders').select('order_sn,order_status,buyer_total,escrow_amount,escrow_after_adjustment,financial_status').eq('shop_id',shopId).in('order_sn',ids)):[];
   const orderMap=new Map(orders.map(o=>[o.order_sn,o]));
   return Response.json({credits:(data||[]).map(c=>({...orderMap.get(c.order_sn),...c})),total:count||0,nextOffset:offset+(data||[]).length});
  }
  if(action==='review-candidates'){
   const p=new URL(req.url).searchParams,shopId=p.get('shop_id'),start=p.get('dateStart'),end=p.get('dateEnd');
   const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
   if(!/^[0-9]+$/.test(shopId||'')||!valid(start)||!valid(end)||start>end)return Response.json({error:'Loja ou datas inválidas'},{status:400});
   if(!await shopConnection(shopId))return Response.json({error:'Loja não vinculada'},{status:404});
   const ids=[];
   for(let offset=0;;offset+=1000){
    const page=await checked(db().from('shopee_releases').select('order_sn').eq('shop_id',shopId).lte('released_amount',0).order('order_sn',{ascending:true}).range(offset,offset+999));
    ids.push(...page.map(x=>x.order_sn));if(page.length<1000)break;
    if(ids.length>=100000)throw Error('Reduza o período para revisar');
   }
   const orders=[];
   for(let i=0;i<ids.length;i+=100)orders.push(...await checked(db().from('shopee_orders').select('order_sn').eq('shop_id',shopId).neq('order_status','CANCELLED').gte('create_time',start+'T00:00:00Z').lte('create_time',new Date(Date.parse(end+'T00:00:00Z')+86400000-1).toISOString()).in('order_sn',ids.slice(i,i+100))));
   return Response.json({orderSns:[...new Set(orders.map(x=>x.order_sn))].sort()});
  }
  if(action==='orders'){
   const shopId=new URL(req.url).searchParams.get('shop_id');
   if(!/^[0-9]+$/.test(shopId||''))return Response.json({error:'Selecione uma loja Shopee'},{status:400});
   if(!await shopConnection(shopId))return Response.json({error:'Loja Shopee não vinculada'},{status:404});
   const p=new URL(req.url).searchParams,start=p.get('dateStart'),end=p.get('dateEnd'),offset=Number(p.get('offset')||0);
   if(!Number.isInteger(offset)||offset<0||offset>100000)return Response.json({error:'Paginação inválida'},{status:400});
   const validDates=start&&end&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)&&start<=end;
   if((start||end)&&!validDates)return Response.json({error:'Datas inválidas para consulta de pedidos Shopee'},{status:400});
   let query=db().from('shopee_orders').select('order_sn,order_status,create_time,buyer_total,escrow_amount,escrow_after_adjustment,financial_status',{count:'exact'}).eq('shop_id',shopId);
   if(validDates)query=query.gte('create_time',start+'T00:00:00.000Z').lte('create_time',new Date(Date.parse(end+'T00:00:00Z')+86400000-1).toISOString());
   const {data,error,count}=await query.order('create_time',{ascending:false}).order('order_sn',{ascending:false}).range(offset,offset+99);
   if(error)throw Error(error.message);
   const orders=data||[],ids=orders.map(x=>x.order_sn);
   let releases=[];
   if(ids.length)try{releases=await checked(db().from('shopee_releases').select('order_sn,released_amount,released_at').eq('shop_id',shopId).in('order_sn',ids))}catch(e){}
   const rmap=new Map(releases.map(x=>[x.order_sn,x]));
   return Response.json({orders:orders.map(o=>({...o,released_amount:rmap.get(o.order_sn)?.released_amount??null,released_at:rmap.get(o.order_sn)?.released_at??null})),total:count||0,offset,nextOffset:offset+orders.length,complete:offset+orders.length>=(count||0)});
  }
  return Response.json({error:'Rota não encontrada'},{status:404});
 }catch(e){return fail(e)}
}
export async function POST(req,{params}){
 if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 const {action}=await params;
 try{
  if(action==='start'){
   const c=cfg(),nonce=crypto.randomBytes(32).toString('hex');
   await checked(db().from('shopee_auth_states').insert({state_hash:hash(nonce),expires_at:new Date(Date.now()+600000).toISOString()}));
   const url=urlFor('/api/v2/shop/auth_partner',{redirect:c.redirect});
   const response=Response.json({url:url.toString()});
   response.headers.append('Set-Cookie','shopee_oauth='+nonce+'; Path=/api/shopee; Max-Age=600; HttpOnly; Secure; SameSite=Lax');
   return response;
  }
  if(action==='sync'){
   const body=await req.json().catch(()=>({})),c=await activeShop(body.shop_id);
   const timeTo=Number(body.timeTo),timeFrom=Number(body.timeFrom),cursor=String(body.cursor||'');
   if(!Number.isSafeInteger(timeFrom)||!Number.isSafeInteger(timeTo)||timeTo<=timeFrom||timeTo-timeFrom>7*86400||timeTo>Math.floor(Date.now()/1000)+60||cursor.length>256) return Response.json({error:'Intervalo inválido'},{status:400});
   const result=await syncOrderPage({connection:c,timeFrom,timeTo,cursor,get:shopGet,
    save:rows=>checked(db().from('shopee_orders').upsert(rows,{onConflict:'shop_id,order_sn',ignoreDuplicates:false})),
    verify:async ids=>{
     const {count,error}=await db().from('shopee_orders').select('order_sn',{count:'exact',head:true}).eq('shop_id',c.shop_id).in('order_sn',ids).gte('create_time',new Date(timeFrom*1000).toISOString()).lte('create_time',new Date(timeTo*1000).toISOString());
     if(error)throw Error('Falha ao verificar pedidos armazenados');return count;
    }});
   console.info('[Shopee sync]',JSON.stringify({queried:result.queried,stored:result.stored,more:result.more}));
   return Response.json(result);
  }
  if(action==='releases'){
   const body=await req.json().catch(()=>({}));
   const c=await activeShop(body.shop_id);
   const from=Number(body.timeFrom),to=Number(body.timeTo),page=Number(body.page||1);
   if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<=from||to-from>7*86400||to>Math.floor(Date.now()/1000)+60||!Number.isInteger(page)||page<1||page>100)
    return Response.json({error:'Intervalo ou página inválida para consultar liberações da Shopee'},{status:400});
   const result=await shopGet('/api/v2/payment/get_escrow_list',{release_time_from:from,release_time_to:to,page_size:100,page_no:page},c);
   if(!Array.isArray(result.escrow_list))throw Error('Shopee não retornou uma lista válida de liberações');
   const items=result.escrow_list.filter(x=>x.order_sn&&x.payout_amount!==undefined&&x.escrow_release_time).map(x=>({
     shop_id:c.shop_id,order_sn:String(x.order_sn),released_amount:round(x.payout_amount),
     released_at:new Date(Number(x.escrow_release_time)*1000).toISOString(),source:'shopee_get_escrow_list',checked_at:new Date().toISOString()
   }));
   if(items.length)await checked(db().from('shopee_releases').upsert(items,{onConflict:'shop_id,order_sn'}));
   return Response.json({processed:items.length,totalReleased:Math.round(items.reduce((sum,x)=>sum+x.released_amount,0)*100)/100,more:!!result.more,page,period:'liberacao_carteira'});
  }
  if(action==='finance'){
   const body=await req.json().catch(()=>({})),c=await activeShop(body.shop_id),offset=Number(body.offset||0);
   if(!Number.isInteger(offset)||offset<0||offset>10000)return Response.json({error:'Offset inválido'},{status:400});
   const start=body.dateStart,end=body.dateEnd;
   if(typeof start!=='string'||typeof end!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)||start>end||Date.parse(end+'T00:00:00Z')>Date.now())return Response.json({error:'Selecione um período válido para conferência Shopee.'},{status:400});
   const periodEnd=new Date(Date.parse(end+'T00:00:00Z')+86400000-1).toISOString();
   const requested=body.orderSns;
   if(requested!==undefined&&(!Array.isArray(requested)||requested.length<1||requested.length>10||requested.some(x=>typeof x!=='string'||! /^[A-Za-z0-9]{1,64}$/.test(x))||new Set(requested).size!==requested.length))return Response.json({error:'Pedidos inválidos para revisão'},{status:400});
   let query=db().from('shopee_orders').select('order_sn').eq('shop_id',c.shop_id).gte('create_time',start+'T00:00:00.000Z').lte('create_time',periodEnd);
   if(requested)query=query.in('order_sn',requested);
   const orders=await checked(query.order('create_time',{ascending:false}).order('order_sn',{ascending:false}).range(requested?0:offset,requested?9:offset+9));
   if(requested&&orders.length!==requested.length)return Response.json({error:'Pedido não pertence à loja ou período selecionado'},{status:400});
   let ok=0,unavailable=0;
   for(let batch=0;batch<orders.length;batch+=5){
    await Promise.all(orders.slice(batch,batch+5).map(async o=>{
    try{
     const r=await shopGet('/api/v2/payment/get_escrow_detail',{order_sn:o.order_sn},c);
     const income=r.order_income||{};
     const gross=income.buyer_total_amount,net=income.escrow_amount,adjusted=income.escrow_amount_after_adjustment;
     const valid=net!==null&&net!==undefined&&Number.isFinite(Number(net));
     const summary=valid?{buyer_total:gross===null||gross===undefined?null:round(gross),escrow_amount:round(net),escrow_after_adjustment:adjusted===null||adjusted===undefined?null:round(adjusted),financial_status:'valor_esperado',last_checked_at:new Date().toISOString()}:{financial_status:'pendente',last_checked_at:new Date().toISOString()};
     await checked(db().from('shopee_orders').update(summary).eq('shop_id',c.shop_id).eq('order_sn',o.order_sn));
     if(valid)ok++;else unavailable++;
    }catch(e){
     unavailable++;
     await checked(db().from('shopee_orders').update({financial_status:'pendente',last_checked_at:new Date().toISOString()}).eq('shop_id',c.shop_id).eq('order_sn',o.order_sn));
    }
    }));
   }
   return Response.json({processed:orders.length,ok,unavailable,offset:offset+orders.length,complete:orders.length<10});
  }
  return Response.json({error:'Rota não encontrada'},{status:404});
 }catch(e){return fail(e)}
}
