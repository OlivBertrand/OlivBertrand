/*
 * Ty Bufala — spécification exécutable d'un import transactionnel et idempotent.
 * Référence de logique métier pour la future API/SQLite, PAS un serveur connecté.
 * Dans un service réel, mémoriser entités + receipts + journal dans UNE transaction SQL.
 */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 root.TyBufalaSyncCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const ENTITIES=['animals','events','sales'];
 const validID=id=>typeof id==='string'&&id.length>=3&&id.length<=160;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const canon=value=>{
   if(Array.isArray(value))return '['+value.map(canon).join(',')+']';
   if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canon(value[k])).join(',')+'}';
   return JSON.stringify(value);
 };
 function newStore(){return {data:{animals:{},events:{},sales:{}},receipts:{},history:[],sequence:0};}
 function validate(op){
   if(!op||typeof op!=='object')return 'Opération invalide.';
   if(!validID(op.opId))return 'Identifiant de transmission invalide.';
   if(!ENTITIES.includes(op.entity))return 'Type de donnée inconnu.';
   if(!validID(op.entityId)||!validID(op.deviceId))return 'Identifiant de fiche ou appareil invalide.';
   if(!Number.isSafeInteger(op.baseRevision)||op.baseRevision<0)return 'Révision de départ invalide.';
   if(!op.data||typeof op.data!=='object'||Array.isArray(op.data)||op.data.id!==op.entityId)return 'Le contenu ne correspond pas à la fiche.';
   if(op.entity==='sales'){
     if(!Array.isArray(op.data.lines)||!op.data.lines.length)return 'Vente sans ligne.';
     for(const line of op.data.lines){
       if(!Number.isSafeInteger(line.quantityMilli)||line.quantityMilli<=0||!Number.isSafeInteger(line.unitPriceCents)||line.unitPriceCents<0||!Number.isSafeInteger(line.totalCents)||line.totalCents<0)return 'Ligne de vente invalide.';
       const total=(BigInt(line.quantityMilli)*BigInt(line.unitPriceCents)+500n)/1000n;
       if(total!==BigInt(line.totalCents))return 'Total TTC de ligne incohérent.';
     }
   }
   return null;
 }
 function applyOne(store,op,actorId){
   // actorId provient de l'authentification du serveur, jamais d'un champ de saisie.
   if(!validID(actorId))return {opId:op?.opId||'',status:'rejected',reason:'Utilisateur non authentifié.'};
   const reason=validate(op);if(reason)return {opId:op?.opId||'',status:'rejected',reason};
   const fingerprint=canon(op);
   const oldReceipt=store.receipts[op.opId];
   if(oldReceipt){
     if(oldReceipt.fingerprint!==fingerprint)return {opId:op.opId,status:'rejected',reason:'Identifiant de transmission réutilisé avec un contenu différent.'};
     return {opId:op.opId,status:'duplicate',entityId:op.entityId,entity:op.entity,serverRevision:oldReceipt.serverRevision};
   }
   const previous=store.data[op.entity][op.entityId]||null;
   const currentRevision=previous?previous._serverRevision:0;
   if(op.baseRevision!==currentRevision)return {opId:op.opId,status:'conflict',entityId:op.entityId,entity:op.entity,serverRevision:currentRevision,serverRecord:previous?clone(previous):null};
   // Les données internes (_serverRevision, _updatedBy) sont fixées par le serveur.
   const data=clone(op.data);
   delete data._serverRevision;delete data._updatedBy;delete data._serverUpdatedAt;
   const newRevision=currentRevision+1;
   data._serverRevision=newRevision;
   data._updatedBy=actorId;
   // Dans l'implémentation persistante, transaction + heure serveur garanties.
   store.data[op.entity][op.entityId]=data;
   store.receipts[op.opId]={fingerprint,serverRevision:newRevision};
   store.sequence+=1;
   store.history.push({sequence:store.sequence,opId:op.opId,entity:op.entity,entityId:op.entityId,revision:newRevision,actorId,deviceId:op.deviceId,data:clone(data)});
   return {opId:op.opId,status:'accepted',entity:op.entity,entityId:op.entityId,serverRevision:newRevision,cursor:store.sequence};
 }
 function applyBatch(store,operations,actorId){
   if(!Array.isArray(operations)||operations.length>250)throw new Error('Lot de synchronisation invalide (maximum 250).');
   return operations.map(op=>applyOne(store,op,actorId));
 }
 function pull(store,after=0,limit=250){
   if(!Number.isSafeInteger(after)||after<0)throw new Error('Curseur invalide.');
   if(!Number.isInteger(limit)||limit<1||limit>250)throw new Error('Taille de page invalide.');
   const events=store.history.filter(e=>e.sequence>after).slice(0,limit).map(clone);
   return {changes:events,cursor:events.length?events.at(-1).sequence:after,hasMore:store.history.some(e=>e.sequence>(events.at(-1)?.sequence??after))};
 }
 return Object.freeze({newStore,validate,applyBatch,pull});
});