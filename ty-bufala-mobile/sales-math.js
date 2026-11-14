/* Montants TTC déterministes au centime, calculés en arithmétique entière. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 root.TyBufalaSalesMath=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function lineTotalCents(quantityMilli,unitPriceCents){
   if(!Number.isSafeInteger(quantityMilli)||quantityMilli<=0||!Number.isSafeInteger(unitPriceCents)||unitPriceCents<0)throw new Error('Quantité ou prix invalide.');
   const amount=(BigInt(quantityMilli)*BigInt(unitPriceCents)+500n)/1000n;
   if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Montant trop élevé.');
   return Number(amount);
 }
 function saleTotalCents(lines){if(!Array.isArray(lines)||!lines.length)throw new Error('Vente sans produit.');
   let sum=0n;for(const l of lines){const line=lineTotalCents(l.quantityMilli,l.unitPriceCents);if(l.totalCents!==line)throw new Error('Total de ligne incohérent.');sum+=BigInt(line);}
   if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Montant total trop élevé.');return Number(sum);
 }
 function potentialDuplicates(sales,candidate){
   // Avertissement seulement : deux ventes identiques peuvent être légitimes.
   const fingerprint=s=>JSON.stringify([s.date,s.channel,s.paymentMethod,s.client||'',(s.lines||[]).map(x=>[x.product,x.quantityMilli,x.unit,x.unitPriceCents,x.totalCents])]);
   const fp=fingerprint(candidate);
   return (sales||[]).filter(x=>x.id!==candidate.id&&!x.cancelled&&fingerprint(x)===fp).map(x=>({id:x.id,createdAt:x.createdAt}));
 }
 return Object.freeze({lineTotalCents,saleTotalCents,potentialDuplicates});
});