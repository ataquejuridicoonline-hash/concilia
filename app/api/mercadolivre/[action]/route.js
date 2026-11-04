import crypto from 'node:crypto';
import {admin,db,checked,hash,seal,unseal,config,oauth,meli,connection,validConnection,normalize} from '../../../../lib/server.js';
export const runtime='nodejs';
const errorResponse=e=>Response.json({error:e.message||'Erro interno'},{status:500});
export async function GET(req,{params}){const {action}=await params;
 if(action==='callback'){
  const u=new URL(req.url);const dest=x=>{const t=new URL('/',process.env.APP_URL||u.origin);t.searchParams.set('meli',x);return Response.redirect(t,303)};
  try{const state=u.searchParams.get('state'),code=u.searchParams.get('code');if(!state||!code)return dest('autorizacao_cancelada');
   const s=await checked(db().from('meli_oauth_states').select('*').eq('state_hash',hash(state)).limit(1)),row=s?.[0];
   if(!row||new Date(row.expires_at).getTime()<Date.now())return dest('estado_invalido');
   const removed=await checked(db().from('meli_oauth_states').delete().eq('state_hash',row.state_hash).select('state_hash'));if(removed.length!==1)return dest('estado_utilizado');
   const cfg=config(),t=await oauth({grant_type:'authorization_code',client_id:cfg.id,client_secret:cfg.secret,code,redirect_uri:cfg.redirect,code_verifier:unseal(row.verifier_cipher)});
   if(!t.access_token||!t.refresh_token||!t.expires_in)throw Error('Tokens incompletos');
   const profile=await meli('/users/me',t.access_token),seller_id=Number(profile.id);if(!seller_id)throw Error('Identificação do vendedor ausente');
   await checked(db().from('meli_connections').upsert({seller_id,access_token_cipher:seal(t.access_token),refresh_token_cipher:seal(t.refresh_token),expires_at:new Date(Date.now()+Number(t.expires_in)*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'seller_id'}));return dest('conectado');
  }catch(e){return dest('erro_autorizacao')}
 }
 try{if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
  if(action==='status'){const c=await connection();return Response.json({connected:!!c,seller_id:c?.seller_id??null,credentialsConfigured:!!(process.env.MELI_CLIENT_ID&&process.env.MELI_CLIENT_SECRET&&process.env.MELI_REDIRECT_URI&&process.env.TOKEN_ENCRYPTION_KEY)})}
  if(action==='orders'){const orders=await checked(db().from('meli_orders').select('order_id,status,created_at,gross_amount,sale_fees,payment_status,payout_status').order('created_at',{ascending:false}).limit(500));return Response.json({orders})}
  return Response.json({error:'Rota não encontrada'},{status:404});
 }catch(e){return errorResponse(e)}
}
export async function POST(req,{params}){const {action}=await params;if(!await admin(req))return Response.json({error:'Não autorizado'},{status:401});
 try{
  if(action==='start'){const cfg=config(),verifier=crypto.randomBytes(48).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url'),state=crypto.randomBytes(32).toString('hex');
   await checked(db().from('meli_oauth_states').insert({state_hash:hash(state),verifier_cipher:seal(verifier),expires_at:new Date(Date.now()+600000).toISOString()}));
   const url=new URL('https://auth.mercadolivre.com.br/authorization');for(const [k,v] of Object.entries({response_type:'code',client_id:cfg.id,redirect_uri:cfg.redirect,state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(k,v);return Response.json({url:url.toString()})}
  if(action==='sync'){const c=await validConnection();const inserted=await checked(db().from('meli_sync_runs').insert({seller_id:c.seller_id,status:'running'}).select('id').single());const run=inserted.id;try{let processed=0,from=new Date(Date.now()-7*86400000).toISOString();
   for(let offset=0;offset<200;offset+=50){const qs=new URLSearchParams({seller:String(c.seller_id),limit:'50',offset:String(offset),'order.date_created.from':from,sort:'date_desc'});const results=(await meli('/orders/search?'+qs,c.accessToken)).results||[];if(!results.length)break;await checked(db().from('meli_orders').upsert(results.map(o=>({...normalize(o),seller_id:c.seller_id})),{onConflict:'seller_id,order_id'}));processed+=results.length;if(results.length<50)break}
   await checked(db().from('meli_sync_runs').update({status:'ok',processed,finished_at:new Date().toISOString()}).eq('id',run));return Response.json({processed,notice:'Liberação financeira não verificada'})
  }catch(e){await db().from('meli_sync_runs').update({status:'erro',error_message:e.message.slice(0,300),finished_at:new Date().toISOString()}).eq('id',run);throw e}}
  return Response.json({error:'Rota não encontrada'},{status:404})
 }catch(e){return errorResponse(e)}
}
