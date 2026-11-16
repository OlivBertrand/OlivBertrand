const {test}=require('node:test'),assert=require('node:assert/strict'),R=require('../reproduction.js');
const today='2026-11-16';
const fact=(type,date,result,id=type)=>({id,type,date,result,confirmation:'confirmed'});
test('diagnostics successifs, vêlage, plans et prédictions restent distincts',()=>{
 const events=[fact('Vue en chaleur','2026-01-12'),fact('Saillie naturelle','2026-01-13')];
 assert.equal(R.summary(events,today).status,'unconfirmed');
 events.push(fact('Échographie','2026-02-18','positive'));
 assert.equal(R.summary(events,today).status,'positive');
 events.push({...fact('Vêlage','2026-11-02'),confirmation:'planned'});
 assert.equal(R.summary(events,today).status,'positive');
 events.push(fact('Échographie','2026-10-12','negative','negative'));
 assert.equal(R.summary(events,today).status,'negative');assert.equal(events.length,5);
 events.push(fact('Vêlage','2026-11-02',null,'real-calving'));
 assert.equal(R.summary(events,today).status,'ended');
 assert.equal(R.timeline(events)[0].date,'2026-11-02');
 assert.equal(R.timeline(events,'health').length,0);
});
test('contradictions, dates inconnues, futur et faits anciens demandent confirmation',()=>{
 assert.equal(R.summary([fact('Échographie','2026-11-01','positive','a'),fact('Échographie','2026-11-01','negative','b')],today).conflict,true);
 assert.equal(R.summary([fact('Échographie','2025-01-01','positive')],today).status,'uncertain');
 assert.equal(R.summary([fact('Échographie','2027-01-01','positive')],today).status,'uncertain');
 assert.equal(R.summary([{...fact('Échographie','','positive'),dateUnknown:true}],today).status,'uncertain');
 assert.equal(R.summary([{...fact('Échographie','2026-11-01','positive'),confirmation:'uncertain'}],today).status,'uncertain');
});
