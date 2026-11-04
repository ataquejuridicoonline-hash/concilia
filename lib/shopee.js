import crypto from 'node:crypto';
import {db,checked,seal,unseal} from './server.js';
const PROD='https://partner.shopeemobile.com',TEST='https://partner.test-stable.shopeemobile.com';
export function configured(){return !!(process.env.SHOPEE_PARTNER_ID&&process.env.SHOPEE_PARTNER_KEY&&process.env.SHOPEE_REDIRECT_URI)}
export function cfg(){
 const id=process.env.SHOPEE_PARTNER_ID,key=process.env.SHOPEE_PARTNER_KEY,redirect=process.env.SHOPEE_REDIRECT_URI;
 if(!/^\d+$/.test(id||'')||!key||!redirect)throw Error('Credenciais de produção Shopee ainda não configuradas');
 const u=new URL(redirect);
 if(u.protocol!=='https:'||u.pathname!=='/api/shopee/callback')throw Error('SHOPEE_REDIRECT_URI inválida');
 return {id:Number(id),key,redirect:u.toString(),host:PROD};
}
export function sign(id,key,path,timestamp,access='',shop=''){return crypto.createHmac('sha256',key).update(String(id)+path+timestamp+access+shop).digest('hex')}
export function urlFor(path,options={},scope=null){
 const c=cfg(),t=Math.floor(Date.now()/1000),u=new URL(path,c.host);
 const access=scope?.access||'',shop=scope?.shop||'';
 const common={partner_id:String(c.id),timestamp:String(t),sign:sign(c.id,c.key,path,t,access,shop)};
 if(scope){common.access_token=access;common.shop_id=String(shop)}
 for(const [k,v] of Object.entries({...common,...options}))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
 return u;
}
export async function publicPost(path,body){const res=await fetch(urlFor(path),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok||data.error)throw Error('Shopee: '+(data.message||data.error||'HTTP '+res.status));return data}
export async function shopGet(path,params,conn){
 const u=urlFor(path,params,{access:conn.token,shop:conn.shop_id});
 const res=await fetch(u,{cache:'no-store'}),data=await res.json().catch(()=>({}));
 if(!res.ok||data.error)throw Error('Shopee: '+(data.message||data.error||'HTTP '+res.status));
 return data.response||{};
}
export async function shopConnection(){
 const list=await checked(db().from('shopee_connections').select('*').order('connected_at',{ascending:false}).limit(1));
 return list?.[0]||null;
}
export async function activeShop(){
 const row=await shopConnection();if(!row)throw Error('Nenhuma loja Shopee conectada');
 if(Date.parse(row.expires_at)>Date.now()+300000)return {...row,token:unseal(row.access_token_cipher)};
 const c=cfg();const data=await publicPost('/api/v2/auth/access_token/get',{partner_id:c.id,refresh_token:unseal(row.refresh_token_cipher),shop_id:Number(row.shop_id)});
 if(!data.access_token||!data.refresh_token)throw Error('Renovação de token Shopee incompleta');
 const expires=new Date(Date.now()+Math.min(Number(data.expire_in)||14400,14400)*1000).toISOString();
 await checked(db().from('shopee_connections').update({access_token_cipher:seal(data.access_token),refresh_token_cipher:seal(data.refresh_token),expires_at:expires,updated_at:new Date().toISOString()}).eq('shop_id',row.shop_id));
 return {...row,token:data.access_token};
}
export const round=x=>Math.round(Number(x)*100)/100;
