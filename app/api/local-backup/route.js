import {admin,db,checked} from '../../../lib/server.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 try{
  const definitions={
   shopee_orders:['shop_id,order_sn,order_status,create_time,update_time,buyer_total,escrow_amount,escrow_after_adjustment,financial_status,last_checked_at','shop_id','order_sn'],
   shopee_releases:['shop_id,order_sn,released_amount,released_at,source,checked_at','shop_id','order_sn'],
   meli_orders:['order_id,seller_id,status,created_at,updated_at,gross_amount,sale_fees,payment_status,payout_status,currency_id,last_checked_at,raw','seller_id','order_id']
  };
  const p=new URL(req.url).searchParams,table=p.get('table'),offset=Number(p.get('offset')||0);
  if(!Object.hasOwn(definitions,table)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(offset+499))return Response.json({error:'Tabela ou página inválida'},{status:400});
  const [fields,store,id]=definitions[table];
  const page=await checked(db().from(table).select(fields).order(store).order(id).range(offset,offset+499));
  const safePage=table==='meli_orders'?page.map(({raw,...row})=>{
   const mp=raw?.__concilia_mp,shipping=raw?.__concilia_shipping;
   const cost=shipping?.status==='ok'&&shipping.cost!==null&&Number.isFinite(Number(shipping.cost))?Number(shipping.cost):null;
   const net=row.gross_amount!==null&&row.sale_fees!==null&&cost!==null?Math.round((Number(row.gross_amount)-Number(row.sale_fees)-cost)*100)/100:null;
   return {...row,shipping_cost:cost,net_after_shipping:net,mp_net:mp?.net_amount??null,mp_status:mp?.status??null,mp_release_date:mp?.release_date??null,mp_release_status:mp?.release_status??null,mp_checked_at:mp?.checked_at??null};
  }):page;
  return Response.json({format:'concilia-local-v1',generated_at:new Date().toISOString(),tables:{[table]:safePage},nextOffset:offset+page.length,complete:page.length<500},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:'Não foi possível exportar os dados armazenados'},{status:500})}
}
