import {admin,db,checked,connection} from '../../../lib/server.js';
import {shopConnection} from '../../../lib/shopee.js';
import {auditMeli,auditShopee} from '../../../lib/financialAudit.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const dayPattern=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
function validDay(day){return dayPattern.test(day||'')&&!Number.isNaN(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day}
export async function GET(req){
 if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 try{
  const q=new URL(req.url).searchParams;
  const platform=q.get('platform'),store=q.get('store'),start=q.get('start'),end=q.get('end');
  const offset=Number(q.get('offset')||0),limit=100;
  if(!['meli','shopee'].includes(platform)||!/^[0-9]+$/.test(store||''))return Response.json({error:'Selecione a plataforma e a conta.'},{status:400});
  if(!validDay(start)||!validDay(end)||start>end||Date.parse(end+'T00:00:00Z')>Date.now()||Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>365*86400000)
   return Response.json({error:'Escolha um período válido de até 366 dias.'},{status:400});
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return Response.json({error:'Paginação inválida'},{status:400});
  const linked=platform==='meli'?await connection(store):await shopConnection(store);
  if(!linked)return Response.json({error:'Conta não conectada.'},{status:404});
  const startTime=start+'T00:00:00.000Z';
  const endTime=new Date(Date.parse(end+'T00:00:00.000Z')+86400000-1).toISOString();
  let query,countQuery;
  if(platform==='meli'){
   query=db().from('meli_orders').select('order_id,seller_id,created_at,status,gross_amount,sale_fees,raw').eq('seller_id',store).gte('created_at',startTime).lte('created_at',endTime).order('created_at',{ascending:false}).order('order_id',{ascending:false}).range(offset,offset+limit-1);
   countQuery=db().from('meli_orders').select('id',{count:'exact',head:true}).eq('seller_id',store).gte('created_at',startTime).lte('created_at',endTime);
  }else{
   // Campos de versão antiga também estão presentes no schema Shopee do Concilia.
   query=db().from('shopee_orders').select('shop_id,order_sn,order_status,create_time,order_created_at,buyer_total,gross_amount,escrow_amount,escrow_after_adjustment,net_amount,release_evidence,last_checked_at').eq('shop_id',store).or('and(create_time.gte.'+startTime+',create_time.lte.'+endTime+'),and(create_time.is.null,order_created_at.gte.'+startTime+',order_created_at.lte.'+endTime+')').order('create_time',{ascending:false,nullsFirst:false}).order('order_sn',{ascending:false}).range(offset,offset+limit-1);
   countQuery=db().from('shopee_orders').select('id',{count:'exact',head:true}).eq('shop_id',store).or('and(create_time.gte.'+startTime+',create_time.lte.'+endTime+'),and(create_time.is.null,order_created_at.gte.'+startTime+',order_created_at.lte.'+endTime+')');
  }
  const [orders,{count,error}]=await Promise.all([checked(query),countQuery]);
  if(error)throw Error(error.message);
  let rows=(orders||[]).map(platform==='meli'?auditMeli:auditShopee);
  if(platform==='shopee'&&rows.length){
   const ids=rows.map(x=>x.id);
   const releases=await checked(db().from('shopee_releases').select('order_sn,released_amount,released_at,source').eq('shop_id',store).in('order_sn',ids));
   const index=new Map(releases.map(x=>[x.order_sn,x]));
   rows=rows.map(x=>{
    const p=index.get(x.id);if(!p)return x;
    const platformReleased=Number(p.released_amount);
    const difference=x.expected===null?null:Math.round((x.expected-platformReleased)*100)/100;
    return {...x,platformReleased,difference,releaseStatus:'credito_carteira',releaseDate:p.released_at,
     classification:difference===null?'pendente':Math.abs(difference)>0.05?'divergencia':'conferido_plataforma',
     evidence:'Shopee get_escrow_list: crédito na carteira; não comprova depósito bancário',
     causes:difference===null?['Crédito na carteira confirmado; falta calcular o valor esperado.']:
      Math.abs(difference)>0.05?['Diferença entre escrow esperado e crédito na carteira: conferir tarifas, ajustes, devoluções ou estornos.']:
      ['Crédito na carteira coincide com o esperado; transferência bancária não conciliada.']
    };
   });
  }
  return Response.json({platform,store,start,end,total:count??0,offset,nextOffset:offset+rows.length,complete:offset+rows.length>=(count??0),rows,limitations:'Esta consulta audita apenas os pedidos armazenados no Concilia. Liberação na plataforma não comprova transferência bancária. Ausência de evidência não é prova de ausência de pagamento.'});
 }catch(e){return Response.json({error:e.message||'Erro na auditoria'},{status:500})}
}
