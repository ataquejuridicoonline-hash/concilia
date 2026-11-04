'use client';
import {useEffect,useState} from 'react';
const money=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function ShopeePanel({token}){
 const [status,setStatus]=useState(null),[orders,setOrders]=useState([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[progress,setProgress]=useState(''),[busy,setBusy]=useState(false);
 async function call(action,method='GET',body){
  const response=await fetch('/api/shopee/'+action,{method,credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Erro ao consultar Shopee');return data;
 }
 async function load(){
  try{
   const s=await call('status');setStatus(s);
   if(s.migrationReady){const data=await call('orders');setOrders(data.orders||[]);setTotal(data.total||0)}
   setError('');
  }catch(e){setError(e.message)}
 }
 useEffect(()=>{if(token)load()},[token]);
 async function run(which){
  setBusy(true);setError('');
  try{
   if(which==='start'){const data=await call('start','POST');window.location.assign(data.url);return}
   if(which==='sync'){
    const timeTo=Math.floor(Date.now()/1000),timeFrom=timeTo-7*86400;
    let cursor='',pages=0,count=0,more=true;
    while(more&&pages<100){
     const data=await call('sync','POST',{timeFrom,timeTo,cursor});
     pages++;count+=data.processed;
     if(data.more&&(!data.cursor||data.cursor===cursor))throw Error('A paginação Shopee não avançou');
     cursor=data.cursor;more=data.more;
     setProgress('Shopee: '+count+' pedidos consultados');
    }
    if(more)setError('Consulta interrompida após 100 páginas; precisa de período menor.');
   }
   if(which==='finance'){
    let offset=0,complete=false,ok=0,unavailable=0;
    do{
     const data=await call('finance','POST',{offset});
     if(!data.complete&&data.offset<=offset)throw Error('Consulta financeira não avançou');
     offset=data.offset;ok+=data.ok;unavailable+=data.unavailable;complete=data.complete;
     setProgress('Shopee: '+offset+' pedidos financeiros verificados • '+ok+' com valor esperado • '+unavailable+' pendências');
    }while(!complete&&offset<10000);
    if(!complete)setError('Consulta limitada aos primeiros 10.000 pedidos.');
   }
   await load();setProgress('');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="card" style={{marginTop:20}}>
  <div className="sectiontitle"><div><h2>Shopee — Conciliação</h2><small>Integração em preparação para aprovação Go-Live</small></div><span className="tag">{status?.connected?'LOJA CONECTADA':status?.configured?'PRONTA PARA AUTORIZAR':'AGUARDANDO CREDENCIAIS'}</span></div>
  <div className="actions" style={{justifyContent:'flex-start',marginBottom:16,flexWrap:'wrap'}}>
   <button disabled={busy||!status?.configured||!status?.migrationReady} onClick={()=>run('start')}>Conectar Shopee</button>
   <button className="secondary" disabled={busy||!status?.connected} onClick={()=>run('sync')}>Importar 7 dias</button>
   <button className="secondary" disabled={busy||!status?.connected} onClick={()=>run('finance')}>Conferir valores Shopee</button>
   <small>{status?.shopId?'Loja ID: '+status.shopId:''}</small>
  </div>
  {!status?.migrationReady&&<p className="notice">Falta executar o SQL de preparação do Supabase: supabase/shopee.sql.</p>}
  {progress&&<p className="notice" role="status">{progress}</p>}
  {error&&<p className="error">{error}</p>}
  <p className="notice">Pedidos armazenados: {total}. Os valores de escrow são previsões de recebimento e podem mudar até a finalização. Não são comprovantes de repasse ou depósito.</p>
  <div className="scroll"><table><thead><tr><th>Pedido Shopee</th><th>Status</th><th>Compra do cliente</th><th>Escrow previsto</th><th>Após ajustes</th><th>Conferência</th></tr></thead><tbody>
   {orders.length?orders.map(o=><tr key={o.order_sn}><td>{o.order_sn}</td><td>{o.order_status||'—'}</td><td>{money(o.buyer_total)}</td><td><strong>{money(o.escrow_amount)}</strong></td><td>{money(o.escrow_after_adjustment)}</td><td>{o.financial_status==='valor_esperado'?'Previsto, não liberado':'Pendente'}</td></tr>):<tr><td colSpan="6">Nenhum pedido Shopee importado.</td></tr>}
  </tbody></table></div>
 </section>
}
