'use client';
import {useState} from 'react';

const GROUPS=[
 {id:'seller',title:'Pendentes do vendedor',subtitle:'Sua ação é necessária',color:'#d84b2c'},
 {id:'buyer',title:'Pendentes do comprador',subtitle:'Aguardando o cliente',color:'#396caa'},
 {id:'meli',title:'Aguardando Mercado Livre',subtitle:'Análise ou decisão da plataforma',color:'#6e629e'},
 {id:'unknown',title:'A verificar',subtitle:'Responsável não confirmado pela API',color:'#777'}
];
const formatDate=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.valueOf())?'—':d.toLocaleString('pt-BR')};
export default function ClaimsPanel({token,stores=[]}){
 const [seller,setSeller]=useState(''),[view,setView]=useState('seller'),[status,setStatus]=useState('opened');
 const [list,setList]=useState(null),[detail,setDetail]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const selected=seller||String(stores[0]?.seller_id||'');
 async function request(params){
  const response=await fetch('/api/mercadolivre/claims?'+new URLSearchParams({seller_id:selected,...params}),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Falha de autenticação ou consulta');
  return data;
 }
 async function load(){
  setBusy(true);setError('');setDetail(null);
  try{setList(await request({status,limit:'100',filter:'responsibility'}))}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 async function inspect(id){
  setBusy(true);setError('');
  try{setDetail(await request({claim_id:String(id)}))}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 const rows=(list?.claims||[]).filter(x=>view==='all'||x.responsibility===view);
 const count=id=>list?.counts?.[id]??'—';
 const actions=(detail?.allowed_message_recipients||[]).join(', ')||'nenhum envio autorizado agora';
 return <section className="card" style={{marginTop:16}}>
  <h2>Central de reclamações • Mercado Livre</h2>
  <p>Divisão pelo responsável da próxima ação, consultada diretamente no Mercado Livre. Apenas leitura, sem envios automáticos.</p>
  <div className="actions" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',margin:'16px 0'}}>
    <label>Conta Mercado Livre <select value={selected} onChange={e=>{setSeller(e.target.value);setList(null);setDetail(null)}}>{stores.map(x=><option key={x.seller_id} value={String(x.seller_id)}>Vendedor {x.seller_id}</option>)}</select></label>
    <label>Situação <select value={status} onChange={e=>{setStatus(e.target.value);setList(null);setDetail(null)}}><option value="opened">Abertas</option><option value="closed">Encerradas</option></select></label>
    <button type="button" disabled={busy||!selected||!token} onClick={load}>{busy?'Consultando os responsáveis...':'Atualizar reclamações'}</button>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,margin:'16px 0'}}>
   {GROUPS.map(g=><button key={g.id} type="button" onClick={()=>{setView(g.id);setDetail(null)}} aria-pressed={view===g.id} style={{textAlign:'left',border:'1px solid '+(view===g.id?g.color:'#dbe1e9'),borderLeft:'4px solid '+g.color,background:view===g.id?'#f7f9fc':'#fff',borderRadius:10,padding:16,color:'#1e293b',minHeight:118,boxShadow:view===g.id?'0 3px 9px #00000012':'none'}}>
      <span style={{display:'block',fontWeight:700,fontSize:14}}>{g.title}</span>
      <strong style={{fontSize:30,display:'block',margin:'7px 0 1px',color:g.color}}>{count(g.id)}</strong>
      <small style={{fontSize:12,color:'#64748b'}}>{g.subtitle}</small>
    </button>)}
  </div>
  <div style={{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}>
    <button type="button" className={view==='all'?'':'secondary'} onClick={()=>setView('all')}>Todas as abertas ({list?.scanned??'—'})</button>
    <small style={{color:'#64748b'}}>Contadores desta consulta; podem diferir dos totais do painel oficial.</small>
  </div>
  {error&&<p role="alert" className="error">{error}</p>}
  {list&&<><p className="notice">Consulta: {formatDate(list.checked_at)} • {list.scanned} reclamações examinadas • fonte: {list.source}. A separação usa o campo action_responsible de cada reclamação.</p>
   <div className="scroll"><table><thead><tr><th>Reclamação</th><th>Pedido / Recurso</th><th>Etapa</th><th>Responsável</th><th>Prazo</th><th>Análise</th></tr></thead>
   <tbody>{rows.map(c=><tr key={c.id}>
    <td>{String(c.id)}</td><td>{String(c.resource_id||'—')}</td><td>{c.stage||'—'}</td>
    <td>{GROUPS.find(g=>g.id===c.responsibility)?.title||'A verificar'}</td>
    <td>{formatDate(c.due_date)}</td>
    <td><button className="secondary" type="button" disabled={busy} onClick={()=>inspect(c.id)}>Analisar</button></td>
   </tr>)}
   {!rows.length&&<tr><td colSpan="6">Nenhuma reclamação classificada nesta categoria na página consultada. Confira também os casos em “A verificar”.</td></tr>}</tbody></table></div>
  <p className="notice">A responsabilidade foi identificada no detalhe da reclamação. A contagem cobre somente os resultados consultados; para casos adicionais ou impossibilidade de consultar o responsável, confira a central oficial do Mercado Livre.</p>
  </>}
  {detail&&<div className="card" style={{marginTop:16,padding:16}}>
   <h3>Reclamação {detail.claim?.id}</h3>
   <p>Classificação preliminar: <strong>{detail.analysis?.classification||'indeterminada'}</strong></p>
   <p>{detail.analysis?.note}</p>
   <p>Ações de mensagens disponíveis: {actions}</p>
   <p>Histórico de mensagens: {detail.messages?'consultado':'indisponível'}</p>
   <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:300,overflow:'auto'}}>{JSON.stringify({claim:detail.claim,messages:detail.messages,reason:detail.reason,actions_history:detail.actions_history},null,2)}</pre>
  </div>}
 </section>;
}
