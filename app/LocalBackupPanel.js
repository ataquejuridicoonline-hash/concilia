'use client';
import {useState,useEffect,useRef} from 'react';
export default function LocalBackupPanel({token}){
 const running=useRef(false),pending=useRef(false),timer=useRef(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function download(){
  if(running.current){pending.current=true;return}
  running.current=true;pending.current=false;
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
   const blob=new Blob([JSON.stringify(snapshot)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='concilia-copia-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage('Cópia enviada para Downloads. O programa local aberto importa automaticamente para o banco do PC.');
  }catch(e){setMessage(e.message)}finally{running.current=false;setBusy(false);if(pending.current)timer.current=setTimeout(download,1500)}
 }
 useEffect(()=>{
  const changed=()=>{pending.current=true;clearTimeout(timer.current);timer.current=setTimeout(download,1500)};
  window.addEventListener('concilia-data-updated',changed);
  return ()=>{window.removeEventListener('concilia-data-updated',changed);clearTimeout(timer.current)};
 },[token]);
 return <div className="notice" style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}><button className="secondary" disabled={busy} onClick={download}>Salvar cópia para o PC</button><small>{message||'Salvamento automático após importações e consultas financeiras. Mantenha o programa local aberto e permita os downloads do Concilia.'}</small></div>
}
