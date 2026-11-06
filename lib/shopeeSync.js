// List responses identify orders; detail responses supply their creation dates.
export async function syncOrderPage({connection,timeFrom,timeTo,cursor='',get,save,verify}){
 const info=await get('/api/v2/order/get_order_list',{time_range_field:'create_time',time_from:timeFrom,time_to:timeTo,page_size:50,...(cursor?{cursor}:{})},connection);
 if(!Array.isArray(info.order_list))throw Error('Shopee retornou uma lista de pedidos inválida');
 const ids=[...new Set(info.order_list.map(x=>String(x.order_sn||'')).filter(Boolean))];
 if(ids.length!==info.order_list.length)throw Error('Shopee retornou identificadores ausentes ou repetidos');
 const more=info.more===true,next=String(info.next_cursor||'');
 if(more&&(!next||next===cursor))throw Error('A paginação Shopee não avançou');
 let rows=[];
 if(ids.length){
  const detail=await get('/api/v2/order/get_order_detail',{order_sn_list:ids.join(',')},connection);
  if(!Array.isArray(detail.order_list))throw Error('Shopee não retornou os detalhes dos pedidos');
  const map=new Map(detail.order_list.map(o=>[String(o.order_sn),o]));
  rows=ids.map(id=>{
   const o=map.get(id),created=Number(o?.create_time),updated=Number(o?.update_time);
   if(!o||!Number.isSafeInteger(created)||created<=0||!Number.isFinite(new Date(created*1000).getTime()))throw Error('Detalhes Shopee incompletos: data de criação ausente');
   if(created<timeFrom||created>timeTo)throw Error('Shopee retornou pedido fora do período solicitado');
   return {shop_id:connection.shop_id,order_sn:id,order_status:o.order_status||null,create_time:new Date(created*1000).toISOString(),...(Number.isSafeInteger(updated)&&updated>0?{update_time:new Date(updated*1000).toISOString()}: {})};
  });
  await save(rows);
  if(await verify(ids)!==ids.length)throw Error('Não foi possível confirmar a gravação de todos os pedidos');
 }
 return {queried:ids.length,stored:rows.length,processed:rows.length,cursor:next,more};
}
