'use client';
import {useState} from 'react';
export default function LocalBackupPanel({token}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function download(){
  setBusy(true);setMessage('Preparando cópia dos dados já armazenados…');
  try{
   const snapshot={format:'concilia-local-v1',generated_at:new Date().toISOString(),tables:{}};
   for(const table of ['shopee_orders','shopee_releases','meli_orders']){
    snapshot.tables[table]=[];let offset=0,complete=false;
    while(!complete){
     const response=await fetch('/api/local-backup?table='+table+'&offset='+offset,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
     if(!response.ok)throw Error('Não foi possível gerar a cópia completa. Tente novamente.');
     const page=await response.json();snapshot.tables[table].push(...page.tables[table]);complete=page.complete;
     if(!complete&&page.nextOffset<=offset)throw Error('A exportação não avançou');offset=page.nextOffset;
     setMessage('Preparando cópia: '+Object.values(snapshot.tables).reduce((sum,rows)=>sum+rows.length,0)+' registros lidos…');
    }
   }
   const blob=new Blob([JSON.stringify(snapshot)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='concilia-copia-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage('Cópia baixada. Importe o arquivo no painel local do seu PC.');
  }catch(e){setMessage(e.message)}finally{setBusy(false)}
 }
 return <div className="notice" style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}><button className="secondary" disabled={busy} onClick={download}>Salvar cópia para o PC</button><small>{message||'Consulta somente os dados armazenados no Concilia; não consulta a Shopee.'}</small></div>
}
