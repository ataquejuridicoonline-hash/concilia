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
   const info=await shopGet('/api/v2/order/get_order_list',{time_range_field:'create_time',time_from:timeFrom,time_to:timeTo,page_size:50,...(cursor?{cursor}:{} )},c);
   const rows=(info.order_list||[]).filter(x=>x.order_sn).map(x=>({shop_id:c.shop_id,order_sn:String(x.order_sn),order_status:x.order_status||null,create_time:x.create_time?new Date(x.create_time*1000).toISOString():null,update_time:x.update_time?new Date(x.update_time*1000).toISOString():null}));
   if(rows.length)await checked(db().from('shopee_orders').upsert(rows,{onConflict:'shop_id,order_sn',ignoreDuplicates:false}));
   return Response.json({processed:rows.length,cursor:info.next_cursor||'',more:!!info.more});
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
   const orders=await checked(db().from('shopee_orders').select('order_sn').eq('shop_id',c.shop_id).gte('create_time',start+'T00:00:00.000Z').lte('create_time',periodEnd).order('create_time',{ascending:false}).order('order_sn',{ascending:false}).range(offset,offset+9));
   let ok=0,unavailable=0;
   for(const o of orders){
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
   }
   return Response.json({processed:orders.length,ok,unavailable,offset:offset+orders.length,complete:orders.length<10});
  }
  return Response.json({error:'Rota não encontrada'},{status:404});
 }catch(e){return fail(e)}
}
