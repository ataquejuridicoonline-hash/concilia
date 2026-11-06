'use client';
import {useState} from 'react';
export default function LocalBackupPanel({token}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function download(){
  setBusy(true);setMessage('Preparando cópia dos dados já armazenados…');
  try{
   const response=await fetch('/api/local-backup',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   if(!response.ok)throw Error('Não foi possível gerar a cópia local.');
   const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='concilia-copia-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage('Cópia baixada. Importe o arquivo no painel local do seu PC.');
  }catch(e){setMessage(e.message)}finally{setBusy(false)}
 }
 return <div className="notice" style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}><button className="secondary" disabled={busy} onClick={download}>Salvar cópia para o PC</button><small>{message||'Consulta somente os dados armazenados no Concilia; não consulta a Shopee.'}</small></div>
}
