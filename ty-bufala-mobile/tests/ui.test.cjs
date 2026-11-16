const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const {IDBFactory}=require('fake-indexeddb');const fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timeout: '+label)};
test('DOM: login, automatic herd, controls, veterinary event and exact sale',async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{url:'http://127.0.0.1:8000/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;let cookie='',chain=Promise.resolve();
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});Object.defineProperty(w.navigator,'locks',{value:{request(_name,fn){const next=chain.then(fn);chain=next.catch(()=>{});return next;}}});
 w.fetch=async(url,options={})=>{const response=await fetch(new URL(url,w.location.href),{...options,headers:{...options.headers,Cookie:cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
 w.scrollTo=()=>{};w.confirm=()=>true;w.setInterval=()=>1;w.structuredClone=structuredClone;
 const failures=[];w.addEventListener('error',e=>failures.push(e.message));w.addEventListener('unhandledrejection',e=>failures.push(String(e.reason)));
 w.eval(['sync.js','herd-overview.js','reproduction.js','herd-work.js','app.js','quality.js','enhancements.js'].map(f=>fs.readFileSync(path.join(base,f),'utf8')).join('\n'));
 await wait(()=>w.document.querySelector('#username'),'login');
 w.document.querySelector('#username').value='alice';w.document.querySelector('#password').value='local-test-only-password';w.document.querySelector('#loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>w.document.querySelector('#quickAnimal'),'home');await wait(()=>w.document.querySelector('.stat strong')?.textContent==='1','automatic herd');
 assert.equal(w.document.querySelectorAll('.herd-overview-card').length,10,'all exclusive herd groups should be visible');
 assert.equal(w.document.querySelector('[data-herd-category="femaleUnknown"] strong').textContent,'1');
 w.document.querySelector('[data-herd-category="femaleUnknown"]').click();
 assert.equal(w.document.querySelector('#herdCategory').value,'femaleUnknown');
 assert.equal(w.document.querySelectorAll('#herdList [data-id]').length,1);
 w.document.querySelector('[data-view="home"]').click();
 w.document.querySelector('[data-view="herd"]').click();await wait(()=>w.document.querySelector('#herdList [data-id]'),'herd');
 w.document.querySelector('#herdList [data-id]').click();w.document.querySelector('#addEvent').click();
 let form=w.document.querySelector('#editorForm');form.querySelector('[name="type"]').value='Traitement';form.querySelector('[name="description"]').value='Observation synthétique';form.querySelector('[name="medication"]').value='Test sans médicament réel';form.querySelector('[name="dose"]').value='Non applicable';form.querySelector('[name="milkWithdrawalDays"]').value='0';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'save event');await wait(()=>w.document.querySelector('.event-name'),'event visible');
 w.document.querySelector('[data-view="quality"]').click();assert.equal(w.document.querySelector('h1').textContent,'Contrôles du cheptel');w.document.querySelector('#ancestorLookup').value='animal_test';w.document.querySelector('#ancestorLookup').dispatchEvent(new w.Event('change'));assert.match(w.document.querySelector('#familyPreview').textContent,/Animal de test/);
 w.document.querySelector('[data-view="sales"]').click();w.document.querySelector('#addSale').click();form=w.document.querySelector('#editorForm');form.querySelector('[name="product"]').value='Produit de test';form.querySelector('[name="price"]').value='5,05';form.querySelector('[name="quantity"]').value='0,333';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'sale saved');assert.match(w.document.querySelector('#salesList').textContent,/1,68/);
 w.document.querySelector('[data-view="herd"]').click();
 w.document.querySelector('#herdList [data-id]').click();
 w.document.querySelector('[data-view="herd"]').click();
 w.document.querySelector('#addAnimal').click();
 form=w.document.querySelector('#editorForm');
 form.querySelector('[name="earTag"]').value='FR0000000002';
 form.querySelector('[name="name"]').value='Autre femelle';
 form.querySelector('[name="sex"]').value='F';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>!w.document.querySelector('#editorForm'),'other female saved');
 w.document.querySelector('[data-view="herd"]').click();
 w.document.querySelector('#herdList [data-id="animal_test"]').click();
 for(const [result,label] of [['positive','Gestation confirmée à cette date'],['negative','Vide au dernier diagnostic']]){
  w.document.querySelector('[data-quick-event="Échographie"]').click();form=w.document.querySelector('#editorForm');
  form.querySelector('[name="result"]').value=result;
  form.querySelector('[name="date"]').value=result==='positive'?'2026-11-01':'2026-11-02';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'diagnosis saved');
  assert.equal(w.document.querySelector('[aria-label="Carnet de reproduction"] h2').textContent,label);
 }
 assert.equal([...w.document.querySelectorAll('.event-name')].filter(e=>e.textContent.includes('Échographie')).length,2,'both diagnoses stay in timeline');
 const negativeTile=[...w.document.querySelectorAll('[data-event]')].find(e=>e.textContent.includes('Vide'));negativeTile.click();
 form=w.document.querySelector('#editorForm');form.querySelector('#cancelEvent').click();await wait(()=>!w.document.querySelector('#editorForm'),'cancel diagnosis');
 assert.equal(w.document.querySelector('[aria-label="Carnet de reproduction"] h2').textContent,'Gestation confirmée à cette date','cancel negative recalculates from remaining positive');
 assert.equal([...w.document.querySelectorAll('.event-name')].filter(e=>e.textContent.includes('Échographie')).length,1);

 w.document.querySelector('#addCalf').click();
 form=w.document.querySelector('#editorForm');
 assert.equal(form.querySelector('[name="motherTag"]').value,'FR0000000001','exact selected mother prefilled');
 assert.equal(form.querySelector('details').open,false,'secondary fields collapsed');
 form.querySelector('[name="earTag"]').value='FR0000000099';
 form.querySelector('[name="sex"]').value='F';
 form.querySelector('[name="birthDate"]').value=new Date().toISOString().slice(0,10);
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>!w.document.querySelector('#editorForm'),'calf saved');
 assert.match(w.document.body.textContent,/FR0000000099/);
 w.document.querySelector('#goMother').click();
 assert.match(w.document.querySelector('h1').textContent,/Animal de test/,'calf links to exact mother, not other female');
 const calvingTile=[...w.document.querySelectorAll('[data-event]')].find(e=>e.querySelector('.event-name')?.textContent==='Vêlage');assert.ok(calvingTile);calvingTile.click();
 w.document.querySelector('#cancelEvent').click();await wait(()=>!w.document.querySelector('#editorForm'),'calving cancellation');
 assert.ok([...w.document.querySelectorAll('[data-child]')].some(e=>e.textContent.includes('FR0000000099')),'calf remains after cancelling calving');
 assert.ok(![...w.document.querySelectorAll('.animal-meta span')].some(e=>e.textContent==='Dernier vêlage'),'maternal last calving cleared after explicit confirmation');

 for(const [type,category] of [['Tarissement','dry'],['Mise en lactation','lactating']]){
  w.document.querySelector(`[data-quick-event="${type}"]`).click();form=w.document.querySelector('#editorForm');
  assert.equal(form.querySelector('[name="type"]').value,type);
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'status saved');
  w.document.querySelector('[data-view="home"]').click();assert.equal(w.document.querySelector(`[data-herd-category="${category}"] strong`).textContent,'1');
  w.document.querySelector(`[data-herd-category="${category}"]`).click();w.document.querySelector('#herdList [data-id="animal_test"]').click();
 }
 w.document.querySelector('[data-quick-event="Sortie"]').click();form=w.document.querySelector('#editorForm');form.querySelector('[name="description"]').value='Sortie fictive';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'exit saved');
 assert.ok(w.document.querySelector('[data-quick-event="Entrée"]'));
 w.document.querySelector('[data-view="home"]').click();assert.equal(w.document.querySelector('.stat strong').textContent,'2');
 w.document.querySelector('[data-view="herd"]').click();
 const categorySelect=w.document.querySelector('#herdCategory');categorySelect.value='';categorySelect.dispatchEvent(new w.Event('change'));
 const calf=[...w.document.querySelectorAll('#herdList [data-id]')].find(b=>b.textContent.includes('FR0000000099'));assert.ok(calf);calf.click();w.document.querySelector('#goMother').click();
 w.document.querySelector('[data-quick-event="Entrée"]').click();form=w.document.querySelector('#editorForm');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'entry saved');
 w.document.querySelector('[data-view="home"]').click();assert.equal(w.document.querySelector('.stat strong').textContent,'3');
 w.document.querySelector('[data-view="herd"]').click();
 for(let i=0;i<8;i++){
  w.document.querySelector('#addAnimal').click();form=w.document.querySelector('#editorForm');
  form.querySelector('[name="earTag"]').value='FR00000001'+String(i).padStart(2,'0');form.querySelector('[name="name"]').value='Génisse collective '+i;
  form.querySelector('[name="sex"]').value='F';form.querySelector('[name="birthDate"]').value='2024-01-01';form.querySelector('[name="reproductiveStatus"]').value='heifer';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'heifer saved');w.document.querySelector('[data-view="herd"]').click();
 }
 const filter=w.document.querySelector('#herdCategory');filter.value='heifers';filter.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.querySelectorAll('#herdList [data-id]').length,8);
 w.document.querySelector('#toggleSelection').click();w.document.querySelector('#selectFiltered').click();assert.match(w.document.querySelector('#selectionCount').textContent,/8/);
 for(const name of ['À échographier','À surveiller','À échographier']){
  w.document.querySelector('#bulkLabel').click();form=w.document.querySelector('#editorForm');form.querySelector('[name="newName"]').value=name;
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'bulk label saved');
 }
 w.document.querySelector('#bulkGroup').click();form=w.document.querySelector('#editorForm');form.querySelector('[name="newName"]').value='Lot bâtiment';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'group saved');
 const labels=w.document.querySelector('#workLabels');[...labels.options].forEach(o=>o.selected=o.textContent==='À échographier');labels.dispatchEvent(new w.Event('change'));
 const groups=w.document.querySelector('#workGroup');groups.value=[...groups.options].find(o=>o.textContent==='Lot bâtiment').value;groups.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.querySelectorAll('#herdList [data-id]').length,8,'heifers AND label AND group');
 w.document.querySelector('[data-view="home"]').click();assert.equal(w.document.querySelector('.stat strong').textContent,'11');
 const taskButtons=[...w.document.querySelectorAll('[data-task-label]')].filter(b=>b.textContent.includes('À échographier')||b.textContent.includes('À surveiller'));assert.equal(taskButtons.length,2);
 for(const button of taskButtons)assert.match(button.textContent,/8/,'no duplicated active assignment');
 const echoTask=taskButtons.find(b=>b.textContent.includes('À échographier'));echoTask.click();w.document.querySelector('#herdList [data-id]').click();
 w.document.querySelector('[data-quick-event="Échographie"]').click();form=w.document.querySelector('#editorForm');form.querySelector('[name="date"]').value='2027-01-01';form.querySelector('[name="result"]').value='positive';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!w.document.querySelector('#editorForm'),'future diagnosis saved');
 w.document.querySelector('[data-view="home"]').click();assert.match([...w.document.querySelectorAll('[data-task-label]')].find(b=>b.textContent.includes('À échographier')).textContent,/8/,'future diagnosis does not complete a current task');

 assert.deepEqual(failures,[]);console.log('DOM checks passed. Layout and real browser/PWA installation remain unverified.');dom.window.close();
});
