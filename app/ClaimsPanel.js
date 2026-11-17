'use client';
import {useState} from 'react';

export default function ClaimsPanel({token,stores=[]}){
 const [seller,setSeller]=useState(''),[status,setStatus]=useState('opened'),[list,setList]=useState(null),[detail,setDetail]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const selected=seller||String(stores[0]?.seller_id||'');
 async function request(params){
  const response=await fetch('/api/mercadolivre/claims?'+new URLSearchParams({seller_id:selected,...params}),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Falha de autenticação ou consulta');
  return result;
 }
 async function load(){setBusy(true);setError('');setDetail(null);try{setList(await request({status,limit:'50'}))}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function inspect(id){setBusy(true);setError('');try{setDetail(await request({claim_id:String(id)}))}catch(e){setError(e.message)}finally{setBusy(false)}}
 const actions=(detail?.allowed_message_recipients||[]).join(', ')||'nenhum envio autorizado agora';
 return <section className="card" style={{marginTop:16}}>
  <h2>Central de reclamações • Mercado Livre</h2>
  <p>Consulta autenticada e somente leitura. As mensagens não são enviadas automaticamente.</p>
  <div className="actions" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
   <label>Conta <select value={selected} onChange={e=>{setSeller(e.target.value);setList(null);setDetail(null)}}>{stores.map(x=><option key={x.seller_id} value={String(x.seller_id)}>Vendedor {x.seller_id}</option>)}</select></label>
   <label>Situação <select value={status} onChange={e=>setStatus(e.target.value)}><option value="opened">Abertas</option><option value="closed">Encerradas</option></select></label>
   <button type="button" disabled={busy||!selected||!token} onClick={load}>{busy?'Consultando...':'Consultar reclamações na API'}</button>
  </div>
  {error&&<p role="alert" className="error">Consulta não validada: {error}</p>}
  {list&&<><p className="notice">Consulta efetiva: {new Date(list.checked_at).toLocaleString('pt-BR')} • {list.claims?.length||0} itens nesta página • origem: {list.source}</p>
   <div className="scroll"><table><thead><tr><th>Reclamação</th><th>Pedido/Recurso</th><th>Etapa</th><th>Situação</th><th>Detalhes</th></tr></thead><tbody>
    {(list.claims||[]).map(c=><tr key={c.id}><td>{String(c.id)}</td><td>{String(c.resource_id||'—')}</td><td>{c.stage||'—'}</td><td>{c.status||'—'}</td><td><button className="secondary" onClick={()=>inspect(c.id)} disabled={busy}>Analisar</button></td></tr>)}
    {!list.claims?.length&&<tr><td colSpan="5">Nenhuma reclamação retornada nesta consulta. Isso não comprova inexistência de reclamações em outros filtros.</td></tr>}
   </tbody></table></div>
  </>}
  {detail&&<div className="card" style={{marginTop:16,padding:16}}>
   <h3>Reclamação {detail.claim?.id}</h3>
   <p>Classificação: <strong>{detail.analysis?.classification||'indeterminada'}</strong></p>
   <p>{detail.analysis?.note}</p>
   <p>Ações de mensagem disponíveis: {actions}</p>
   <p>Histórico e mensagens recebidos: {detail.messages?'sim':'não disponível'}</p>
   <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:280,overflow:'auto'}}>{JSON.stringify({claim:detail.claim,messages:detail.messages,reason:detail.reason,actions_history:detail.actions_history},null,2)}</pre>
  </div>}
 </section>;
}
