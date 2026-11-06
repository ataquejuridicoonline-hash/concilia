// Classificação conservadora: nunca chama previsão de repasse de depósito bancário.
// Apenas valores de pagamentos explicitamente marcados como "released" pela API do MP
// podem preencher a coluna "liberado informado pela plataforma".
const amount=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Math.round(Number(v)*100)/100;
const delta=(a,b)=>a===null||b===null?null:Math.round((a-b)*100)/100;
const more=(a,b)=>[...new Set([...a,...b])];
export function auditMeli(order){
 const raw=order.raw||{},payment=raw.__concilia_mp||{},shipping=raw.__concilia_shipping||{};
 const gross=amount(order.gross_amount),fee=amount(order.sale_fees),freight=shipping.status==='ok'?amount(shipping.cost):null;
 const expected=gross!==null&&fee!==null&&freight!==null?Math.round((gross-fee-freight)*100)/100:null;
 const paymentNet=payment.status==='consultado'?amount(payment.net_amount):null;
 const released=String(payment.release_status||'').toLowerCase()==='released'&&paymentNet!==null;
 // A API indica disponibilização de fundos, não transferência ao banco.
 const platformReleased=released?paymentNet:null;
 const diff=delta(expected,platformReleased);
 let issues=[],severity='pendente';
 if(order.status==='cancelled'||order.status==='canceled'){issues.push('Pedido cancelado: confira reembolso e estorno.');severity='revisar'}
 if(freight===null)issues.push('Frete do vendedor ainda não apurado.');
 if(fee===null)issues.push('Tarifa de venda não informada.');
 if(payment.status==='nao_consultado'||!payment.status)issues.push('Pagamento Mercado Pago ainda não consultado.');
 else if(payment.status==='incompleto')issues.push('Dados do pagamento incompletos ou sem permissão.');
 else if(payment.status==='sem_pagamento')issues.push('Pedido sem identificador de pagamento acessível.');
 if(paymentNet!==null&&!released)issues.push('Líquido do pagamento identificado, porém sem comprovação de liberação.');
 if(released&&expected===null)issues.push('Liberação indicada, mas faltam componentes para calcular o esperado.');
 if(diff!==null){
  if(Math.abs(diff)<=0.05){issues.push('Diferença dentro da tolerância de R$ 0,05.');severity='conferido_plataforma'}
  else {
   issues=more(issues,[diff>0?'Valor liberado abaixo do previsto: verificar descontos, estornos, frete e cobranças adicionais.':'Valor liberado acima do previsto: verificar subsídios, créditos e ajustes do pagamento.']);
   severity='divergencia';
  }
 }
 const payments=Array.isArray(raw.payments)?raw.payments:[];
 if(payments.length>1)issues.push('Pedido com múltiplos pagamentos: revisar consolidação.');
 if(payments.some(p=>['refunded','partially_refunded','charged_back','in_mediation'].includes(p.status)))issues.push('Pagamento com ocorrência de estorno, chargeback ou mediação.');
 if(!issues.length)issues.push('Sem evidência suficiente para concluir a conciliação.');
 return {
  id:String(order.order_id),date:order.created_at,store:String(order.seller_id),
  gross,fees:fee,freight,expected,
  paymentReference:paymentNet,
  platformReleased,difference:diff,
  releaseStatus:payment.release_status||null,releaseDate:payment.release_date||null,
  depositConfirmed:false,depositAmount:null,
  classification:severity,causes:issues,evidence:released?'Mercado Pago: money_release_status=released':'Pagamento/liberação não comprovados',
  checkedAt:payment.checked_at||null
 };
}
export function auditShopee(order){
 const escrow=amount(order.escrow_after_adjustment)??amount(order.escrow_amount);
 const legacy=amount(order.net_amount);
 const expected=escrow??legacy;
 const causes=[];
 if(expected===null)causes.push('Valor de escrow líquido não encontrado; consulte os detalhes financeiros do pedido.');
 else causes.push('Escrow representa valor previsto ou apurado pela plataforma, não depósito bancário.');
 if(order.release_evidence)causes.push('Existe sinalizador legado de liberação, mas não há valor e comprovante de liquidação verificáveis.');
 if(String(order.order_status||'').toUpperCase().includes('CANCEL'))causes.push('Pedido cancelado: conferir reversão financeira.');
 if(!causes.length)causes.push('Não há evidência de liquidação disponível.');
 return {
  id:String(order.order_sn),date:order.create_time||order.order_created_at,store:String(order.shop_id),
  gross:amount(order.buyer_total)??amount(order.gross_amount),fees:null,freight:null,
  expected,paymentReference:null,platformReleased:null,difference:null,
  releaseStatus:null,releaseDate:null,depositConfirmed:false,depositAmount:null,
  classification:'pendente',causes,evidence:order.release_evidence?'Indicador legado sem comprovante':'Sem consulta de liquidação efetiva',
  checkedAt:order.last_checked_at||null
 };
}
