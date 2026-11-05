'use client';
import {useEffect,useState} from 'react';
const brl=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const num=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:0});
const ratio=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2})+'x';
const pct=n=>n===null||n===undefined?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
export default function AdsPanel({token,stores=[]}){
 const [seller,setSeller]=useState(''),[days,setDays]=useState(7),[data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!stores.some(s=>String(s.seller_id)===seller)){setSeller(String(stores[0]?.seller_id||''));setData(null)}},[stores,seller]);
 useEffect(()=>{setData(null)},[seller,days]);
 async function refresh(){
  if(!seller||!token)return;
  setLoading(true);setError('');
  try{
   const q=new URLSearchParams({seller_id:seller,days:String(days)});
   const r=await fetch('/api/ads?'+q,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Falha na consulta da publicidade');
   setData(d);
  }catch(e){setError(e.message)}finally{setLoading(false)}
 }
 const summary=data?.summary||{};
 return <section className="ads-page">
  <section className="card">
   <div className="sectiontitle"><div><h2>Mercado Ads — Product Ads</h2><small>Análise de campanhas por conta Mercado Livre • Consulta somente leitura</small></div><span className="tag">SEM ALTERAÇÕES NOS ANÚNCIOS</span></div>
   <div className="store-switch ads-controls">
    <label htmlFor="ads-seller">Conta</label>
    <select id="ads-seller" disabled={loading} value={seller} onChange={e=>setSeller(e.target.value)}>
     <option value="">Selecione uma conta</option>
     {stores.map(s=><option key={s.seller_id} value={String(s.seller_id)}>Vendedor {s.seller_id}</option>)}
    </select>
    <label htmlFor="ads-days">Período</label>
    <select id="ads-days" disabled={loading} value={days} onChange={e=>setDays(Number(e.target.value))}>
     <option value={7}>Últimos 7 dias</option>
     <option value={14}>Últimos 14 dias</option>
     <option value={30}>Últimos 30 dias</option>
    </select>
    <button disabled={!seller||loading} onClick={refresh}>{loading?'Consultando…':'Consultar anúncios'}</button>
   </div>
   {!stores.length&&<p className="notice">Conecte uma conta Mercado Livre primeiro para consultar Product Ads.</p>}
   {error&&<p className="error" role="alert">{error}</p>}
   {data&&!data.available&&<p className="notice" role="status">{data.reason}</p>}
   {!data&&seller&&<p className="notice">Selecione o período e clique em Consultar anúncios. Os indicadores serão exibidos apenas quando a API retornar dados reais.</p>}
  </section>
  {data?.available&&<>
   <div className="cards ads-cards">
    <article className="card"><label>Investimento em Ads</label><strong>{brl(summary.cost)}</strong></article>
    <article className="card"><label>Vendas atribuídas</label><strong>{brl(summary.sales)}</strong></article>
    <article className="card"><label>ROAS</label><strong>{ratio(summary.roas)}</strong></article>
    <article className="card"><label>ACOS</label><strong>{pct(summary.acos)}</strong></article>
   </div>
   <section className="card">
    <div className="sectiontitle"><h2>Campanhas</h2><small>{data.from} a {data.to} • {data.campaigns.length} campanhas consultadas</small></div>
    <div className="scroll"><table><thead><tr><th>Campanha</th><th>Status</th><th>Investimento</th><th>Vendas atribuídas</th><th>ROAS</th><th>ACOS</th><th>Cliques</th><th>Impressões</th></tr></thead>
    <tbody>{data.campaigns.length?data.campaigns.map(c=><tr key={c.advertiser_id+'-'+c.id}><td>{c.name}<br/><small>ID {c.id}</small></td><td>{c.status}</td><td>{brl(c.cost)}</td><td>{brl(c.sales)}</td><td>{ratio(c.roas)}</td><td>{pct(c.acos)}</td><td>{num(c.clicks)}</td><td>{num(c.impressions)}</td></tr>):<tr><td colSpan="8">Nenhuma campanha retornada pela API para o período selecionado.</td></tr>}</tbody></table></div>
    {data.truncated&&<p className="notice">Resultado parcial: há mais campanhas do que o limite de consulta inicial. Não use os totais como consolidado completo.</p>}
    <p className="notice">As vendas são atribuídas pela plataforma de publicidade. Não equivalem ao faturamento total ou ao lucro líquido. Os indicadores dependem das permissões e informações retornadas pelo Mercado Livre.</p>
   </section>
  </>}
 </section>
}
