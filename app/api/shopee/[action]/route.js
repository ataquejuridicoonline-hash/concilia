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
  if(action==='wallet-transactions'){
   const q=new URL(req.url).searchParams,shopId=q.get('shop_id'),from=Number(q.get('from')),to=Number(q.get('to')),page=Number(q.get('page')||0);
   if(!/^[0-9]+$/.test(shopId||'')||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<1||to<from||to-from>15*86400||to>Math.floor(Date.now()/1000)+60||!Number.isInteger(page)||page<0||page>100000)return Response.json({error:'Loja, período ou página inválida'},{status:400});
   const c=await activeShop(shopId);
   try{
    const response=await fetch(urlFor('/api/v2/payment/get_wallet_transaction_list',{create_time_from:from,create_time_to:to,page_no:page,page_size:100},{access:c.token,shop:c.shop_id}),{cache:'no-store'});
    // Preserve provider 64-bit identifiers before JSON converts them to imprecise numbers.
    const text=await response.text(),raw=JSON.parse(text.replace(/"(transaction_id|withdrawal_id|root_withdrawal_id)"\s*:\s*(\d+)(?=\s*[,}])/g,'"$1":"$2"'));
    if(!response.ok||raw.error)throw Error('wallet_unavailable');
    const r=raw.response||{};
    if(!Array.isArray(r.transaction_list)||typeof r.more!=='boolean')return Response.json({available:false,reason:'Formato do extrato não confirmado; dados anteriores preservados'});
    const code=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v)?v:null;
    const id=v=>typeof v==='string'&&!/^0+$/.test(v)?code(v):Number.isSafeInteger(v)&&v>0?String(v):null;
    const amount=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:round(v);
    const rows=r.transaction_list.map(x=>({transaction_id:id(x.transaction_id)||id(x.transaction_sn),order_sn:code(x.order_sn),withdrawal_id:id(x.withdrawal_id),root_withdrawal_id:id(x.root_withdrawal_id),transaction_type:typeof x.transaction_type==='number'?String(x.transaction_type):code(x.transaction_type),status:code(x.status),money_flow:code(x.money_flow),amount:amount(x.amount),current_balance:amount(x.current_balance),transaction_fee:amount(x.transaction_fee),create_time:Number.isSafeInteger(x.create_time)&&x.create_time>0?x.create_time:null}));
    return Response.json({available:true,shop_id:c.shop_id,checked_at:new Date().toISOString(),transactions:rows,more:r.more,page,source:'shopee_get_wallet_transaction_list',withdrawal_fields:Object.keys(r.transaction_list.find(x=>String(x.transaction_type).includes('WITHDRAWAL'))||{}).filter(x=>/id|withdraw/.test(x)&&/^[A-Za-z0-9_]{1,80}$/.test(x))});
   }catch{return Response.json({available:false,reason:'Extrato da carteira indisponível para esta integração. Importe o CSV oficial da carteira.'});}
  }
  if(action==='income-overview'){
   const shopId=new URL(req.url).searchParams.get('shop_id');
   if(!/^[0-9]+$/.test(shopId||''))return Response.json({error:'Loja inválida'},{status:400});
   const c=await activeShop(shopId);
   try{
    const result=await shopGet('/api/v2/payment/get_income_overview',{income_status:2},c),income=result.total_income;
    const amount=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:round(v);
    if(!income||amount(income.pending_amount)===null)return Response.json({available:false,reason:'Resumo pendente indisponível para esta integração'},{status:502});
    return Response.json({shop_id:c.shop_id,checked_at:new Date().toISOString(),pending_amount:amount(income.pending_amount),to_release_amount:amount(income.to_release_amount),released_amount:amount(income.released_amount),source:'shopee_get_income_overview'});
   }catch{return Response.json({available:false,reason:'Shopee não disponibilizou o resumo de renda para esta integração'},{status:502});}
  }
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
  if(action==='pending-income'){
   const body=await req.json().catch(()=>({})),c=await activeShop(body.shop_id),cursor=body.cursor||'';
   if(typeof cursor!=='string'||cursor.length>512)return Response.json({error:'Cursor inválido'},{status:400});
   let diagnostic={};
   try{
    const path='/api/v2/payment/get_income_detail',end=new Date().toISOString().slice(0,10),start=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    const res=await fetch(urlFor(path,{}, {access:c.token,shop:c.shop_id}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({income_status:2,date_from:start,date_to:end,page_size:100,cursor}),cache:'no-store'}),raw=await res.json().catch(()=>({}));
    if(!res.ok||raw.error){diagnostic={provider_code:typeof raw.error==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(raw.error)?raw.error:null,http_status:res.status};throw Error('unavailable');}
    const block=(raw.response||raw).income_detail_list||(raw.response||raw).list;
    let items=Array.isArray(block)?block:block?.income_detail_list_item;
    if(items&&!Array.isArray(items)&&items.order_sn)items=[items];
    if(!Array.isArray(items)){diagnostic={response_keys:Object.keys(raw.response||raw).filter(x=>/^[A-Za-z0-9_]{1,80}$/.test(x)),list_type:typeof block};throw Error('invalid');}
    const amount=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:round(v);
    const rows=items.map(x=>({order_sn:typeof x.order_sn==='string'&&/^[A-Za-z0-9]{1,64}$/.test(x.order_sn)?x.order_sn:null,currency:x.currency==='BRL'?'BRL':null,estimated_escrow_amount:amount(x.estimated_escrow_amount),estimated_payout_time:Number.isSafeInteger(Number(x.estimated_payout_time))&&Number(x.estimated_payout_time)>0?Number(x.estimated_payout_time):null,creation_date:Number.isSafeInteger(Number(x.creation_date))&&Number(x.creation_date)>0?Number(x.creation_date):null}));
    const next=String(block?.next_page?.cursor||(raw.response||raw).next_page?.cursor||'');
    if(next.length>512||next&&next===cursor)throw Error('pagination');
    return Response.json({shop_id:c.shop_id,checked_at:new Date().toISOString(),orders:rows,cursor:next,more:!!next,source:'shopee_get_income_detail_pending',date_fields:items.length?Object.keys(items[0]).filter(k=>/date|time/.test(k)&&/^[A-Za-z0-9_]{1,80}$/.test(k)):[]});
   }catch{return Response.json({available:false,reason:'Shopee não disponibilizou os recebíveis pendentes para esta integração',diagnostic},{status:502});}
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
  if(action==='evidence'){
   const body=await req.json().catch(()=>({})),c=await activeShop(body.shop_id),ids=body.orderSns;
   const validDate=v=>typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
   if(!Array.isArray(ids)||!ids.length||ids.length>10||new Set(ids).size!==ids.length||ids.some(x=>typeof x!=='string'||! /^[A-Za-z0-9]{1,64}$/.test(x))||!validDate(body.dateStart)||!validDate(body.dateEnd)||body.dateStart>body.dateEnd)return Response.json({error:'Pedidos ou datas inválidos'},{status:400});
   const orders=await checked(db().from('shopee_orders').select('order_sn').eq('shop_id',c.shop_id).gte('create_time',body.dateStart+'T00:00:00Z').lte('create_time',new Date(Date.parse(body.dateEnd+'T00:00:00Z')+86400000-1).toISOString()).in('order_sn',ids));
   if(orders.length!==ids.length)return Response.json({error:'Pedido fora da loja ou período selecionado'},{status:400});
   const code=v=>typeof v==='string'&&/^[\p{L}\p{N}_ .,:;/()\-]{1,300}$/u.test(v)?v:null;
   const amount=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:round(v);
   const evidence=[];
   for(let offset=0;offset<ids.length;offset+=5)await Promise.all(ids.slice(offset,offset+5).map(async order_sn=>{
    const row={shop_id:c.shop_id,order_sn,checked_at:new Date().toISOString(),finance_status:'unavailable',tracking_status:'unavailable',returns_status:'unavailable',returns:[],adjustments:[],income:{},tracking_codes:[]};
    const results=await Promise.allSettled([shopGet('/api/v2/payment/get_escrow_detail',{order_sn},c),shopGet('/api/v2/logistics/get_tracking_info',{order_sn},c)]);
    if(results[1].status==='fulfilled'){
     const track=results[1].value;row.tracking_status='queried';row.logistics_status=code(track.logistics_status);
     row.tracking_codes=[...new Set((Array.isArray(track.tracking_info)?track.tracking_info:[]).map(x=>code(x.logistics_status)).filter(Boolean))];
    }
    if(results[0].status==='fulfilled'){
     const financial=results[0].value,income=financial.order_income;
     if(income&&typeof income==='object'){
      row.finance_status='queried';
      for(const key of ['buyer_total_amount','escrow_amount','escrow_amount_after_adjustment','seller_return_refund','refund_amount_to_buyer','seller_lost_compensation','commission_fee','service_fee','seller_transaction_fee','actual_shipping_fee','reverse_shipping_fee','final_return_to_seller_shipping_fee','order_adjustment_amount'])row.income[key]=amount(income[key]);
      row.adjustments=(Array.isArray(income.order_adjustment)?income.order_adjustment:[]).map(x=>({amount:amount(x.amount),date:Number.isFinite(Number(x.date))?Number(x.date):null,currency:code(x.currency),reason:code(x.adjustment_reason)}));
     }
     const refs=financial.return_order_sn_list;
     if(Array.isArray(refs)){
      row.returns_status=refs.length?'queried':'no_references_returned';
      const safeRefs=[...new Set(refs.filter(x=>typeof x==='string'&&/^[A-Za-z0-9]{1,64}$/.test(x)))];
      if(safeRefs.length!==refs.length)row.returns_status='partial';
      for(const return_sn of safeRefs){
       try{
        const detail=await shopGet('/api/v2/returns/get_return_detail',{return_sn},c);
        if(detail.order_sn&&detail.order_sn!==order_sn){row.returns_status='partial';continue;}
        row.returns.push({return_sn,query_status:'queried',status:code(detail.status),reason:code(detail.reason),reassessed_reason:code(detail.reassessed_request_reason),solution:Number.isInteger(detail.return_solution)?detail.return_solution:null,refund_amount:amount(detail.refund_amount),seller_compensation_status:code(detail.seller_compensation_status),reverse_logistics_status:code(detail.reverse_logistic_status)||code(detail.logistics_status)});
       }catch{row.returns_status='partial';row.returns.push({return_sn,query_status:'unavailable'});}
      }
     }
    }
    evidence.push(row);
   }));
   return Response.json({processed:evidence.length,evidence});
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
   let ok=0,unavailable=0;const summaries=[];
   for(let batch=0;batch<orders.length;batch+=5){
    await Promise.all(orders.slice(batch,batch+5).map(async o=>{
    try{
     const r=await shopGet('/api/v2/payment/get_escrow_detail',{order_sn:o.order_sn},c);
     const income=r.order_income||{};
     const gross=income.buyer_total_amount,net=income.escrow_amount,adjusted=income.escrow_amount_after_adjustment;
     const valid=net!==null&&net!==undefined&&Number.isFinite(Number(net));
     const summary=valid?{buyer_total:gross===null||gross===undefined?null:round(gross),escrow_amount:round(net),escrow_after_adjustment:adjusted===null||adjusted===undefined?null:round(adjusted),financial_status:'valor_esperado',last_checked_at:new Date().toISOString()}:{financial_status:'pendente',last_checked_at:new Date().toISOString()};
     await checked(db().from('shopee_orders').update(summary).eq('shop_id',c.shop_id).eq('order_sn',o.order_sn));
     if(valid){ok++;summaries.push({shop_id:c.shop_id,order_sn:o.order_sn,...summary});}else unavailable++;
    }catch(e){
     unavailable++;
     await checked(db().from('shopee_orders').update({financial_status:'pendente',last_checked_at:new Date().toISOString()}).eq('shop_id',c.shop_id).eq('order_sn',o.order_sn));
    }
    }));
   }
   return Response.json({processed:orders.length,ok,unavailable,orders:summaries,offset:offset+orders.length,complete:orders.length<10});
  }
  return Response.json({error:'Rota não encontrada'},{status:404});
 }catch(e){return fail(e)}
}
