export function receiptTiming(releases,orders){
 const created=new Map(orders.map(o=>[o.order_sn,o.create_time]));
 const days=[];let nonPositive=0,missingDates=0,invalidDates=0;
 for(const r of releases){
  if(r.released_amount===null||!Number.isFinite(Number(r.released_amount))||Number(r.released_amount)<=0){nonPositive++;continue}
  const date=created.get(r.order_sn);
  if(!date||!r.released_at){missingDates++;continue}
  const duration=(Date.parse(r.released_at)-Date.parse(date))/86400000;
  if(!Number.isFinite(duration)||duration<0){invalidDates++;continue}
  days.push(duration);
 }
 days.sort((a,b)=>a-b);const n=days.length;
 return {total:releases.length,sample:n,excluded:releases.length-n,nonPositive,missingDates,invalidDates,meanDays:n?days.reduce((a,b)=>a+b,0)/n:null,medianDays:n?(n%2?days[(n-1)/2]:(days[n/2-1]+days[n/2])/2):null,minDays:n?days[0]:null,maxDays:n?days[n-1]:null};
}
