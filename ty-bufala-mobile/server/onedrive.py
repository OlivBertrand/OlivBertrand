"""Explicit Graph backup job. Never rewrites the source Excel file.
Requires a short-lived Microsoft Graph token supplied securely by the operator.
No OAuth app/permission is created automatically. Not enabled on Render.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, urlopen
from .backup import snapshot
from .store import Store, canonical, utcnow


class GraphError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__("Microsoft Graph indisponible (HTTP " + str(status) + "). Aucun accusé enregistré.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args):return None


class Graph:
    def __init__(self,token):self.token=token

    def call(self,path,method='GET',body=None):
        url='https://graph.microsoft.com/v1.0/'+path.lstrip('/')
        token = self.token() if callable(self.token) else self.token
        headers={'Authorization':'Bearer '+token,'Accept':'application/json'}
        if body is not None:headers['Content-Type']='application/json'
        request=Request(url,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try:
            with build_opener(NoRedirect()).open(request,timeout=30) as response:return json.load(response)
        except HTTPError as error:
            raise GraphError(error.code) from None

    def download(self,drive,item):
        info=self.call('drives/'+quote(drive,safe='')+'/items/'+quote(item,safe=''))
        url=info.get('@microsoft.graph.downloadUrl','')
        if urlsplit(url).scheme!='https':raise RuntimeError('URL de téléchargement privée absente')
        # Preauthenticated URL; NEVER forward the Graph bearer token to its storage host.
        with urlopen(Request(url),timeout=60) as response:content=response.read()
        after=self.call('drives/'+quote(drive,safe='')+'/items/'+quote(item,safe=''))
        if after.get('eTag')!=info.get('eTag'):raise RuntimeError('Fichier modifié pendant la lecture : recommencer')
        return content,after

    def upload_new(self,drive,folder,name,content):
        prefix='drives/'+quote(drive,safe='')+'/items/'+quote(folder,safe='')
        session=self.call(prefix+':/'+quote(name,safe='')+':/createUploadSession','POST',{'item':{'@microsoft.graph.conflictBehavior':'fail','name':name}})
        url=session.get('uploadUrl','')
        if urlsplit(url).scheme!='https':raise RuntimeError('Session de dépôt Microsoft absente')
        # Resumable 320-KiB-aligned chunks. A failed run leaves no local success receipt.
        result=None
        for offset in range(0,len(content),327680):
            part=content[offset:offset+327680]
            request=Request(url,data=part,method='PUT',headers={'Content-Length':str(len(part)),'Content-Range':f'bytes {offset}-{offset+len(part)-1}/{len(content)}'})
            try:
                with urlopen(request,timeout=60) as response:result=json.load(response)
            except HTTPError as error:
                raise GraphError(error.code) from None
        if not result or not result.get('id'):raise RuntimeError('Dépôt incomplet')
        verified,metadata=self.download(drive,result['id'])
        if hashlib.sha256(verified).digest()!=hashlib.sha256(content).digest():raise RuntimeError('Vérification du fichier distant échouée')
        return metadata


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['download-source','backup'])
    p.add_argument('--drive',required=True);p.add_argument('--item');p.add_argument('--folder');p.add_argument('--output',type=Path)
    a=p.parse_args();graph=Graph(os.environ['MS_GRAPH_ACCESS_TOKEN'])
    if a.action=='download-source':
        if not a.item or not a.output:p.error('--item et --output requis')
        content,meta=graph.download(a.drive,a.item);a.output.write_bytes(content);os.chmod(a.output,0o600)
        a.output.with_suffix(a.output.suffix+'.source.json').write_text(canonical({'id':meta['id'],'eTag':meta.get('eTag'),'sha256':hashlib.sha256(content).hexdigest(),'downloadedAt':utcnow()}),encoding='utf-8')
    else:
        if not a.folder:p.error('--folder privé de sauvegardes requis')
        store=Store(os.environ['DATABASE_URL']);pack=snapshot(store);content=canonical(pack).encode()
        digest=hashlib.sha256(content).hexdigest();name='ty-bufala-'+pack['exportedAt'].replace(':','-')+'-'+digest[:12]+'.json'
        meta=graph.upload_new(a.drive,a.folder,name,content)
        # Receipt includes the exact remotely verified hash. Kept in the private DB.
        with store.transaction(write=True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS backup_receipts (digest TEXT PRIMARY KEY, remote_id TEXT NOT NULL, etag TEXT NOT NULL, verified_at TEXT NOT NULL)')
            db.execute('INSERT INTO backup_receipts(digest,remote_id,etag,verified_at) VALUES (?,?,?,?)',(digest,meta['id'],meta.get('eTag',''),utcnow()))
    print('Fichier privé vérifié. Aucun classeur source modifié.')


if __name__=='__main__':main()
