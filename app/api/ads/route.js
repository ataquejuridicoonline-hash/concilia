import {admin,validConnection} from '../../../lib/server.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const metrics='clicks,prints,ctr,cost,cpc,acos,roas,direct_amount,indirect_amount,total_amount,units_quantity';
function numeric(x){return x!==null&&x!==undefined&&Number.isFinite(Number(x))?Number(x):null}
async function adsGet(path,token,version='2'){
 const r=await fetch('https://api.mercadolibre.com'+path,{headers:{Authorization:'Bearer '+token,'api-version':version,'Accept':'application/json'},cache:'no-store'});
 const value=await r.json().catch(()=>({}));
 if(!r.ok){const err=new Error(value.message||value.error||('Mercado Ads HTTP '+r.status));err.status=r.status;throw err}
 return value;
}
export async function GET(req){
 if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 try{
  const q=new URL(req.url).searchParams,seller=q.get('seller_id'),days=Number(q.get('days')||7);
  if(!/^[0-9]+$/.test(seller||''))return Response.json({error:'Selecione uma conta Mercado Livre'},{status:400});
  if(![7,14,30].includes(days))return Response.json({error:'Período inválido'},{status:400});
  const c=await validConnection(seller);
  let ads;
  try{ads=await adsGet('/advertising/advertisers?product_id=PADS',c.accessToken,'1')}
  catch(e){
   if(e.status===401||e.status===403||e.status===404)return Response.json({available:false,permissionRequired:true,reason:'A conta ou o aplicativo não possui acesso à API Product Ads. Confira a permissão Publicidade e autorize novamente a conta.',campaigns:[]});
   throw e;
  }
  const advertisers=Array.isArray(ads.advertisers)?ads.advertisers:[];
  const mlb=advertisers.filter(x=>x.site_id==='MLB'&&/^[0-9]+$/.test(String(x.advertiser_id)));
  if(!mlb.length)return Response.json({available:false,permissionRequired:false,reason:'Nenhum anunciante Product Ads brasileiro acessível nesta conta.',campaigns:[]});
  const to=new Date(),from=new Date(to.getTime()-(days-1)*86400000),fmt=x=>x.toISOString().slice(0,10);
  const campaigns=[];let truncated=false;
  for(const adv of mlb.slice(0,5)){
   let offset=0;
   while(offset<500){
    const query=new URLSearchParams({limit:'50',offset:String(offset),date_from:fmt(from),date_to:fmt(to),metrics});
    const path='/advertising/'+encodeURIComponent(adv.site_id)+'/advertisers/'+encodeURIComponent(String(adv.advertiser_id))+'/product_ads/campaigns/search?'+query.toString();
    let data;
    try{data=await adsGet(path,c.accessToken)}
    catch(e){if([401,403,404].includes(e.status))return Response.json({available:false,permissionRequired:true,reason:'Consulta de campanhas não autorizada. Verifique as permissões de Product Ads no aplicativo Mercado Livre.',campaigns:[]});throw e}
    const results=Array.isArray(data.results)?data.results:[];
    for(const x of results){
     const m=x.metrics||{};
     campaigns.push({id:String(x.id),name:String(x.name||'Campanha sem nome'),status:String(x.status||'—'),advertiser_id:String(adv.advertiser_id),budget:numeric(x.budget),currency:String(x.currency_id||'BRL'),cost:numeric(m.cost),sales:numeric(m.total_amount),clicks:numeric(m.clicks),impressions:numeric(m.prints),roas:numeric(m.roas),acos:numeric(m.acos),ctr:numeric(m.ctr)});
    }
    offset+=results.length;
    const total=Number(data.paging?.total??results.length);
    if(results.length===0||results.length<50||offset>=total)break;
   }
   if(offset>=500)truncated=true;
  }
  if(mlb.length>5)truncated=true;
  // Métricas sem dados permanecem nulas, nunca são apresentadas como zero.
  const sum=key=>campaigns.every(x=>x[key]!==null)?campaigns.reduce((n,x)=>n+x[key],0):null;
  const cost=sum('cost'),sales=sum('sales'),clicks=sum('clicks'),impressions=sum('impressions');
  return Response.json({available:true,permissionRequired:false,days,from:fmt(from),to:fmt(to),campaigns,summary:{cost,sales,clicks,impressions,roas:cost!==null&&sales!==null&&cost>0?sales/cost:null,acos:sales!==null&&cost!==null&&sales>0?100*cost/sales:null},truncated});
 }catch(e){return Response.json({error:e.message||'Erro ao consultar Mercado Ads'},{status:e.status===429?429:500})}
}
