'use client';
import {useEffect,useState} from 'react';
import {todayUTC,daysAgoUTC,historyWindows} from '../lib/historyDates.js';
const money=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function ShopeePanel({token}){
 const [nextOffset,setNextOffset]=useState(0),[releaseSummary,setReleaseSummary]=useState(null),[rangeStart,setRangeStart]=useState(daysAgoUTC(7)),[rangeEnd,setRangeEnd]=useState(todayUTC()),[selectedShop,setSelectedShop]=useState(''),[status,setStatus]=useState(null),[orders,setOrders]=useState([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[progress,setProgress]=useState(''),[busy,setBusy]=useState(false);
 async function call(action,method='GET',body,shopParam,dates){
  const response=await fetch('/api/shopee/'+action+(shopParam?'?shop_id='+encodeURIComponent(shopParam):'')+(dates?'&dateStart='+encodeURIComponent(dates.start)+'&dateEnd='+encodeURIComponent(dates.end)+'&offset='+encodeURIComponent(dates.offset||0):''),{method,credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Erro ao consultar Shopee');return data;
 }
 async function load(){
  try{
   const st=await call('status');setStatus(st);
   const shops=st.shops||[];
   const chosen=shops.some(x=>String(x.shop_id)===String(selectedShop))?String(selectedShop):String(shops[0]?.shop_id||'');
   if(chosen!==selectedShop)setSelectedShop(chosen);
   if(chosen&&st.migrationReady)await loadShop(chosen);
   else {setOrders([]);setTotal(0)}
  }catch(e){setError(e.message)}
 }
 async function loadShop(id,start=rangeStart,end=rangeEnd,offset=0){
  if(!id){setOrders([]);setTotal(0);return}
  try{const data=await call('orders','GET',undefined,id,{start,end,offset});setOrders(old=>offset?[...old,...(data.orders||[])]:data.orders||[]);setNextOffset(data.nextOffset||0);setTotal(data.total||0);setError('')}catch(e){setError(e.message)}
 }
 useEffect(()=>{if(token)load()},[token]);
 useEffect(()=>{
  const result=new URLSearchParams(window.location.search).get('shopee');
  if(!result)return;
  if(result==='conectado'){setProgress('Autorização Shopee concluída. Selecione a loja para importar pedidos.');load()}
  else {const meanings={autorizacao_incompleta:'A Shopee não retornou todos os dados da autorização. Inicie uma nova conexão.',autorizacao_expirada:'A autorização expirou ou foi iniciada em outra sessão. Tente conectar novamente.',token_invalido:'A Shopee não retornou tokens válidos. Confirme as credenciais de produção.',loja_divergente:'O identificador da loja não corresponde à autorização.',falha_autorizacao:'Falha ao salvar a autorização. Consulte os logs da função Shopee na Vercel.'};setError(meanings[result]||'Não foi possível concluir a autorização Shopee.')}
  const url=new URL(window.location.href);url.searchParams.delete('shopee');window.history.replaceState({},'',url.pathname+url.search+url.hash);
 },[token]);
 useEffect(()=>{if(token&&selectedShop)loadShop(selectedShop)},[selectedShop]);
 async function run(which,range=null){
  setBusy(true);setError('');
  try{
   if(which==='start'){const data=await call('start','POST');window.location.assign(data.url);return}
   if(which==='sync'){
    const windows=historyWindows(range?.start||daysAgoUTC(7),range?.end||todayUTC());
    let count=0;
    for(const [index,w] of windows.entries()){
     let cursor='',pages=0,more=true;
     while(more&&pages<100){
      const data=await call('sync','POST',{timeFrom:w.timeFrom,timeTo:Math.min(w.timeTo,Math.floor(Date.now()/1000)),cursor,shop_id:selectedShop});
      pages++;count+=data.processed;
      if(data.more&&(!data.cursor||data.cursor===cursor))throw Error('A paginação Shopee não avançou na janela '+(index+1));
      cursor=data.cursor;more=data.more;
      setProgress('Shopee: janela '+(index+1)+'/'+windows.length+' • '+count+' pedidos consultados');
      if(pages%5===0)await loadShop(selectedShop,range?.start||rangeStart,range?.end||rangeEnd);
     }
     if(more)throw Error('Importação parcial: janela '+(index+1)+' atingiu o limite de 100 páginas. Escolha um intervalo menor.');
    }
    await loadShop(selectedShop,range?.start||rangeStart,range?.end||rangeEnd);
    setReleaseSummary(null);
    setProgress('Importação concluída: '+count+' registros consultados; confira a quantidade de pedidos distintos na tabela.');
   }
   if(which==='releases'){
    if(!status?.releasesReady)throw Error('Execute antes o SQL supabase/shopee_releases.sql no seu Supabase.');
    const windows=historyWindows(rangeStart,rangeEnd);
    let credited=0,amountPages=0,totalReleased=0;
    for(const [i,w] of windows.entries()){
     let page=1,more=true;
     while(more&&page<=100){
      const result=await call('releases','POST',{shop_id:selectedShop,timeFrom:w.timeFrom,timeTo:Math.min(w.timeTo,Math.floor(Date.now()/1000)),page});
      credited+=result.processed;totalReleased+=Number(result.totalReleased||0);amountPages++;
      more=result.more;page++;
      setProgress('Liberações Shopee: janela '+(i+1)+'/'+windows.length+' • '+credited+' créditos na carteira consultados');
      if(more&&page>100)throw Error('Limite de 100 páginas atingido. Divida o período em intervalos menores.');
     }
    }
    setReleaseSummary({count:credited,total:Math.round(totalReleased*100)/100,windows:windows.length,pages:amountPages,start:rangeStart,end:rangeEnd});
    await loadShop(selectedShop);setBusy(false);return;
   }
   if(which==='finance'){
    let offset=0,complete=false,ok=0,unavailable=0;
    do{
     const data=await call('finance','POST',{offset,shop_id:selectedShop,dateStart:rangeStart,dateEnd:rangeEnd});
     if(!data.complete&&data.offset<=offset)throw Error('Consulta financeira não avançou');
     offset=data.offset;ok+=data.ok;unavailable+=data.unavailable;complete=data.complete;
     setProgress('Shopee: '+offset+' pedidos financeiros verificados • '+ok+' com valor esperado • '+unavailable+' pendências');
    }while(!complete&&offset<10000);
    if(!complete)setError('Consulta limitada aos primeiros 10.000 pedidos.');
   }
   await load();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="card" style={{marginTop:20}}>
  <div className="sectiontitle"><div><h2>Shopee — Conciliação</h2><small>Integração em preparação para aprovação Go-Live</small></div><span className="tag">{status?.connected?'LOJA CONECTADA':status?.configured?'PRONTA PARA AUTORIZAR':'AGUARDANDO CREDENCIAIS'}</span></div>
  <div className="store-switch" style={{marginBottom:14}}><label htmlFor="shopee-shop">Loja Shopee</label><select id="shopee-shop" disabled={busy} value={selectedShop} onChange={e=>{setOrders([]);setTotal(0);setNextOffset(0);setSelectedShop(e.target.value)}}><option value="">Selecione uma loja</option>{(status?.shops||[]).map(x=><option key={x.shop_id} value={String(x.shop_id)}>Loja {x.shop_id}</option>)}</select><small>{(status?.shops||[]).length} loja(s) conectada(s)</small></div><div className="actions" style={{justifyContent:'flex-start',marginBottom:16,flexWrap:'wrap'}}>
   <button disabled={busy||!status?.configured||!status?.migrationReady} onClick={()=>run('start')}>+ Adicionar loja Shopee</button>
   <button className="secondary" disabled={busy||!selectedShop} onClick={()=>run('sync')}>Importar 7 dias</button>
   <button className="secondary" disabled={busy||!selectedShop} onClick={()=>run('finance')}>Conferir valores do período</button>
   <small>{selectedShop?'Loja selecionada: '+selectedShop:''}</small>
  </div>
  <div className="history-range"><strong>Importação retroativa — Shopee</strong><div className="history-inputs"><label>Data inicial<input type="date" value={rangeStart} max={todayUTC()} disabled={busy} onChange={e=>setRangeStart(e.target.value)}/></label><label>Data final<input type="date" value={rangeEnd} max={todayUTC()} disabled={busy} onChange={e=>setRangeEnd(e.target.value)}/></label><button disabled={busy||!selectedShop} onClick={()=>run('sync',{start:rangeStart,end:rangeEnd})}>Importar período selecionado</button><button className="secondary" disabled={busy||!selectedShop} onClick={()=>loadShop(selectedShop)}>Ver relatório do período</button><button disabled={busy||!selectedShop||!status?.releasesReady} onClick={()=>run('releases')}>Consultar liberações na carteira</button></div><small>Pesquisa por data de criação, dividida em janelas de até 7 dias (UTC). Histórico disponível depende dos limites da API Shopee. O botão Conferir valores consulta pedidos criados no período. Consultar liberações usa a data em que a Shopee creditou o dinheiro na carteira, que pode ser posterior à venda.</small></div>
  {!status?.releasesReady&&<p className="notice">Para consultar quanto a Shopee liberou, execute o SQL <strong>supabase/shopee_releases.sql</strong> no Supabase. Não altera Mercado Livre nem pedidos antigos.</p>}
  {releaseSummary&&<p className="notice">Créditos na carteira Shopee de {releaseSummary.start} até {releaseSummary.end}: <strong>{releaseSummary.count} registros, total {money(releaseSummary.total)}</strong>, em {releaseSummary.windows} janelas. Isto não comprova transferência bancária e pode incluir pedidos vendidos em outros meses.</p>}
  {!status?.migrationReady&&<p className="notice">Falta executar o SQL de preparação do Supabase: supabase/shopee.sql.</p>}
  {progress&&<p className="notice" role="status">{progress}</p>}
  {error&&<p className="error">{error}</p>}
  <p className="notice">Pedidos encontrados no período: {total}. Os valores de escrow são previsões de recebimento e podem mudar até a finalização. Não são comprovantes de repasse ou depósito.</p>
  <div className="scroll"><table><thead><tr><th>Pedido Shopee</th><th>Status</th><th>Compra do cliente</th><th>Escrow previsto</th><th>Após ajustes</th><th>Crédito na carteira</th><th>Conferência</th></tr></thead><tbody>
   {orders.length?orders.map(o=><tr key={o.order_sn}><td>{o.order_sn}</td><td>{o.order_status||'—'}</td><td>{money(o.buyer_total)}</td><td><strong>{money(o.escrow_amount)}</strong></td><td>{money(o.escrow_after_adjustment)}</td><td>{money(o.released_amount)}<br/><small>{o.released_at?'Liberado '+new Date(o.released_at).toLocaleDateString('pt-BR'):'Sem crédito localizado'}</small></td><td>{o.financial_status==='valor_esperado'?'Previsto, não liberado':'Pendente'}</td></tr>):<tr><td colSpan="7">Nenhum pedido Shopee importado.</td></tr>}
  </tbody></table></div>
  {nextOffset<total&&<button className="secondary" disabled={busy} onClick={()=>loadShop(selectedShop,rangeStart,rangeEnd,nextOffset)}>Carregar mais 100 pedidos ({orders.length} de {total})</button>}
 </section>
}
