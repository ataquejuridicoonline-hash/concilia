export function compareShopeeAmounts(order){
 const expected=order.escrow_after_adjustment,received=order.released_amount;
 const valid=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
 if(!valid(received))return {status:'pendente',difference:null,label:'Recebimento não localizado'};
 if(!valid(expected))return {status:'pendente',difference:null,label:'Valor após ajustes indisponível'};
 const cents=Math.round(Number(received)*100)-Math.round(Number(expected)*100);
 const matches=Math.abs(cents)<=5;
 return {status:matches?'confere':'divergente',difference:cents/100,label:matches?'Confere (tolerância R$ 0,05)':cents<0?'Recebido menor que após ajustes':'Recebido maior que após ajustes'};
}
