const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const {IDBFactory}=require('fake-indexeddb');const fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timeout: '+label)};
test('DOM: five lots, direct collective classification, exact mother, history and existing features',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{url:'http://127.0.0.1:8000/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;let cookie='',chain=Promise.resolve();
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});Object.defineProperty(w.navigator,'locks',{value:{request(_name,fn){const next=chain.then(fn);chain=next.catch(()=>{});return next;}}});
 w.fetch=async(url,options={})=>{const response=await fetch(new URL(url,w.location.href),{...options,headers:{...options.headers,Cookie:cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
 w.scrollTo=()=>{};w.confirm=()=>true;w.setInterval=()=>1;w.structuredClone=structuredClone;
 const failures=[];w.addEventListener('error',e=>failures.push(e.message));w.addEventListener('unhandledrejection',e=>failures.push(String(e.reason)));
 const click=selector=>{const e=w.document.querySelector(selector);assert.ok(e,'missing '+selector);e.click();};
 const value=(name,v)=>{const e=w.document.querySelector('#editorForm [name="'+name+'"]');assert.ok(e,'field '+name);e.value=v;};
 const submit=async()=>{w.document.querySelector('#editorForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'form saved');};
 const goMore=async()=>{click('[data-view="data"]');await wait(()=>w.document.querySelector('#moreLots'),'more');};
 const goLots=async()=>{click('[data-view="herd"]');click('#animalSectionLots');assert.ok(w.document.querySelector('[data-view="herd"]').classList.contains('active'));assert.ok(w.document.querySelector('#animalSectionLots').classList.contains('selected'));};
 try{
 w.eval(['sync.js','ui-kit.js','herd-overview.js','reproduction.js','herd-work.js','app.js','quality.js','enhancements.js'].map(f=>fs.readFileSync(path.join(base,f),'utf8')).join('\n'));
 await wait(()=>w.document.querySelector('#username'),'login');w.document.querySelector('#username').value='alice';w.document.querySelector('#password').value='local-test-only-password';
 w.document.querySelector('#loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>w.document.querySelector('.home-count strong')?.textContent==='1','automatic herd');
 assert.equal(w.document.querySelectorAll('.bottom-nav button').length,4);assert.ok(w.document.querySelector('.bottom-nav [data-view="sales"]'));assert.equal(w.document.querySelector('.bottom-nav [data-view="lots"]'),null);
 assert.deepEqual([...w.document.querySelectorAll('.management-name')].map(e=>e.textContent),['En lactation','Taries','Génisses','Mâles','Taureaux']);
 assert.ok(!/Jeunes mâles|Autres mâles adultes|Femelles à préciser|Bufflonnes à classer/.test(w.document.querySelector('#app').textContent));
 click('#classifyNow');assert.equal(w.document.querySelectorAll('#herdList [data-id]').length,1);
 click('[data-select-animal="animal_test"]');click('#bulkClassify');click('[data-classify="lactating"]');await wait(()=>!w.document.querySelector('#editorForm'),'classification');
 click('[data-view="home"]');assert.equal(w.document.querySelector('[data-management="lactating"] .management-card-top strong').textContent,'1');
 click('[data-management="lactating"]');click('[data-id="animal_test"]');assert.match(w.document.querySelector('.group-chip').textContent,/En lactation/);
 click('#animalInformation');value('description','TEST ONLY observation simple');await submit();
 assert.match(w.document.querySelector('.animal-timeline').textContent,/TEST ONLY observation simple/);
 const information=[...w.document.querySelectorAll('.timeline-card')].find(e=>e.textContent.includes('TEST ONLY observation simple')),informationId=information.dataset.timelineId;
 information.querySelector('[data-event]').click();assert.equal(w.document.querySelector('#editorForm [name="type"]'),null,'information opens a short form');value('description','TEST ONLY information corrected');await submit();
 const corrected=w.document.querySelector('[data-timeline-id="'+informationId+'"]');assert.match(corrected.textContent,/information corrected/);assert.equal(corrected.querySelector('[data-cancel-event]').textContent,'Retirer');corrected.querySelector('[data-cancel-event]').click();await wait(()=>!w.document.querySelector('[data-timeline-id="'+informationId+'"]'),'information removed from current timeline');assert.match(w.document.querySelector('#app').textContent,/Observation.*annulé/);

 click('[data-quick-event="Échographie"]');value('result','positive');value('gestationWeeks','30');value('gestationMarginWeeks','1');await submit();click('[data-view="home"]');assert.ok(w.document.querySelector('[data-home-calving="animal_test"]'));click('[data-home-calving="animal_test"]');
 assert.match(w.document.querySelector('[aria-label="Carnet de reproduction"] h2').textContent,/Gestation confirmée/);
 const diagnosis=[...w.document.querySelectorAll('.timeline-card')].find(e=>e.textContent.includes('Échographie'));assert.ok(diagnosis);diagnosis.open=true;diagnosis.querySelector('[data-event]').click();value('result','negative');await submit();assert.match(w.document.querySelector('[aria-label="Carnet de reproduction"] h2').textContent,/Vide/);
 click('#addCalf');assert.equal(w.document.querySelector('#aMother').value,'animal_test');assert.equal(w.document.querySelector('[name="motherTag"]').value,'FR0000000001');
 value('earTag','FR0000000099');value('name','TEST ONLY calf');value('sex','F');value('birthDate',new Date().toISOString().slice(0,10));await submit();
 click('#goMother');assert.equal(w.document.querySelectorAll('[data-child]').length,1);
 click('#addEvent');value('type','Traitement');value('medication','TEST ONLY');value('milkWithdrawalDays','5');value('meatWithdrawalDays','10');await submit();assert.match(w.document.querySelector('.animal-timeline').textContent,/Attente lait : 5 j · viande : 10 j/);
 const calvingCard=[...w.document.querySelectorAll('.timeline-card')].find(e=>e.querySelector('.timeline-event-title')?.textContent==='Vêlage');assert.ok(calvingCard);calvingCard.querySelector('[data-event]').click();click('#cancelEvent');await wait(()=>!w.document.querySelector('#editorForm'),'calving cancellation');assert.equal(w.document.querySelectorAll('[data-child]').length,1,'confirmed calf survives calving cancellation');
 click('#animalInformation');value('description','TEST ONLY unknown historical date');w.document.querySelector('[name="dateUnknown"]').checked=true;await submit();assert.match(w.document.querySelector('.animal-timeline').textContent,/Date inconnue/);
 click('[data-view="herd"]');click('[data-management-filter=""]');
 for(let i=0;i<3;i++){
  click('#addAnimal');value('earTag','FR00000002'+i+'0');value('name','TEST ONLY heifer '+i);value('sex','F');value('birthDate','2024-01-01');value('reproductiveStatus','heifer');await submit();click('[data-view="herd"]');
 }
 click('[data-management-filter="heifer"]');assert.equal(w.document.querySelectorAll('[data-select-animal]').length,3);
 click('#clearSelected');click('#selectFiltered');assert.match(w.document.querySelector('#selectionCount').textContent,/3 coch/);
 const search=w.document.querySelector('#herdSearch');search.value='heifer 0';search.dispatchEvent(new w.Event('input'));assert.match(w.document.querySelector('#selectionCount').textContent,/2 hors filtre/);
 click('#bulkClassify');click('[data-classify="dry"]');await wait(()=>!w.document.querySelector('#editorForm'),'collective classification');
 click('[data-view="home"]');assert.equal(w.document.querySelector('[data-management="dry"] .management-card-top strong').textContent,'3');
 click('[data-management="dry"]');click('#bulkGroup');value('newName','TEST ONLY Meadow');await submit();assert.equal(w.document.querySelectorAll('#herdList .group-chip').length,3);
 click('#bulkInformation');value('description','TEST ONLY collective note');await submit();
 click('#bulkMore');click('[data-bulk-action="label"]');value('newName','À échographier');await submit();
 await goLots();assert.match(w.document.querySelector('[data-task-label]').textContent,/3/);assert.ok(w.document.querySelector('[data-task-group]'));
 const groupId=w.document.querySelector('[data-task-group]').dataset.taskGroup;click('[data-edit-lot="'+groupId+'"]');value('name','TEST ONLY Meadow amended');value('color','#477e91');await submit();assert.match(w.document.querySelector('[data-task-group="'+groupId+'"]').textContent,/Meadow amended/);
 click('[data-members="'+groupId+'"]');const member=w.document.querySelector('[data-member]:checked'),memberId=member.dataset.member;member.click();await submit();assert.match(w.document.querySelector('[data-task-group="'+groupId+'"]').textContent,/2 animaux/);
 click('[data-task-group="'+groupId+'"]');assert.equal(w.document.querySelectorAll('#herdList [data-id]').length,2,'lot composition updated without editing animal classifications');click('#manageCurrentLot');click('[data-member="'+memberId+'"]');await submit();assert.equal(w.document.querySelectorAll('#herdList [data-id]').length,3);
 await goLots();click('#newGroup');value('name','TEST ONLY new empty lot');value('color','#8b6aa4');await submit();assert.equal(w.document.querySelectorAll('[data-task-group]').length,2,'standalone lot creation');click('[data-view="home"]');const homeLot=w.document.querySelector('[data-home-lot="'+groupId+'"]');assert.match(homeLot.textContent,/Meadow amended/);assert.equal(homeLot.querySelector('b').textContent,'3');assert.equal(homeLot.style.getPropertyValue('--group-color'),'#477E91');await goLots();

 click('[data-view="herd"]');click('[data-id]');click('[data-quick-event="Échographie"]');value('date','2027-01-01');value('result','positive');await submit();
 await goLots();assert.match(w.document.querySelector('[data-task-label]').textContent,/3/,'a future diagnosis does not complete a current task');


 const parentIDs=[];
 for(let i=0;i<2;i++){click('[data-view="herd"]');click('#addAnimal');value('earTag','FR00000003'+i+'0');value('name','Églantine TEST ONLY');value('sex','F');value('birthDate','2020-01-01');await submit();parentIDs.push(w.document.querySelector('[data-confirm-parent]')?.dataset.confirmParent);}
 click('[data-view="herd"]');click('#addAnimal');value('earTag','FR0000000390');value('name','TEST ONLY historic');value('sex','F');value('birthMode','historical');value('motherName','eglantine test only');value('birthDate','2023-01-01');await submit();
 assert.equal(w.document.querySelectorAll('[data-confirm-parent]').length,2,'same-name mothers remain proposals');
 const proposal=w.document.querySelector('[data-confirm-parent]');proposal.click();await wait(()=>!!w.document.querySelector('#goMother'),'explicit stable relationship');click('#goMother');
 assert.equal(w.document.querySelectorAll('[data-child]').length,1,'one confirmed child');click('#addCalf');
 const motherSearch=w.document.querySelector('#motherSearch');motherSearch.value='eglantine';motherSearch.dispatchEvent(new w.Event('input'));
 assert.equal(w.document.querySelectorAll('#aMother option').length,3,'accent-insensitive exact-mother list keeps both homonyms');click('#cancelModal');
 await goMore();click('#openQuality');assert.equal(w.document.querySelector('h1').textContent,'Contrôles du cheptel');
 click('[data-view="sales"]');click('#addSale');value('product','PRODUCT:1');w.document.querySelector('[name="product"]').dispatchEvent(new w.Event('change',{bubbles:true}));value('price','5,05');value('quantity','0,333');await submit();assert.match(w.document.querySelector('#salesList').textContent,/1,68/);
 await goMore();click('#syncNow');await wait(()=>w.document.querySelector('#connectionIndicator').textContent==='À jour','automatic receipts');
 assert.deepEqual(failures,[]);
 }finally{dom.window.close();}
});
