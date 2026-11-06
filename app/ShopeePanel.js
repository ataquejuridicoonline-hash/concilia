'use client';
import {useEffect,useState} from 'react';
import {compareShopeeAmounts} from '../lib/shopeeComparison.js';
import {todayUTC,daysAgoUTC,historyWindows} from '../lib/historyDates.js';
const money=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function ShopeePanel({token}){
 const [view,setView]=useState('sales'),[differenceFilter,setDifferenceFilter]=useState('all');
 const [nextOffset,setNextOffset]=useState(0),[releaseSummary,setReleaseSummary]=useState(null),[rangeStart,setRangeStart]=useState(daysAgoUTC(7)),[rangeEnd,setRangeEnd]=useState(todayUTC()),[selectedShop,setSelectedShop]=useState(''),[status,setStatus]=useState(null),[orders,setOrders]=useState([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[progress,setProgress]=useState(''),[busy,setBusy]=useState(false);
 const visibleOrders=orders.filter(o=>differenceFilter==='all'||compareShopeeAmounts(o).status===differenceFilter);
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
  try{const data=await call('orders','GET',undefined,id,{start,end,offset});setOrders(old=>offset?[...old,...(data.orders||[])]:data.orders||[]);setNextOffset(data.nextOffset||0);setTotal(data.total||0);setView('sales');if(!offset)setDifferenceFilter('all');setError('');return data}catch(e){setError(e.message);throw e}
 }
 async function loadCredits(offset=0){
  const data=await call('credits','GET',undefined,selectedShop,{start:rangeStart,end:rangeEnd,offset});
  setOrders(old=>offset?[...old,...data.credits]:data.credits);setTotal(data.total);setNextOffset(data.nextOffset);setView('credits');if(!offset)setDifferenceFilter('all');return data;
 }
 async function filterDifferences(value){
  setDifferenceFilter(value);
  if(value==='all'||nextOffset>=total)return;
  setBusy(true);setError('');
  try{
   let offset=nextOffset;
   while(offset<total){
    const data=await (view==='credits'?loadCredits(offset):loadShop(selectedShop,rangeStart,rangeEnd,offset));
    if(data.nextOffset<=offset)throw Error('Não foi possível carregar o período completo para filtrar.');
    offset=data.nextOffset;
   }
  }catch(e){setDifferenceFilter('all');setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{if(token)load()},[token]);
 useEffect(()=>{
  const result=new URLSearchParams(window.location.search).get('shopee');
  if(!result)return;
  if(result==='conectado'){setProgress('Autorização Shopee concluída. Selecione a loja para importar pedidos.');load()}
  else {const meanings={autorizacao_incompleta:'A Shopee não retornou todos os dados da autorização. Inicie uma nova conexão.',autorizacao_expirada:'A autorização expirou ou foi iniciada em outra sessão. Tente conectar novamente.',token_invalido:'A Shopee não retornou tokens válidos. Confirme as credenciais de produção.',loja_divergente:'O identificador da loja não corresponde à autorização.',falha_autorizacao:'Falha ao salvar a autorização. Consulte os logs da função Shopee na Vercel.'};setError(meanings[result]||'Não foi possível concluir a autorização Shopee.')}
  const url=new URL(window.location.href);url.searchParams.delete('shopee');window.history.replaceState({},'',url.pathname+url.search+url.hash);
 },[token]);
 useEffect(()=>{if(token&&selectedShop)loadShop(selectedShop).catch(()=>{})},[selectedShop]);
 async function run(which,range=null){
  setBusy(true);setError('');
  try{
   if(which==='start'){const data=await call('start','POST');window.location.assign(data.url);return}
   if(which==='sync'){
    const start=range?.start||daysAgoUTC(7),end=range?.end||todayUTC();
    const windows=historyWindows(start,end),syncUntil=Math.floor(Date.now()/1000);
    setRangeStart(start);setRangeEnd(end);
    let count=0,stored=0;
    for(const [index,w] of windows.entries()){
     let cursor='',pages=0,more=true;
     while(more&&pages<100){
      const data=await call('sync','POST',{timeFrom:w.timeFrom,timeTo:Math.min(w.timeTo,syncUntil),cursor,shop_id:selectedShop});
      pages++;count+=data.queried;stored+=data.stored;
      if(data.more&&(!data.cursor||data.cursor===cursor))throw Error('A paginação Shopee não avançou na janela '+(index+1));
      cursor=data.cursor;more=data.more;
      setProgress('Shopee: janela '+(index+1)+'/'+windows.length+' • '+count+' consultados • '+stored+' gravados e confirmados');
      if(pages%5===0)await loadShop(selectedShop,start,end);
     }
     if(more)throw Error('Importação parcial: janela '+(index+1)+' atingiu o limite de 100 páginas. Escolha um intervalo menor.');
    }
    const report=await loadShop(selectedShop,start,end);
    setReleaseSummary(null);
    setProgress('Importação concluída: '+count+' consultados • '+stored+' gravados e confirmados (inclui atualizações) • '+report.total+' pedidos distintos no período.');
    return;
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
    await loadShop(selectedShop);
   }
   if(which==='finance'||which==='releases'){
    let offset=0,complete=false,ok=0,unavailable=0;
    do{
     const data=await call('finance','POST',{offset,shop_id:selectedShop,dateStart:rangeStart,dateEnd:rangeEnd});
     if(!data.complete&&data.offset<=offset)throw Error('Consulta financeira não avançou');
     offset=data.offset;ok+=data.ok;unavailable+=data.unavailable;complete=data.complete;
     await loadShop(selectedShop);
     setProgress('Shopee: '+offset+' pedidos financeiros verificados • '+ok+' com valor esperado • '+unavailable+' pendências');
    }while(!complete&&offset<10000);
    if(!complete)setError('Consulta limitada aos primeiros 10.000 pedidos.');
   }
   await load();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="card" style={{marginTop:20}}>
  <div className="sectiontitle"><div><h2>Shopee — Conciliação</h2><small>Integração em preparação para aprovação Go-Live</small></div><span className="tag">{status?.connected?'LOJA CONECTADA':status?.configured?'PRONTA PARA AUTORIZAR':'AGUARDANDO CREDENCIAIS'}</span></div>
  <div className="store-switch" style={{marginBottom:14}}><label htmlFor="shopee-shop">Loja Shopee</label><select id="shopee-shop" disabled={busy} value={selectedShop} onChange={e=>{setOrders([]);setTotal(0);setNextOffset(0);setProgress('');setError('');setReleaseSummary(null);setView('sales');setSelectedShop(e.target.value)}}><option value="">Selecione uma loja</option>{(status?.shops||[]).map(x=><option key={x.shop_id} value={String(x.shop_id)}>Loja {x.shop_id}</option>)}</select><small>{(status?.shops||[]).length} loja(s) conectada(s)</small></div><div className="actions" style={{justifyContent:'flex-start',marginBottom:16,flexWrap:'wrap'}}>
   <button disabled={busy||!status?.configured||!status?.migrationReady} onClick={()=>run('start')}>+ Adicionar loja Shopee</button>
   <button className="secondary" disabled={busy||!selectedShop} onClick={()=>run('sync')}>Importar 7 dias</button>
   <button className="secondary" disabled={busy||!selectedShop} onClick={()=>run('finance')}>Conferir valores do período</button>
   <small>{selectedShop?'Loja selecionada: '+selectedShop:''}</small>
  </div>
  <div className="history-range"><strong>Importação retroativa — Shopee</strong><div className="history-inputs"><label>Data inicial<input type="date" value={rangeStart} max={todayUTC()} disabled={busy} onChange={e=>{setRangeStart(e.target.value);setReleaseSummary(null)}}/></label><label>Data final<input type="date" value={rangeEnd} max={todayUTC()} disabled={busy} onChange={e=>{setRangeEnd(e.target.value);setReleaseSummary(null)}}/></label><button disabled={busy||!selectedShop} onClick={()=>run('sync',{start:rangeStart,end:rangeEnd})}>Importar período selecionado</button><button className="secondary" disabled={busy||!selectedShop} onClick={()=>loadShop(selectedShop).catch(()=>{})}>Ver relatório do período</button><button disabled={busy||!selectedShop||!status?.releasesReady} onClick={()=>run('releases')}>Consultar liberações e valores</button><button className="secondary" disabled={busy||!selectedShop||!status?.releasesReady} onClick={()=>loadCredits().catch(e=>setError(e.message))}>Ver por data de recebimento</button></div><small>Pesquisa por data de criação, dividida em janelas de até 7 dias (UTC). Histórico disponível depende dos limites da API Shopee. O botão Conferir valores consulta pedidos criados no período. Consultar liberações usa a data em que a Shopee creditou o dinheiro na carteira, que pode ser posterior à venda.</small></div>
  {!status?.releasesReady&&<p className="notice">Para consultar quanto a Shopee liberou, execute o SQL <strong>supabase/shopee_releases.sql</strong> no Supabase. Não altera Mercado Livre nem pedidos antigos.</p>}
  {releaseSummary&&<p className="notice">Créditos na carteira Shopee de {releaseSummary.start} até {releaseSummary.end}: <strong>{releaseSummary.count} registros, total {money(releaseSummary.total)}</strong>, em {releaseSummary.windows} janelas. Isto não comprova transferência bancária e pode incluir pedidos vendidos em outros meses.</p>}
  {!status?.migrationReady&&<p className="notice">Falta executar o SQL de preparação do Supabase: supabase/shopee.sql.</p>}
  {progress&&<p className="notice" role="status">{progress}</p>}
  {error&&<p className="error">{error}</p>}
  <p className="notice">A diferença é o recebido na carteira menos o valor após ajustes. Valores negativos indicam recebimento menor; positivos, maior. Só comparamos quando os dois valores estão disponíveis. Créditos podem ocorrer após o mês da venda.</p>
  <div className="sectiontitle"><div><h3>Comparação por pedido</h3><small>{view==='credits'?'Período pela data do recebimento na carteira':'Período pela data da venda'} • {total} registros</small></div><span className="tag">Após ajustes → Recebido → Diferença</span></div>

  <div className="store-switch" style={{marginBottom:14}}><label htmlFor="shopee-difference">Diferença</label><select id="shopee-difference" value={differenceFilter} disabled={busy} onChange={e=>filterDifferences(e.target.value)}><option value="all">Todos</option><option value="divergente">Com diferença</option><option value="confere">Sem diferença</option><option value="pendente">Sem dados para comparar</option></select><small>{busy&&differenceFilter!=='all'?'Carregando o período completo para filtrar…':visibleOrders.length+' exibidos de '+orders.length+' carregados'}{differenceFilter!=='all'?' • tolerância de R$ 0,05':''}</small></div>
  <div className="scroll"><table><thead><tr><th>Pedido Shopee</th><th>Status</th><th>Compra do cliente</th><th>Previsto pela Shopee</th><th>Após ajustes</th><th>Recebido na carteira</th><th>Diferença</th><th>Conferência</th></tr></thead><tbody>
   {visibleOrders.length?visibleOrders.map(o=>{const comparison=compareShopeeAmounts(o);return <tr key={o.order_sn}><td>{o.order_sn}</td><td>{o.order_status||'—'}</td><td>{money(o.buyer_total)}</td><td>{money(o.escrow_amount)}</td><td><strong>{money(o.escrow_after_adjustment)}</strong></td><td><strong>{money(o.released_amount)}</strong><br/><small>{o.released_at?'Recebido '+new Date(o.released_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'Recebimento não localizado'}</small></td><td style={{color:comparison.status==='divergente'?'#b42318':comparison.status==='confere'?'#16794b':undefined}}><strong>{money(comparison.difference)}</strong></td><td>{comparison.label}</td></tr>}):<tr><td colSpan="8">{differenceFilter!=='all'?'Nenhum pedido corresponde ao filtro selecionado.':view==='credits'?'Nenhum recebimento armazenado no período.':'Nenhum pedido Shopee importado no período.'}</td></tr>}

  </tbody></table></div>
  {nextOffset<total&&<button className="secondary" disabled={busy} onClick={()=>(view==='credits'?loadCredits(nextOffset):loadShop(selectedShop,rangeStart,rangeEnd,nextOffset)).catch(e=>setError(e.message))}>Carregar mais 100 registros ({orders.length} de {total})</button>}
 </section>
}
