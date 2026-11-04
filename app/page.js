'use client';
import {useEffect,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
const format=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x))?Number(x).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
function sb(){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}
export default function Page(){
 const [progress,setProgress]=useState(''),[token,setToken]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(null),[orders,setOrders]=useState([]),[storedCount,setStoredCount]=useState(0);
 async function req(a,method='GET',payload){let r=await fetch('/api/mercadolivre/'+a,{method,headers:{authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});let d=await r.json();if(!r.ok)throw Error(d.error||'Falha na operação');return d}
 async function load(){try{const [s,o]=await Promise.all([req('status'),req('orders')]);setStatus(s);setOrders(o.orders||[]);setStoredCount(o.totalStored??(o.orders||[]).length);setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY){setError('Configure as variáveis Supabase na Vercel');return}const c=sb();c.auth.getSession().then(({data})=>setToken(data.session?.access_token||null));const {data:sub}=c.auth.onAuthStateChange((_,session)=>setToken(session?.access_token||null));return ()=>sub.subscription.unsubscribe()},[]);
 useEffect(()=>{if(token)load()},[token]);
 async function login(e){e.preventDefault();setError('');let {error}=await sb().auth.signInWithPassword({email,password});if(error)setError(error.message)}
 async function action(a){
  setBusy(true);setError('');
  try{
   if(a==='shipping'){
    let offset=0,updated=0,missing=0,failed=0,complete=false;
    do{
     const d=await req('shipping','POST',{offset});
     offset=d.offset;updated+=d.updated;missing+=d.missing;failed+=d.failed;complete=d.complete;
     setProgress('Fretes consultados: '+offset+' • valores apurados: '+updated+' • pendências: '+(missing+failed));
    }while(!complete);
    await load();setProgress('');
    alert('Consulta de fretes concluída. Líquidos calculados: '+updated+'. Pendências: '+(missing+failed)+'. Valores ainda sujeitos a ajustes e estornos.');
   }else if(a==='sync'){
    const from=new Date(Date.now()-7*86400000).toISOString();
    let offset=0,processed=0,complete=false,limitReached=false,total=null;
    do {
     const d=await req('sync','POST',{offset,from});
     if(d.offset<=offset&&!d.complete)throw Error('A importação não avançou; tente novamente.');
     offset=d.offset;processed+=d.processed;total=d.total;complete=d.complete;limitReached=d.limitReached;
     setProgress('Importados '+processed+' pedidos nesta execução'+(total!==null?' de '+total+' encontrados':'')+'…');
    }while(!complete&&!limitReached);
    await load();
    setProgress('');
    if(limitReached)setError('Importados '+processed+' pedidos. A consulta atingiu 10.000 resultados; é necessário dividir a pesquisa por períodos menores.');
    else alert('Sincronização concluída: '+processed+' pedidos consultados. Os repasses ainda não foram verificados.');
   }else{
    const d=await req(a,'POST');if(d.url)window.location.href=d.url;else await load();
   }
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }

 const gross=orders.reduce((s,o)=>s+(Number(o.gross_amount)||0),0),fees=orders.reduce((s,o)=>s+(Number(o.sale_fees)||0),0);
 return <main><header><div className="brand"><span className="logo">C</span><div><h1>Concilia Marketplaces</h1><p>Mercado Livre e Shopee • Auditoria financeira</p></div></div><span className="tag">{status?.connected?'MERCADO LIVRE CONECTADO':'AGUARDANDO CONEXÃO'}</span></header>
 {!token?<section className="login card"><h2>Entrar no painel</h2><p>Use sua conta criada no Supabase.</p><form onSubmit={login}><input type="email" required placeholder="E-mail" value={email} onChange={e=>setEmail(e.target.value)}/><input type="password" required placeholder="Senha" value={password} onChange={e=>setPassword(e.target.value)}/><button>Entrar</button></form></section>:<><div className="bar"><strong>Mercado Livre: {status?.connected?'Conectado • vendedor '+status.seller_id:'Não conectado'}</strong><div className="actions"><button className="secondary" disabled={busy||!status?.credentialsConfigured} onClick={()=>action('start')}>Conectar Mercado Livre</button><button disabled={busy||!status?.connected} onClick={()=>action('sync')}>{busy&&progress?'Importando…':'Sincronizar 7 dias'}</button><button className="secondary" disabled={busy||!status?.connected} onClick={()=>action('shipping')}>Consultar fretes e líquido</button><button className="secondary" onClick={()=>sb().auth.signOut()}>Sair</button></div></div><div className="cards"><article className="card"><label>Pedidos importados</label><strong>{storedCount}</strong></article><article className="card"><label>Vendas brutas*</label><strong>{format(gross)}</strong></article><article className="card"><label>Tarifas informadas*</label><strong>{format(fees)}</strong></article><article className="card"><label>Repasses não verificados</label><strong>{orders.length}</strong></article></div><section className="card"><div className="sectiontitle"><h2>Pedidos Mercado Livre</h2><small>Até 500 registros recentes</small></div><div className="scroll"><table><thead><tr><th>Pedido</th><th>Status</th><th>Venda</th><th>Tarifas de venda</th><th>Frete vendedor</th><th>Líquido após taxas e frete*</th><th>Pagamento</th><th>Liberação</th></tr></thead><tbody>{orders.length?orders.map(o=><tr key={o.order_id}><td>{o.order_id}</td><td>{o.status||'—'}</td><td>{format(o.gross_amount)}</td><td>{format(o.sale_fees)}</td><td>{format(o.shipping_cost)}<br/><small>{o.shipping_status==='ok'?'Consultado na API':'A conferir'}</small></td><td><strong>{format(o.net_after_shipping)}</strong><br/><small>{o.net_after_shipping===null?'Aguardando consulta de frete':'Sujeito a outros ajustes'}</small></td><td>{o.payment_status||'—'}</td><td>Não verificada</td></tr>):<tr><td colSpan="8">Nenhum pedido importado.</td></tr>}</tbody></table></div></section>{progress&&<p className="notice" role="status">{progress}</p>}<p className="notice">* Valores apenas dos registros carregados nesta tela. O líquido após taxas e frete usa tarifas de venda e o custo efetivamente atribuído ao vendedor pela API de envios. Podem existir descontos adicionais, ajustes, estornos e envios compartilhados: a quantia exibida não comprova o repasse definitivo. O valor definitivo exige conciliação com Mercado Pago. Pagamento aprovado não comprova liberação ou depósito. A Shopee será integrada após aprovação do aplicativo.</p></>}{error&&<p className="error" role="alert">{error}</p>}<footer>Concilia Marketplaces • Sem integração bancária • Dados financeiros sujeitos a conferência</footer></main>
}