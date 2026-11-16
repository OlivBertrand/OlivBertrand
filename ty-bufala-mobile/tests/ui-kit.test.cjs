const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../ui-kit.js');
test('timeline escapes source fields and retains clinical cautions and actions',()=>{
 const event={id:'event" onclick="alert(1)',type:'Traitement',date:'2026-11-16',confirmation:'planned',description:'<img src=x onerror=alert(1)>',medication:'TEST ONLY',milkWithdrawalDays:5,meatWithdrawalDays:10};
 const before=JSON.stringify(event),html=ui.timeline([event]);
 assert(!html.includes('<img'));assert(html.includes('&lt;img'));
 assert(html.includes('Prévu'));assert(html.includes('Attente lait : 5 j · viande : 10 j'));
 assert(html.includes('<details class="timeline-card"'));assert(html.includes('data-cancel-event='));
 assert.equal(JSON.stringify(event),before);
 const cancelled=ui.timeline([{...event,cancelled:true}]);
 assert(cancelled.includes('Annulé'));assert(!cancelled.includes('data-cancel-event='));
});
test('group colors survive rename, reject CSS injection and match Windows palette',()=>{
 assert.equal(ui.groupColor({id:'group-test',name:'A'}),ui.groupColor({id:'group-test',name:'B'}));
 assert.equal(ui.groupColor({id:'group-test'}),'#BB7849');
 assert.equal(ui.groupColor({color:'#aabbcc'}),'#AABBCC');
 assert.match(ui.groupStyle({color:'red; background:url(https://invalid)'}),/^--group-color:#[A-F0-9]{6};--group-tint:#[A-F0-9]{6}$/);
});
test('no false confirmation while offline, unconfirmed, pending or in conflict',()=>{
 assert.notEqual(ui.syncStatus().label,'À jour');
 assert.notEqual(ui.syncStatus({confirmed:true,online:false}).label,'À jour');
 assert.notEqual(ui.syncStatus({confirmed:true,pending:2}).label,'À jour');
 assert.equal(ui.syncStatus({confirmed:true,conflict:true}).label,'À comparer');
 assert.equal(ui.syncStatus({confirmed:true}).label,'À jour');
});
