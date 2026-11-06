'use client';
import {useEffect,useState} from 'react';
import {daysAgoUTC,todayUTC} from '../lib/historyDates.js';
const money=x=>x===null||x===undefined?'Não comprovado':Number(x).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const labels={divergencia:'Diferença a investigar',conferido_plataforma:'Conferido na plataforma',pendente:'Pendente de evidências',revisar:'Revisar cancelamento'};
const exportValue=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
export default function AuditPanel({token,meliStores=[]}){
 const [platform,setPlatform]=useState('shopee'),[shopeeStores,setShopeeStores]=useState([]),[store,setStore]=useState(''),[start,setStart]=useState('2026-10-01'),[end,setEnd]=useState('2026-10-31');
 const [data,setData]=useState(null),[rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[onlyProblems,setOnlyProblems]=useState(false);
 useEffect(()=>{
  if(!token)return;
  fetch('/api/shopee/status',{headers:{Authorization:'Bearer '+token},cache:'no-store'}).then(r=>r.json()).then(x=>setShopeeStores(x.shops||[])).catch(()=>setShopeeStores([]));
 },[token]);
 const stores=platform==='meli'?meliStores.map(x=>({id:String(x.seller_id),label:'Vendedor '+x.seller_id})):shopeeStores.map(x=>({id:String(x.shop_id),label:'Loja '+x.shop_id}));
 useEffect(()=>{setStore(v=>stores.some(s=>s.id===v)?v:(stores[0]?.id||''));setData(null);setRows([])},[platform,meliStores,shopeeStores]);
 useEffect(()=>{setData(null);setRows([])},[store,start,end]);
 async function consult(offset=0,append=false){
  if(!store||busy)return;
  setBusy(true);setError('');
  try{
   const q=new URLSearchParams({platform,store,start,end,offset:String(offset)});
   const r=await fetch('/api/auditoria?'+q,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||'Falha na auditoria');
   setData(result);setRows(old=>append?[...old,...result.rows]:result.rows);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const matched=rows.filter(r=>['divergencia','revisar'].includes(r.classification));
 const pending=rows.filter(r=>r.classification==='pendente');
 const totalDifference=matched.filter(r=>r.difference!==null).reduce((v,r)=>v+Math.abs(r.difference),0);
 const visible=onlyProblems?rows.filter(r=>r.classification!=='conferido_plataforma'):rows;
 function csv(){
  const fields=['Marketplace','Conta','Pedido','Data','Valor bruto','Tarifas','Frete','Líquido esperado','Referência de pagamento','Valor liberado na plataforma','Diferença esperado - liberado','Status','Liberação informada','Data da liberação','Comprovante bancário','Possíveis causas','Evidência','Última consulta'];
  const lines=[fields.map(exportValue).join(';')];
  for(const x of visible)lines.push([platform==='meli'?'Mercado Livre':'Shopee',x.store,x.id,x.date,x.gross,x.fees,x.freight,x.expected,x.paymentReference,x.platformReleased,x.difference,labels[x.classification]||x.classification,x.releaseStatus,x.releaseDate,x.depositConfirmed?'Sim':'Não',x.causes.join(' | '),x.evidence,x.checkedAt].map(exportValue).join(';'));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='auditoria_'+platform+'_'+store+'_'+start+'_'+end+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }
 return <div className="audit-page">
  <section className="card">
   <div className="sectiontitle"><div><h2>Auditoria financeira retroativa</h2><small>Conciliação individual por pedido, loja e período</small></div><span className="tag">SOMENTE LEITURA</span></div>
   <div className="audit-controls">
    <label>Plataforma<select value={platform} onChange={e=>setPlatform(e.target.value)} disabled={busy}><option value="meli">Mercado Livre</option><option value="shopee">Shopee</option></select></label>
    <label>Conta ou loja<select value={store} onChange={e=>setStore(e.target.value)} disabled={busy}><option value="">Selecione</option>{stores.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <label>De<input type="date" value={start} max={todayUTC()} onChange={e=>setStart(e.target.value)} disabled={busy}/></label>
    <label>Até<input type="date" value={end} max={todayUTC()} onChange={e=>setEnd(e.target.value)} disabled={busy}/></label>
   </div>
   <div className="actions audit-actions"><button onClick={()=>consult(0,false)} disabled={busy||!store}>{busy?'Consultando…':'Gerar relatório'}</button><button className="secondary" disabled={!rows.length||busy} onClick={csv}>Exportar CSV / Excel</button><label className="audit-checkbox"><input type="checkbox" checked={onlyProblems} onChange={e=>setOnlyProblems(e.target.checked)}/> Ocultar pedidos sem diferença relevante</label></div>
   {!stores.length&&<p className="notice">Nenhuma conta conectada nesta plataforma.</p>}
   {error&&<p className="error" role="alert">{error}</p>}
  </section>
  {data&&<><div className="cards audit-metrics">
   <article className="card"><label>Pedidos no período (armazenados)</label><strong>{data.total}</strong></article>
   <article className="card"><label>Divergências sinalizadas na amostra</label><strong>{matched.length}</strong></article>
   <article className="card"><label>Pendentes na amostra</label><strong>{pending.length}</strong></article>
   <article className="card"><label>Soma absoluta das diferenças exibidas*</label><strong>{money(totalDifference)}</strong></article>
  </div>
  <section className="card">
   <div className="sectiontitle"><div><h2>Conferência pedido a pedido</h2><small>{rows.length} pedidos carregados de {data.total} armazenados no período</small></div></div>
   <div className="scroll"><table><thead><tr><th>Pedido / Data</th><th>Esperado</th><th>Pagamento consultado</th><th>Liberado (plataforma)</th><th>Depósito bancário</th><th>Diferença</th><th>Classificação</th><th>Possíveis causas e evidências</th></tr></thead><tbody>
    {visible.length?visible.map(r=><tr key={r.store+'-'+r.id}><td><strong>{r.id}</strong><br/><small>{r.date?new Date(r.date).toLocaleDateString('pt-BR'):'Data indisponível'}</small></td><td>{r.expected===null?'A calcular':money(r.expected)}</td><td>{r.paymentReference===null?'A consultar':money(r.paymentReference)}</td><td>{money(r.platformReleased)}<br/><small>{r.releaseDate?'Liberação: '+new Date(r.releaseDate).toLocaleDateString('pt-BR'):'Sem data comprovada'}</small></td><td>{r.depositConfirmed?money(r.depositAmount):'Não conciliado'}</td><td><strong>{r.difference===null?'Indeterminada':money(r.difference)}</strong></td><td>{labels[r.classification]||r.classification}</td><td>{r.causes.map((c,i)=><div key={i}>{c}</div>)}<small>Fonte: {r.evidence}</small></td></tr>):<tr><td colSpan="8">Nenhum pedido corresponde ao filtro.</td></tr>}
   </tbody></table></div>
   {data&&!data.complete&&<button className="secondary" disabled={busy} onClick={()=>consult(data.nextOffset,true)}>{busy?'Carregando…':'Carregar próximos 100 pedidos'}</button>}
   <p className="notice">* O valor de diferenças soma somente pedidos carregados nesta tela e com evidência de liberação na plataforma. Não é valor de prejuízo confirmado. A liberação no Mercado Pago não comprova transferência bancária; na Shopee, escrow não é liberação. O CSV exporta apenas os pedidos carregados e visíveis.</p>
  </section></>}
 </div>
}
