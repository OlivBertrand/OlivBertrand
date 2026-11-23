// The existing registered root URI remains the Microsoft redirect destination.
// Application data and MSAL processing live on app.html, outside this bridge.
export async function routeMicrosoftReturn({currentLocation=location,storage=sessionStorage,documentRef=document,loadBridge=()=>import('https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.29.0/redirect-bridge/+esm')}={}){
  const params=new URLSearchParams(currentLocation.hash.slice(1)||currentLocation.search.slice(1));
  if(!params.has('code')&&!params.has('error')){
    currentLocation.replace(new URL('./app.html',currentLocation.href).href);
    return {status:'opened_app'};
  }
  // Never retain the raw response, authorization code, account or token.
  const error=params.get('error')||'';
  const code=/^[a-z_]{1,64}$/.test(error)?error:'';
  const aadsts=[...new Set((params.get('error_description')||'').slice(0,4096).match(/\bAADSTS\d{4,12}\b/g)||[])].slice(0,10);
  try{storage.setItem('zantho-auth-diagnostic-v1',JSON.stringify({code,aadsts}));}catch{}
  try{
    const {broadcastResponseToMainFrame}=await loadBridge();
    await broadcastResponseToMainFrame();
    return {status:'forwarded_response'};
  }catch{
    const label=documentRef.getElementById('authStatus');
    if(label)label.textContent='Connexion Microsoft interrompue. Vous pouvez rouvrir Zantho ; vos données locales sont conservées.';
    return {status:'interrupted'};
  }
}
if(typeof window!=='undefined')routeMicrosoftReturn();
