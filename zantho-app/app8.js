// Zantho V0.5 — synchronisation OneDrive intelligente, locale-first
const Z_DEFAULT_CLIENT_ID='b85fa32f-bd0a-4a66-9b5d-fed8cac13556';
const Z_AUTHORITY='https://login.microsoftonline.com/consumers';
const Z_SYNC_SCOPE=['Files.ReadWrite.AppFolder'];
const Z_SYNC_META_KEY='zantho-sync-meta-v2';
const Z_REMOTE_STATE='zantho-data.json';
let zSyncBusy=false;
let zSyncTimer=null;
let zMsalCache=null;
let zMsalClientId=null;
let zInternalSyncSave=false;
let zAuthInitPromise=null;
const Z_AUTH_RESUME_KEY='zantho-sync-resume-v1';

function zSyncMeta(){
  try{return JSON.parse(localStorage.getItem(Z_SYNC_META_KEY)||'{}');}catch{return {};}
}
function zSetSyncMeta(patch){
  const next={...zSyncMeta(),...patch};
  localStorage.setItem(Z_SYNC_META_KEY,JSON.stringify(next));
  return next;
}
function zDeletedShape(d={}){
  return {
    observations:Array.isArray(d.observations)?d.observations:[],
    harvests:Array.isArray(d.harvests)?d.harvests:[],
    sessions:Array.isArray(d.sessions)?d.sessions:[],
    transformations:Array.isArray(d.transformations)?d.transformations:[],
    tastings:Array.isArray(d.tastings)?d.tastings:[],
    photoRefs:Array.isArray(d.photoRefs)?d.photoRefs:[]
  };
}
state.deleted=zDeletedShape(state.deleted);
if(state.planConfigured && !state.planUpdatedAt) state.planUpdatedAt=state.updatedAt||state.createdAt||nowISO();

function zStamp(x){ return new Date(x?.updatedAt||x?.createdAt||0).getTime()||0; }
function zMergeById(a=[],b=[]){
  const map=new Map();
  for(const x of [...(a||[]),...(b||[])]){
    if(!x?.id) continue;
    const prev=map.get(x.id);
    if(!prev || zStamp(x)>=zStamp(prev)) map.set(x.id,x);
  }
  return [...map.values()];
}
function zMergeDeletes(a=[],b=[]){
  const map=new Map();
  for(const x of [...(a||[]),...(b||[])]){
    if(!x?.id) continue;
    const prev=map.get(x.id);
    const tx=new Date(x.deletedAt||0).getTime()||0;
    const tp=new Date(prev?.deletedAt||0).getTime()||0;
    if(!prev||tx>=tp) map.set(x.id,x);
  }
  return [...map.values()];
}
function zFilterDeleted(arr=[],tombs=[]){
  const deleted=new Map((tombs||[]).map(x=>[x.id,new Date(x.deletedAt||0).getTime()||0]));
  return (arr||[]).filter(x=>{
    const dt=deleted.get(x.id);
    if(!dt) return true;
    return zStamp(x)>dt;
  });
}
function zMergeHarvests(local=[],remote=[],sessionTombs=[]){
  const parents=zMergeById(local,remote);
  return parents.map(h=>{
    const l=local.find(x=>x.id===h.id), r=remote.find(x=>x.id===h.id);
    const sessions=zFilterDeleted(zMergeById(l?.sessions||[],r?.sessions||[]),sessionTombs);
    return {...h,sessions};
  });
}
function zMergeStates(local,remote){
  remote=remote||{};
  local=local||{};
  const ld=zDeletedShape(local.deleted), rd=zDeletedShape(remote.deleted);
  const deleted={
    observations:zMergeDeletes(ld.observations,rd.observations),
    harvests:zMergeDeletes(ld.harvests,rd.harvests),
    sessions:zMergeDeletes(ld.sessions,rd.sessions),
    transformations:zMergeDeletes(ld.transformations,rd.transformations),
    tastings:zMergeDeletes(ld.tastings,rd.tastings),
    photoRefs:zMergeDeletes(ld.photoRefs,rd.photoRefs)
  };

  const localPlanTs=new Date(local.planUpdatedAt||0).getTime()||0;
  const remotePlanTs=new Date(remote.planUpdatedAt||0).getTime()||0;
  let plan=local.plan, planConfigured=!!local.planConfigured, planUpdatedAt=local.planUpdatedAt||null;
  if(!planConfigured && remote.planConfigured){
    plan=remote.plan; planConfigured=true; planUpdatedAt=remote.planUpdatedAt||remote.updatedAt||null;
  }else if(remote.planConfigured && remotePlanTs>localPlanTs){
    plan=remote.plan; planConfigured=true; planUpdatedAt=remote.planUpdatedAt||remote.updatedAt||null;
  }

  let plants=local.plants||[];
  if(planConfigured && plan && Number.isInteger(+plan.sichuanLine2) && Number.isInteger(+plan.sichuanLine3) && Number.isInteger(+plan.sichuanLine4)){
    try{ plants=buildPlants(+plan.sichuanLine2,+plan.sichuanLine3,+plan.sichuanLine4); }catch{}
  }else if(!plants.length && remote.plants?.length){ plants=remote.plants; }

  const merged={
    ...local,
    version:state.version||APP_VERSION,
    planConfigured,
    plan,
    planUpdatedAt,
    plants,
    observations:zFilterDeleted(zMergeById(local.observations,remote.observations),deleted.observations),
    harvests:zFilterDeleted(zMergeHarvests(local.harvests,remote.harvests,deleted.sessions),deleted.harvests),
    transformations:zFilterDeleted(zMergeById(local.transformations,remote.transformations),deleted.transformations),
    tastings:zFilterDeleted(zMergeById(local.tastings,remote.tastings),deleted.tastings),
    photoRefs:zFilterDeleted(zMergeById(local.photoRefs||[],remote.photoRefs||[]),deleted.photoRefs),
    deleted,
    settings:{...(local.settings||{})},
    activeHarvestSession:local.activeHarvestSession||null,
    ui:local.ui||{}
  };
  merged.createdAt=local.createdAt||remote.createdAt||nowISO();
  merged.updatedAt=new Date(Math.max(
    new Date(local.updatedAt||0).getTime()||0,
    new Date(remote.updatedAt||0).getTime()||0,
    Date.now()
  )).toISOString();
  return merged;
}

function markDeleted(kind,id){
  if(!id) return;
  state.deleted=zDeletedShape(state.deleted);
  if(!state.deleted[kind]) return;
  state.deleted[kind]=zMergeDeletes(state.deleted[kind],[{id,deletedAt:nowISO()}]);
}

function zRemotePayload(){
  return {
    syncSchema:2,
    appVersion:state.version||APP_VERSION,
    createdAt:state.createdAt,
    updatedAt:state.updatedAt,
    planConfigured:state.planConfigured,
    plan:state.plan,
    planUpdatedAt:state.planUpdatedAt||null,
    plants:state.plants,
    observations:state.observations,
    harvests:state.harvests,
    transformations:state.transformations,
    tastings:state.tastings,
    photoRefs:state.photoRefs||[],
    deleted:zDeletedShape(state.deleted)
  };
}
function zEncPath(path){
  return String(path||'').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
function zGraphUrl(path=''){
  const encoded=zEncPath(path);
  return encoded
    ? `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encoded}`
    : 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
}
async function zGetMsal(){
  const clientId=(state.settings.clientId||Z_DEFAULT_CLIENT_ID||'').trim();
  if(!clientId) throw new Error('Client ID Microsoft manquant');
  if(zMsalCache && zMsalClientId===clientId){
    if(zAuthInitPromise) await zAuthInitPromise;
    return zMsalCache;
  }
  const {PublicClientApplication}=await import('https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.29.0/+esm');
  const appMsal=new PublicClientApplication({
    auth:{
      clientId,
      authority:Z_AUTHORITY,
      redirectUri:location.origin+'/'
    },
    cache:{cacheLocation:'localStorage'}
  });
  await appMsal.initialize();
  zMsalCache=appMsal;
  zMsalClientId=clientId;

  zAuthInitPromise=appMsal.handleRedirectPromise().then(result=>{
    if(result?.account){
      zSetSyncMeta({
        account:result.account.username||result.account.name||'',
        needsLogin:false,
        lastError:''
      });
    }
    if(location.hash && /(?:^|#|&)code=|(?:^|#|&)error=/.test(location.hash)){
      history.replaceState(null,document.title,location.pathname+location.search);
    }
    return result;
  }).catch(err=>{
    console.error('MSAL redirect',err);
    zSetSyncMeta({lastError:String(err?.message||err),needsLogin:true});
    if(location.hash && /(?:^|#|&)code=|(?:^|#|&)error=/.test(location.hash)){
      history.replaceState(null,document.title,location.pathname+location.search);
    }
    throw err;
  });
  await zAuthInitPromise;
  return appMsal;
}
async function zAccessToken(interactive=false){
  const msal=await zGetMsal();
  let account=msal.getAllAccounts()[0]||null;

  if(!account){
    if(!interactive) return null;
    sessionStorage.setItem(Z_AUTH_RESUME_KEY,'1');
    zSetSyncMeta({lastError:'',needsLogin:false});
    await msal.loginRedirect({
      scopes:Z_SYNC_SCOPE,
      authority:Z_AUTHORITY,
      redirectUri:location.origin+'/',
      redirectStartPage:location.href.split('#')[0]
    });
    return null;
  }

  try{
    const t=await msal.acquireTokenSilent({
      account,
      scopes:Z_SYNC_SCOPE,
      authority:Z_AUTHORITY,
      redirectUri:location.origin+'/'
    });
    zSetSyncMeta({account:account.username||account.name||'',needsLogin:false,lastError:''});
    return t.accessToken;
  }catch(err){
    if(!interactive){
      zSetSyncMeta({needsLogin:true});
      return null;
    }
    sessionStorage.setItem(Z_AUTH_RESUME_KEY,'1');
    await msal.acquireTokenRedirect({
      account,
      scopes:Z_SYNC_SCOPE,
      authority:Z_AUTHORITY,
      redirectUri:location.origin+'/',
      redirectStartPage:location.href.split('#')[0]
    });
    return null;
  }
}
async function zEnsureAppRoot(token){
  const r=await fetch(zGraphUrl(),{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error(`Dossier d’application OneDrive: ${r.status}`);
  return r.json();
}
async function zEnsurePhotoFolder(token){
  // Plus de sous-dossier : les photos sont stockées directement dans Apps/Zantho.
  return true;
}
async function zReadRemoteState(token){
  const r=await fetch(zGraphUrl(Z_REMOTE_STATE)+':/content',{headers:{Authorization:`Bearer ${token}`}});
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`Lecture OneDrive: ${r.status}`);
  const data=await r.json();
  return data&&typeof data==='object'?data:null;
}
async function zWriteRemoteState(token){
  const r=await fetch(zGraphUrl(Z_REMOTE_STATE)+':/content',{
    method:'PUT',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify(zRemotePayload(),null,2)
  });
  if(!r.ok) throw new Error(`Écriture OneDrive: ${r.status}`);
  return r.json();
}
async function zSyncPhotos(token,notify){
  const localPhotos=await getAllPhotos();
  const localRefs=localPhotos.map(p=>({
    id:p.id,plantId:p.plantId,name:p.name,type:p.type,note:p.note||'',
    createdAt:p.createdAt,updatedAt:p.updatedAt||p.createdAt,
    drivePath:p.drivePath||null
  }));
  state.photoRefs=zFilterDeleted(zMergeById(state.photoRefs||[],localRefs),state.deleted?.photoRefs||[]);

  let pulled=0,uploaded=0;
  for(const ref of state.photoRefs||[]){
    if(!ref.drivePath) continue;
    if(await getPhoto(ref.id)) continue;
    const r=await fetch(zGraphUrl(ref.drivePath)+':/content',{headers:{Authorization:`Bearer ${token}`}});
    if(!r.ok) continue;
    const blob=await r.blob();
    await putPhoto({
      id:ref.id,plantId:ref.plantId,blob,
      name:ref.name||'photo.jpg',type:ref.type||blob.type||'image/jpeg',
      note:ref.note||'',createdAt:ref.createdAt||nowISO(),
      updatedAt:ref.updatedAt||ref.createdAt||nowISO(),
      synced:true,drivePath:ref.drivePath
    });
    pulled++;
    if(notify) notify(`Photos reçues : ${pulled}`);
  }

  const photos=await getAllPhotos();
  for(const p of photos){
    const ref=state.photoRefs.find(x=>x.id===p.id);
    if(ref?.drivePath && p.synced) continue;
    const ext=(p.type||'').includes('png')?'png':(p.type||'').includes('heic')?'heic':'jpg';
    const drivePath=`photo-${p.id}.${ext}`;
    const up=await fetch(zGraphUrl(drivePath)+':/content',{
      method:'PUT',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':p.type||'application/octet-stream'},
      body:p.blob
    });
    if(!up.ok) throw new Error(`Envoi photo: ${up.status}`);
    p.synced=true; p.drivePath=drivePath; p.updatedAt=p.updatedAt||p.createdAt||nowISO();
    await putPhoto(p);
    state.photoRefs=zMergeById(state.photoRefs||[],[{
      id:p.id,plantId:p.plantId,name:p.name,type:p.type,note:p.note||'',
      createdAt:p.createdAt,updatedAt:p.updatedAt,drivePath
    }]);
    uploaded++;
    if(notify) notify(`Photos envoyées : ${uploaded}/${photos.length}`);
  }
  return {pulled,uploaded,total:photos.length};
}

async function zRunSync({interactive=false,reason='manuel'}={}){
  if(zSyncBusy) return {status:'busy'};
  if(!(state.settings.clientId||Z_DEFAULT_CLIENT_ID)) return {status:'not-configured'};
  if(!navigator.onLine) return {status:'offline'};
  zSyncBusy=true;
  const started=Date.now();
  const meta=zSetSyncMeta({running:true,lastAttempt:nowISO(),lastReason:reason,lastError:''});
  const msg=document.querySelector('#syncMsg');
  const notify=t=>{ if(msg) msg.textContent=t; };
  try{
    notify(interactive?'Connexion Microsoft…':'Synchronisation…');
    const token=await zAccessToken(interactive);
    if(!token){
      zSetSyncMeta({running:false,needsLogin:true});
      notify('Connexion Microsoft à renouveler.');
      return {status:'auth-needed'};
    }
    await zEnsureAppRoot(token);

    notify('Fusion des données…');
    const remote1=await zReadRemoteState(token);
    if(remote1) state=zMergeStates(state,remote1);

    const photoStats=await zSyncPhotos(token,interactive?notify:null);

    // Relire juste avant l’écriture pour réduire la fenêtre de conflit entre iPhone et PC.
    const remote2=await zReadRemoteState(token);
    if(remote2) state=zMergeStates(state,remote2);

    state.settings.syncEnabled=true;
    state.settings.lastSync=nowISO();
    zInternalSyncSave=true;
    save();
    zInternalSyncSave=false;
    await zWriteRemoteState(token);

    zSetSyncMeta({
      running:false,needsLogin:false,lastSuccess:state.settings.lastSync,lastError:'',
      lastDurationMs:Date.now()-started,account:zSyncMeta().account||''
    });
    notify(`Synchronisé · ${photoStats.uploaded} photo(s) envoyée(s), ${photoStats.pulled} reçue(s).`);
    render();
    return {status:'ok',...photoStats};
  }catch(err){
    console.error('Zantho sync',err);
    zSetSyncMeta({running:false,lastError:String(err?.message||err),lastFailure:nowISO()});
    notify(`Synchronisation impossible : ${err?.message||err}`);
    return {status:'error',error:err};
  }finally{
    zSyncBusy=false;
  }
}

syncOneDrive=async function(){ return zRunSync({interactive:true,reason:'manuel'}); };

function scheduleOneDriveSync(reason='modification',delay=12000){
  if(zInternalSyncSave || !state.settings?.syncEnabled || !(state.settings?.clientId||Z_DEFAULT_CLIENT_ID) || !navigator.onLine) return;
  clearTimeout(zSyncTimer);
  zSyncTimer=setTimeout(()=>zRunSync({interactive:false,reason}),delay);
}

const zSaveBeforeSyncV2=save;
save=function(){
  zSaveBeforeSyncV2();
  scheduleOneDriveSync('modification',12000);
};

window.addEventListener('online',()=>scheduleOneDriveSync('retour réseau',1500));
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') scheduleOneDriveSync('retour application',2500);
});
setTimeout(()=>scheduleOneDriveSync('démarrage',2500),2500);
setInterval(()=>{
  if(document.visibilityState==='visible') scheduleOneDriveSync('entretien',1000);
},5*60*1000);

const zRenderSettingsBase=renderSettings;
renderSettings=function(){
  zRenderSettingsBase();
  const cards=[...app.querySelectorAll('.card')];
  const one=cards.find(c=>c.querySelector('h3')?.textContent.trim()==='OneDrive');
  if(!one) return;
  const meta=zSyncMeta();
  const connected=!!state.settings.syncEnabled;
  const last=state.settings.lastSync?fmtDateTime(state.settings.lastSync):'jamais';
  const account=meta.account?esc(meta.account):'';
  one.innerHTML=`
    <h3>OneDrive</h3>
    <p class="small-note">Copie durable et synchro iPhone ↔ PC. Zantho utilise uniquement son dossier d’application OneDrive via la permission minimale <code>Files.ReadWrite.AppFolder</code>.</p>
    <form id="syncSettingsV2" class="stack">
      <div class="field"><label>Client ID Microsoft Entra</label><input name="clientId" value="${esc(state.settings.clientId||Z_DEFAULT_CLIENT_ID)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off"></div>
      <div class="notice"><strong>Configuration Microsoft Entra</strong><br>
        1. Nom de l’application : <strong>Zantho</strong><br>
        2. Plateforme : <strong>Single-page application (SPA)</strong><br>
        3. URI de redirection : <strong>${esc(location.origin+'/')}</strong><br>
        4. Microsoft Graph délégué : <strong>Files.ReadWrite.AppFolder</strong><br>
        Stockage ensuite limité à <strong>OneDrive → Apps → Zantho</strong>.
      </div>
      <button class="btn secondary">Enregistrer</button>
    </form>
    <div class="sync-status-card">
      <div><strong>${connected?'Synchronisation activée':'Non connecté'}</strong><span>Dernière synchro : ${last}${account?' · '+account:''}</span></div>
      <span class="status-dot ${meta.lastError?'danger':connected?'ok':'watch'}">${meta.lastError?'Erreur':connected?'Auto':'À configurer'}</span>
    </div>
    <div class="row sync-actions">
      <button class="btn" id="syncNowV2">${connected?'Synchroniser maintenant':'Connecter OneDrive'}</button>
      ${connected?'<button class="btn secondary" id="pauseSyncV2">Suspendre l’auto-sync</button>':''}
    </div>
    <div id="syncMsg" class="small-note">${meta.lastError?esc(meta.lastError):meta.needsLogin?'Connexion Microsoft à renouveler.':''}</div>
  `;
  one.querySelector('#syncSettingsV2').onsubmit=e=>{
    e.preventDefault();
    const id=new FormData(e.target).get('clientId').trim();
    if(id && !/^[0-9a-fA-F-]{36}$/.test(id)) return alert('Le Client ID Microsoft ne semble pas valide.');
    const changed=id!==state.settings.clientId;
    state.settings.clientId=id;
    if(changed){ state.settings.syncEnabled=false; zMsalCache=null; zMsalClientId=null; zSetSyncMeta({needsLogin:false,lastError:'',account:''}); }
    save();
    renderSettings();
  };
  one.querySelector('#syncNowV2').onclick=async()=>{
    const result=await zRunSync({interactive:true,reason:'manuel'});
    if(result.status==='ok') renderSettings();
  };
  const pause=one.querySelector('#pauseSyncV2');
  if(pause) pause.onclick=()=>{
    state.settings.syncEnabled=false;
    save();
    zSetSyncMeta({running:false});
    renderSettings();
  };
};


async function zResumeMicrosoftRedirect(){
  const pending=sessionStorage.getItem(Z_AUTH_RESUME_KEY)==='1';
  const hasResponse=!!(location.hash && /(?:^|#|&)code=|(?:^|#|&)error=/.test(location.hash));
  if(!pending && !hasResponse) return;
  try{
    await zGetMsal();
    const account=zMsalCache?.getAllAccounts?.()[0]||null;
    if(account){
      sessionStorage.removeItem(Z_AUTH_RESUME_KEY);
      zSetSyncMeta({account:account.username||account.name||'',needsLogin:false,lastError:''});
      setTimeout(()=>zRunSync({interactive:false,reason:'retour Microsoft'}),300);
    }
  }catch(err){
    sessionStorage.removeItem(Z_AUTH_RESUME_KEY);
    console.error('Reprise Microsoft',err);
    zSetSyncMeta({lastError:String(err?.message||err),needsLogin:true});
    render();
  }
}
setTimeout(zResumeMicrosoftRedirect,100);

state.version='0.6.0';
state.deleted=zDeletedShape(state.deleted);
zInternalSyncSave=true;
save();
zInternalSyncSave=false;
