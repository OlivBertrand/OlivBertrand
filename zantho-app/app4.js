function mergeById(localArr=[],remoteArr=[]){
  const map=new Map();
  const put=(x)=>{
    if(!x?.id) return;
    const prev=map.get(x.id);
    if(!prev){ map.set(x.id,x); return; }
    const ta=new Date(prev.updatedAt||prev.createdAt||0).getTime();
    const tb=new Date(x.updatedAt||x.createdAt||0).getTime();
    if(tb>=ta) map.set(x.id,x);
  };
  localArr.forEach(put); remoteArr.forEach(put);
  return [...map.values()];
}
function mergeHarvests(localArr=[],remoteArr=[]){
  const merged=mergeById(localArr,remoteArr);
  return merged.map(h=>{
    const l=localArr.find(x=>x.id===h.id), r=remoteArr.find(x=>x.id===h.id);
    if(l&&r) return {...h,sessions:mergeById(l.sessions||[],r.sessions||[])};
    return h;
  });
}
function mergeStates(local,remote){
  const localSettings=local.settings||{};
  const remoteNewer=new Date(remote.updatedAt||0)>new Date(local.updatedAt||0);
  const merged={...local,...(remoteNewer?remote:{}),version:APP_VERSION};
  merged.planConfigured=!!(local.planConfigured||remote.planConfigured);
  merged.plan=remoteNewer && remote.planConfigured ? remote.plan : local.plan;
  merged.plants=remoteNewer && remote.plants?.length ? remote.plants : local.plants;
  merged.observations=mergeById(local.observations,remote.observations);
  merged.harvests=mergeHarvests(local.harvests,remote.harvests);
  merged.transformations=mergeById(local.transformations,remote.transformations);
  merged.tastings=mergeById(local.tastings,remote.tastings);
  merged.photoRefs=mergeById(local.photoRefs||[],remote.photoRefs||[]);
  merged.settings={...(remote.settings||{}),...localSettings};
  merged.updatedAt=new Date(Math.max(new Date(local.updatedAt||0),new Date(remote.updatedAt||0))).toISOString();
  return merged;
}

async function syncOneDrive(){
  const msg=document.querySelector('#syncMsg');
  if(!state.settings.clientId){ msg.textContent='Renseigne d’abord le Client ID Microsoft.'; return; }
  if(!navigator.onLine){ msg.textContent='Pas de connexion réseau.'; return; }
  try{
    msg.textContent='Connexion Microsoft…';
    const {PublicClientApplication}=await import('https://cdn.jsdelivr.net/npm/@azure/msal-browser@5/+esm');
    const redirectUri=location.origin+location.pathname;
    const msal=new PublicClientApplication({auth:{clientId:state.settings.clientId,authority:'https://login.microsoftonline.com/common',redirectUri},cache:{cacheLocation:'localStorage'}});
    await msal.initialize();
    let account=msal.getAllAccounts()[0];
    if(!account){ const login=await msal.loginPopup({scopes:['Files.ReadWrite','User.Read']}); account=login.account; }
    const token=(await msal.acquireTokenSilent({account,scopes:['Files.ReadWrite','User.Read']}).catch(()=>msal.acquireTokenPopup({account,scopes:['Files.ReadWrite','User.Read']}))).accessToken;

    msg.textContent='Préparation du dossier OneDrive…';
    const folder=state.settings.oneDriveFolder.split('/').filter(Boolean);
    await ensureFolders(token,folder);
    const jsonPath=[...folder,'zantho-data.json'].map(encodeURIComponent).join('/');

    const localPhotos=await getAllPhotos();
    const localRefs=localPhotos.map(p=>({id:p.id,plantId:p.plantId,name:p.name,type:p.type,note:p.note,createdAt:p.createdAt,updatedAt:p.createdAt,drivePath:p.drivePath||null}));
    state.photoRefs=mergeById(state.photoRefs||[],localRefs);

    const remoteResp=await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${jsonPath}:/content`,{headers:{Authorization:`Bearer ${token}`}});
    if(remoteResp.ok){
      state=mergeStates(state,await remoteResp.json());
    }else if(remoteResp.status!==404){
      throw new Error(`Lecture données OneDrive: ${remoteResp.status}`);
    }

    const photoFolder=[...folder,'photos'];
    await ensureFolders(token,photoFolder);

    let pulled=0;
    for(const ref of state.photoRefs||[]){
      if(!ref.drivePath) continue;
      if(await getPhoto(ref.id)) continue;
      const encoded=ref.drivePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
      const resp=await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${encoded}:/content`,{headers:{Authorization:`Bearer ${token}`}});
      if(!resp.ok) continue;
      const blob=await resp.blob();
      await putPhoto({id:ref.id,plantId:ref.plantId,blob,name:ref.name||'photo.jpg',type:ref.type||blob.type||'image/jpeg',note:ref.note||'',createdAt:ref.createdAt||nowISO(),synced:true,drivePath:ref.drivePath});
      pulled++;
    }

    const photos=await getAllPhotos();
    let done=0;
    for(const p of photos){
      if(p.synced && p.drivePath){ done++; continue; }
      const ext=(p.type||'image/jpeg').includes('png')?'png':'jpg';
      const fileName=`${p.id}.${ext}`;
      const plainPath=[...photoFolder,fileName].join('/');
      const encodedPath=[...photoFolder,fileName].map(encodeURIComponent).join('/');
      const up=await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':p.type||'image/jpeg'},body:p.blob});
      if(up.ok){
        p.synced=true; p.drivePath=plainPath; await putPhoto(p);
        const updatedAt=nowISO();
        state.photoRefs=mergeById(state.photoRefs||[],[{id:p.id,plantId:p.plantId,name:p.name,type:p.type,note:p.note,createdAt:p.createdAt,updatedAt,drivePath:plainPath}]);
      }
      done++;
      msg.textContent=`Synchronisation photos ${done}/${photos.length}…`;
    }

    state.settings.lastSync=nowISO();
    state.settings.syncEnabled=true;
    save();
    const r=await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${jsonPath}:/content`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(state,null,2)});
    if(!r.ok) throw new Error(`Écriture données: ${r.status}`);
    msg.textContent=`Synchronisation terminée · ${photos.length} photo(s) locale(s), ${pulled} récupérée(s).`;
    render();
  }catch(err){
    console.error(err);
    msg.textContent=`Échec de synchronisation : ${err.message}`;
  }
}

async function graphGet(token,path){
  return fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${path}`,{headers:{Authorization:`Bearer ${token}`}});
}
async function ensureFolders(token,parts){
  let parentId='root'; let built=[];
  for(const part of parts){
    built.push(part);
    const path=built.map(encodeURIComponent).join('/');
    const exists=await graphGet(token,path);
    if(exists.ok){ parentId=(await exists.json()).id; continue; }
    const endpoint=parentId==='root'?'https://graph.microsoft.com/v1.0/me/drive/root/children':`https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`;
    const r=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:part,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});
    if(!r.ok && r.status!==409) throw new Error(`Création dossier ${part}: ${r.status}`);
    if(r.ok) parentId=(await r.json()).id;
    else { const retry=await graphGet(token,path); parentId=(await retry.json()).id; }
  }
}

// The current entry page renders after the later view modules have loaded.
