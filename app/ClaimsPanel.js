'use client';
import {useRef,useState} from 'react';

const CHAT_URL='https://chatgpt.com/g/g-p-6afc6eb9958881918cc959dd2845ba6b-reclamacoes-mercado-livre/c/6afc6a4a-d34c-83e8-90eb-a5953282aba1';
const GROUPS=[
 {id:'seller',title:'Pendentes do vendedor',subtitle:'Sua ação é necessária',color:'#d84b2c'},
 {id:'buyer',title:'Pendentes do comprador',subtitle:'Aguardando o cliente',color:'#396caa'},
 {id:'meli',title:'Aguardando Mercado Livre',subtitle:'Análise ou decisão da plataforma',color:'#6e629e'},
 {id:'unknown',title:'A verificar',subtitle:'Responsável não confirmado pela API',color:'#777'}
];
const formatDate=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.valueOf())?'—':d.toLocaleString('pt-BR')};
const textOf=v=>typeof v==='string'?v:typeof v?.text==='string'?v.text:typeof v?.message==='string'?v.message:typeof v?.message?.text==='string'?v.message.text:'';
const dataList=v=>Array.isArray(v)?v:Array.isArray(v?.messages)?v.messages:Array.isArray(v?.data)?v.data:[];
function casePrompt(d,caseRow,sellerId){
 const c=d?.claim||{},desc=d?.claim_detail||{},reason=d?.reason||{},messages=dataList(d?.messages);
 const chat=messages.slice(-18).map(m=>({
  de:m.sender_role||m.from?.role||m.sender?.role||'não identificado',
  data:m.message_date||m.date_created||m.date||null,
  texto:textOf(m).slice(0,1000),
  anexos:Array.isArray(m.attachments)?m.attachments.length:0
 }));
 const payload={
  conta_vendedora:sellerId,claim_id:c.id||caseRow?.id,order_id:d?.order?.id||caseRow?.resource_id,
  status:c.status,stage:c.stage||caseRow?.stage,
  responsavel_da_proxima_acao:desc.action_responsible||caseRow?.action_responsible||'não confirmado',
  prazo:desc.due_date||caseRow?.due_date||null,
  motivo:reason.description||reason.name||c.reason_id||caseRow?.reason_id||'não informado',
  classificacao_preliminar:d?.analysis?.classification||'não verificada',
  item:d?.order?.items||[],modalidade_envio:d?.order?.shipping||null,
  historico_mensagens:chat,
  mensagens_disponiveis:d?.allowed_message_recipients||[],
  consulta_em:d?.checked_at,
  comprovantes_de_embalagem:'Não enviados a esta conversa; solicitar ao vendedor quando necessários'
 };
 return 'JARVIS, ANALISAR RECLAMAÇÃO REAL DO MERCADO LIVRE. Seguem dados consultados via Concilia. Examine o motivo, histórico e prazo, identifique provas necessárias, possíveis argumentos para revisão da reputação, riscos e prepare resposta ao comprador e defesa ao ML. Não invente fotos, fatos ou exclusão da reputação. Não envie nada ao ML sem minha autorização individual. Se dados estiverem ausentes, indique. Dados JSON:\n'+JSON.stringify(payload,null,2);
}
export default function ClaimsPanel({token,stores=[]}){
 const [seller,setSeller]=useState(''),[view,setView]=useState('all'),[status,setStatus]=useState('all'),[loadingInfo,setLoadingInfo]=useState('');
 const [list,setList]=useState(null),[detail,setDetail]=useState(null),[caseText,setCaseText]=useState(''),[caseInfo,setCaseInfo]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [orderQuery,setOrderQuery]=useState(''),[orderResult,setOrderResult]=useState(null),[orderError,setOrderError]=useState(''),[orderBusy,setOrderBusy]=useState(false);
 const detailRef=useRef(null);
 const selected=seller||String(stores[0]?.seller_id||'');
 async function request(params){
  const response=await fetch('/api/mercadolivre/claims?'+new URLSearchParams({seller_id:selected,...params}),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Falha de autenticação ou consulta');
  return data;
 }
 async function load(){
  setBusy(true);setError('');setDetail(null);setCaseText('');setCaseInfo('');setLoadingInfo('Iniciando consulta...');
  let combined=[],scanned=0,complete=true,errors=[];
  const statuses=status==='all'?['opened','closed']:[status];
  const counts={seller:0,buyer:0,meli:0,unknown:0,closed:0};
  try{
   for(const state of statuses){
    let offset=0,pages=0,more=true;
    while(more && pages<102){
     const limit=99;
     if(offset+limit>=10000){complete=false;errors.push('Limite técnico de 9.999 registros por situação; utilize uma janela de datas para consultar volumes superiores.');break;}
     setLoadingInfo('Consultando '+(state==='opened'?'abertas':'encerradas')+' — '+offset+' registros já processados...');
     let data;
     try{data=await request({status:state,limit:String(limit),offset:String(offset),...(state==='opened'?{filter:'responsibility'}:{})});}
     catch(e){complete=false;errors.push('Erro em '+state+' na página '+(pages+1)+': '+e.message);break;}
     let items=(data.claims||[]).map(x=>state==='closed'?{...x,responsibility:'closed'}:x);
     // Reconsulta paginada com remoção de repetições eventuais entre páginas.
     const existing=new Set(combined.map(x=>String(x.id)));
     combined.push(...items.filter(x=>!existing.has(String(x.id))));
     scanned+=items.length;
     for(const item of items)counts[item.responsibility in counts?item.responsibility:'unknown']++;
     const total=Number(data.paging?.total);
     offset+=items.length;pages++;
     more=items.length===limit && (!Number.isFinite(total)||total<=0||offset<total);
     setList({claims:[...combined],counts:{...counts},scanned:combined.length,status,source:'mercadolivre_live',checked_at:data.checked_at,complete:false});
     if(!items.length)break;
     // Evita travar a interface e permite acompanhar o progresso.
     await new Promise(resolve=>setTimeout(resolve,25));
    }
   }
   setList(x=>({...x,claims:combined,counts,scanned:combined.length,status,complete,checked_at:new Date().toISOString()}));
   if(errors.length)setError('Consulta parcial: '+errors.join(' '));
  }catch(e){setError('Falha na consulta: '+e.message)}
  finally{setBusy(false);setLoadingInfo('')}
 }
 async function searchOrder(e){
  e.preventDefault();
  const number=orderQuery.trim();
  setOrderError('');setOrderResult(null);setDetail(null);setCaseText('');setCaseInfo('');
  if(!/^[0-9]{1,20}$/.test(number)){setOrderError('Digite um número de pedido válido, somente números.');return;}
  setOrderBusy(true);
  try{setOrderResult(await request({order_id:number}))}
  catch(e){setOrderError(e.message)}
  finally{setOrderBusy(false)}
 }
 async function inspect(row){
  if(busy)return;
  // Abrir imediatamente a conversa na ação do clique, evitando bloqueio de pop-ups.
  window.open(CHAT_URL,'_blank','noopener,noreferrer');
  setBusy(true);setError('');setDetail(null);setCaseText('');setCaseInfo('Buscando reclamação '+row.id+' na API...');
  try{
   const data=await request({claim_id:String(row.id)});
   const prompt=casePrompt(data,row,selected);
   setCaseText(prompt);setDetail(data);
   let copied=false;
   try{await navigator.clipboard.writeText(prompt);copied=true}catch{}
   setCaseInfo(copied
    ?'Dados da reclamação copiados. A conversa foi aberta: cole (Ctrl+V ou Cmd+V) e envie para eu analisar.'
    :'A conversa foi aberta, mas o navegador não permitiu copiar automaticamente. Clique em “Copiar análise” abaixo e cole na conversa.');
   requestAnimationFrame(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
  }catch(e){
   setError('Não foi possível carregar a reclamação '+row.id+': '+e.message);
   setCaseInfo('Não foram enviados dados ao ChatGPT. Verifique o erro abaixo.');
  }finally{setBusy(false)}
 }
 async function copy(){
  try{await navigator.clipboard.writeText(caseText);setCaseInfo('Dados copiados. Agora cole e envie na conversa do ChatGPT.')}
  catch{setCaseInfo('Selecione o conteúdo no campo abaixo e copie manualmente.')}
 }
 const rows=(list?.claims||[]).filter(x=>view==='all'||x.responsibility===view);
 const count=id=>list?.counts?.[id]??'—';
 return <section className="card" style={{marginTop:16}}>
  <h2>Central de reclamações • Mercado Livre</h2>
  <p>Clique em <strong>Analisar no ChatGPT</strong> para consultar a reclamação e abrir esta conversa. As respostas nunca são enviadas ao Mercado Livre sem sua aprovação.</p>
  <div className="actions" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',margin:'16px 0'}}>
    <label>Conta Mercado Livre <select value={selected} onChange={e=>{setSeller(e.target.value);setList(null);setDetail(null);setCaseText('')}}>{stores.map(x=><option key={x.seller_id} value={String(x.seller_id)}>Vendedor {x.seller_id}</option>)}</select></label>
    <label>Situação <select value={status} onChange={e=>{setStatus(e.target.value);setList(null);setDetail(null);setCaseText('')}}><option value="all">Todas (abertas + encerradas)</option><option value="opened">Somente abertas</option><option value="closed">Somente encerradas</option></select></label>
    <button type="button" disabled={busy||!selected||!token} onClick={load}>{busy?'Consultando...':'Atualizar reclamações'}</button>
  </div>
  <form onSubmit={searchOrder} style={{padding:16,border:'1px solid #dbe1e9',borderRadius:10,margin:'14px 0',background:'#f9fafb'}}>
   <label htmlFor="ml-order-search" style={{display:'block',fontWeight:700,marginBottom:8}}>Buscar reclamações pelo número do pedido</label>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
    <input id="ml-order-search" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Ex.: 2000019511061200" value={orderQuery} onChange={e=>setOrderQuery(e.target.value)} style={{flex:'1 1 230px',minWidth:180}} disabled={orderBusy}/>
    <button type="submit" disabled={orderBusy||!selected||!token}>{orderBusy?'Pesquisando...':'Buscar pedido'}</button>
    <button type="button" className="secondary" onClick={()=>{setOrderQuery('');setOrderResult(null);setOrderError('')}} disabled={orderBusy}>Limpar busca</button>
   </div>
   <small style={{color:'#64748b'}}>Busca diretamente na API por order_id, incluindo reclamações abertas e encerradas, sem carregar o histórico completo.</small>
   {orderError&&<p className="error" role="alert" style={{marginTop:10}}>{orderError}</p>}
   {orderResult&&<div style={{marginTop:14}}>
    <strong>Pedido #{orderResult.order_id}</strong> • {orderResult.claims?.length||0} reclamação(ões) encontrada(s) • {orderResult.order?.status||'status não disponível'}
    {orderResult.order?.items?.length>0&&<p style={{margin:'7px 0',color:'#475569'}}>{orderResult.order.items.map(x=>x.title).join(' / ')}</p>}
    <div className="scroll"><table><thead><tr><th>Reclamação</th><th>Status</th><th>Responsável</th><th>Última atualização</th><th>Análise</th></tr></thead><tbody>
     {(orderResult.claims||[]).map(c=><tr key={c.id}><td>{String(c.id)}</td><td>{c.status||'—'}</td><td>{GROUPS.find(g=>g.id===c.responsibility)?.title||(c.responsibility==='closed'?'Encerrada':'A verificar')}</td><td>{formatDate(c.last_updated)}</td><td><button type="button" className="secondary" disabled={busy} onClick={()=>inspect({...c,resource_id:orderResult.order_id})}>Analisar no ChatGPT</button></td></tr>)}
     {!orderResult.claims?.length&&<tr><td colSpan="5">Pedido localizado, sem reclamações retornadas na API.</td></tr>}
    </tbody></table></div>
   </div>}
  </form>
  {loadingInfo&&<p role="status" className="notice">{loadingInfo} • {list?.scanned||0} carregadas até agora.</p>}
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,margin:'16px 0'}}>
   {GROUPS.map(g=><button key={g.id} type="button" onClick={()=>{setView(g.id);setDetail(null);setCaseText('')}} aria-pressed={view===g.id} style={{textAlign:'left',border:'1px solid '+(view===g.id?g.color:'#dbe1e9'),borderLeft:'4px solid '+g.color,background:view===g.id?'#f7f9fc':'#fff',borderRadius:10,padding:16,color:'#1e293b',minHeight:118,boxShadow:view===g.id?'0 3px 9px #00000012':'none'}}>
      <span style={{display:'block',fontWeight:700,fontSize:14}}>{g.title}</span>
      <strong style={{fontSize:30,display:'block',margin:'7px 0 1px',color:g.color}}>{count(g.id)}</strong>
      <small style={{fontSize:12,color:'#64748b'}}>{g.subtitle}</small>
    </button>)}
   <button type="button" onClick={()=>{setView('closed');setDetail(null);setCaseText('')}} aria-pressed={view==='closed'} style={{textAlign:'left',border:'1px solid #dbe1e9',borderLeft:'4px solid #15803d',background:view==='closed'?'#f7f9fc':'#fff',borderRadius:10,padding:16,color:'#1e293b',minHeight:118}}><span style={{display:'block',fontWeight:700,fontSize:14}}>Encerradas</span><strong style={{fontSize:30,display:'block',color:'#15803d',margin:'7px 0'}}>{count('closed')}</strong><small style={{fontSize:12,color:'#64748b'}}>Histórico da conta</small></button>
  </div>
  <div style={{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}>
    <button type="button" className={view==='all'?'':'secondary'} onClick={()=>setView('all')}>Todas as reclamações ({list?.scanned??'—'})</button>
    <small style={{color:'#64748b'}}>Contadores desta consulta; podem diferir dos totais do painel oficial.</small>
  </div>
  {caseInfo&&<p role="status" className="notice" style={{fontWeight:600}}>{caseInfo}</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {list&&<><p className="notice">Consulta: {formatDate(list.checked_at)} • {list.scanned} reclamações carregadas • fonte: {list.source} • {list.complete?'Consulta finalizada':'Consulta parcial ou em andamento'}.</p>
   <div className="scroll"><table><thead><tr><th>Reclamação</th><th>Pedido / Recurso</th><th>Etapa</th><th>Responsável</th><th>Prazo</th><th>Análise</th></tr></thead>
   <tbody>{rows.map(c=><tr key={c.id}>
    <td>{String(c.id)}</td><td>{String(c.resource_id||'—')}</td><td>{c.stage||'—'}</td>
    <td>{GROUPS.find(g=>g.id===c.responsibility)?.title||'A verificar'}</td>
    <td>{formatDate(c.due_date)}</td>
    <td><button className="secondary" type="button" disabled={busy} onClick={()=>inspect(c)}>Analisar no ChatGPT</button></td>
   </tr>)}
   {!rows.length&&<tr><td colSpan="6">Nenhuma reclamação classificada nesta categoria na página consultada.</td></tr>}</tbody></table></div>
  <p className="notice">Os botões preparam o contexto de cada reclamação para esta conversa. Não é possível enviar mensagens automaticamente a uma conversa existente do ChatGPT apenas por um link: é necessário colar e enviar o conteúdo.</p>
  </>}
  <div ref={detailRef}>
  {detail&&<div className="card" style={{marginTop:16,padding:16,outline:'2px solid #fd7041'}}>
   <h3>Reclamação {detail.claim?.id} — pronta para análise</h3>
   <p>Classificação preliminar: <strong>{detail.analysis?.classification||'indeterminada'}</strong></p>
   <p>Mensagens para: {(detail.allowed_message_recipients||[]).join(', ')||'nenhuma ação de envio disponível'}</p>
   <div style={{display:'flex',gap:9,flexWrap:'wrap',margin:'12px 0'}}>
     <button type="button" onClick={copy}>Copiar dados da reclamação</button>
     <a className="secondary" href={CHAT_URL} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',border:'1px solid #d6dbe4',borderRadius:7,padding:'10px 15px',textDecoration:'none'}}>Abrir esta conversa</a>
   </div>
   <label style={{display:'block'}}>Conteúdo preparado para colar no ChatGPT
     <textarea readOnly value={caseText} rows={9} style={{width:'100%',boxSizing:'border-box',marginTop:7,fontSize:12}} onFocus={e=>e.target.select()}/>
   </label>
  </div>}
  </div>
 </section>;
}
