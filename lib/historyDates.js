// Intervalos UTC inclusivos para conciliação retroativa.
// Datas são interpretadas em UTC para evitar duplicações entre páginas.
export function todayUTC(){return new Date().toISOString().slice(0,10)}
export function daysAgoUTC(days){return new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10)}
export function historyWindows(start,end){
 const regex=/^\d{4}-\d{2}-\d{2}$/;
 if(!regex.test(start||'')||!regex.test(end||''))throw Error('Preencha as duas datas.');
 const first=Date.parse(start+'T00:00:00.000Z'),last=Date.parse(end+'T00:00:00.000Z');
 const now=Date.parse(todayUTC()+'T00:00:00.000Z');
 if(!Number.isFinite(first)||!Number.isFinite(last)||new Date(first).toISOString().slice(0,10)!==start||new Date(last).toISOString().slice(0,10)!==end||first>last||last>now)throw Error('Escolha datas válidas, sem períodos futuros.');
 if(last-first>365*86400000)throw Error('Selecione no máximo 366 dias por execução.');
 const windows=[];
 for(let day=first;day<=last;day+=7*86400000){
  const stop=Math.min(day+7*86400000-1000,last+86400000-1000);
  windows.push({from:new Date(day).toISOString(),to:new Date(stop).toISOString(),timeFrom:Math.floor(day/1000),timeTo:Math.floor(stop/1000)});
 }
 return windows;
}
