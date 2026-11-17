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


test('exactly five management groups and one undivided unknown list',()=>{
 assert.deepEqual(ui.MANAGEMENT_GROUPS.map(g=>g.label),['En lactation','Taries','Génisses','Mâles','Taureaux','À classer']);
 for(const birthDate of ['2026-10-01','2020-01-01',''])assert.equal(ui.managementGroup({sex:'M',birthDate}),'male');
 assert.equal(ui.managementGroup({sex:'M',maleRole:'breeding_bull'}),'bull');
 assert.equal(ui.managementGroup({sex:'F',lastCalving:'2025-01-01'}),'unclassified');
 assert.equal(ui.managementGroup({sex:'F'}),'unclassified');
 assert.equal(ui.managementGroup({sex:'F',reproductiveStatus:'heifer'}),'heifer');
});
test('classification preserves dates, source fields and input multiplicity without duplicate mutations',()=>{
 const a={id:'test-a',sex:'F',status:'present',birthDate:'2020-01-01',lastCalving:'2024-03-01',notes:'TEST ONLY',motherName:'TEST ONLY raw'},snapshot=JSON.stringify(a);
 const plan=ui.classificationPlan([a],[],['test-a','test-a'],'lactating','2026-11-17');
 assert.equal(plan.length,1);assert.equal(plan[0].data.lastCalving,a.lastCalving);assert.equal(plan[0].data.motherName,a.motherName);assert.equal(plan[0].data.notes,a.notes);
 assert.equal(plan[0].data.productionStatus,'lactating');assert.equal(JSON.stringify(a),snapshot);
 assert.deepEqual(ui.classificationPlan([plan[0].data],[],['test-a'],'lactating','2026-11-17'),[]);
});
test('invalid mixed selections are rejected before any plan can be applied',()=>{
 const a={id:'a',sex:'F',status:'present',birthDate:'2020-01-01'},m={...a,id:'m',sex:'M'};
 assert.throws(()=>ui.classificationPlan([a,m],[],['a','m'],'dry','2026-11-17'),/sexe/);
 assert.throws(()=>ui.classificationPlan([a],[],['a','missing'],'dry','2026-11-17'));
 assert.throws(()=>ui.classificationPlan([{...a,birthDate:'2026-10-01'}],[],['a'],'dry','2026-11-17'),/12 mois/);
 assert.throws(()=>ui.classificationPlan([{...a,reproductiveStatus:'heifer'}],[],['a'],'dry','2026-11-17'),/Confirme/);
 const plan=ui.classificationPlan([{...a,reproductiveStatus:'heifer'}],[],['a'],'dry','2026-11-17',{reviewHeifers:true});
 assert.equal(plan[0].data.lastCalving,undefined);
 assert.throws(()=>ui.classificationPlan([a],[{animalId:'a',type:'Vêlage',confirmation:'confirmed'}],['a'],'heifer','2026-11-17'),/vêlage/);
});

test('information offers removal while clinical events retain cancellation',()=>{assert.match(ui.timeline([{id:'test-note',type:'Observation',confirmation:'confirmed',date:'2026-11-17'}]),/>Retirer<\/button>/);assert.match(ui.timeline([{id:'test-care',type:'Traitement',confirmation:'confirmed',date:'2026-11-17'}]),/>Annuler<\/button>/);});


test('calving uses ten calendar months and clamps month-end without 300-day approximation',()=>{
 assert.equal(ui.calendarMonths('2026-01-31',10),'2026-11-30');assert.equal(ui.calendarMonths('2024-02-29',10),'2024-12-29');assert.equal(ui.calendarMonths('2026-02-31',10),null);
 const e={id:'mating',animalId:'a',type:'Saillie naturelle',date:'2026-01-31',confirmation:'confirmed'};
 const result=ui.calvingEstimate({id:'a'},[e],'2026-11-17');assert.equal(result.date,'2026-11-30');assert.equal(result.source,'Saillie observée');assert.equal(result.gestationMonths,10);
});
test('confirmed pregnancy age derives an estimated date and an explicit uncertainty interval',()=>{
 const e={id:'positive',animalId:'a',type:'Échographie',date:'2026-11-17',confirmation:'confirmed',result:'positive',gestationWeeks:12,gestationMarginWeeks:1},before=JSON.stringify(e);
 const result=ui.calvingEstimate({id:'a'},[e],'2026-11-17');assert.equal(result.date,'2027-06-25');assert.equal(result.earliest,'2027-06-18');assert.equal(result.latest,'2027-07-01');assert.equal(result.eventId,'positive');assert.equal(JSON.stringify(e),before);
});
test('predictions require dated confirmed evidence and disappear after cancellation or a contradictory diagnostic',()=>{
 const a={id:'a',expectedCalving:'2027-01-01'},m={id:'m',animalId:'a',type:'Saillie naturelle',date:'2026-10-01',confirmation:'confirmed'};
 assert.equal(ui.calvingEstimate(a,[],'2026-11-17'),null,'legacy imported prediction alone is not evidence');
 for(const changes of [{cancelled:true},{dateUnknown:true},{confirmation:'planned'},{date:'2027-01-01'}])assert.equal(ui.calvingEstimate(a,[{...m,...changes}],'2026-11-17'),null);
 for(const ending of [{type:'Échographie',result:'negative'},{type:'Échographie',result:'uncertain'},{type:'Vêlage'},{type:'Avortement'}])assert.equal(ui.calvingEstimate(a,[m,{...m,id:'later',date:'2026-11-01',...ending}],'2026-11-17'),null);
 assert.equal(ui.calvingEstimate({...a,lastCalving:'2026-10-02'},[m],'2026-11-17'),null);
 assert.equal(ui.calvingEstimate(a,[{...m,type:'Mise avec taureau'}],'2026-11-17'),null);
});
