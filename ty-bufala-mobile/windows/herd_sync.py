"""Herd sync adapter for an EXISTING SQLite connection factory, stdlib only.

No second business database, no automatic production migration. The host must
explicitly initialize these prefixed tables on a reviewed development copy.
Transport credentials live in memory, never in SQLite or logs.
"""
import json
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
from http.cookiejar import CookieJar

KINDS=('animals','events','sales','labelDefinitions','animalLabelAssignments','herdGroups','animalGroupAssignments')


class SyncError(Exception):
    def __init__(self,message,status=0,details=None):
        super().__init__(message);self.status=status;self.details=details or {}


class RemoteAPI:
    def __init__(self,base_url):
        if not base_url.startswith('https://'):
            raise ValueError('HTTPS obligatoire.')
        self.base=base_url.rstrip('/')+'/api/';self.csrf='';self.user=None
        self.opener=build_opener(HTTPCookieProcessor(CookieJar()))

    def request(self,path,payload=None):
        req=Request(self.base+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-CSRF-Token':self.csrf},method='GET' if payload is None else 'POST')
        try:
            with self.opener.open(req,timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            data=json.load(error)
            raise SyncError(data.get('error','Requête refusée'),error.code,data) from None

    def login(self,username,password):
        session=self.request('login',{'username':username,'password':password})
        self.user=session['user'];self.csrf=session['csrf'];return self.user


class HerdSync:
    def __init__(self,connect,transport,user):
        self.connect=connect;self.transport=transport;self.user=user;self.lock=threading.RLock();self.running=False;self.error=''

    @contextmanager
    def transaction(self):
        db=self.connect()
        try:
            db.execute('BEGIN IMMEDIATE');yield db;db.commit()
        except BaseException:
            db.rollback();raise
        finally:
            db.close()

    def initialize_development(self):
        with self.transaction() as db:
            db.execute('CREATE TABLE IF NOT EXISTS tb_mobile_records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id))')
            db.execute('CREATE TABLE IF NOT EXISTS tb_mobile_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,blocked TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS tb_mobile_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS tb_mobile_receipts(op_id TEXT PRIMARY KEY,data TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS tb_mobile_conflicts(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS tb_mobile_history(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,id TEXT,data TEXT NOT NULL)')
            account=db.execute("SELECT value FROM tb_mobile_meta WHERE key='account'").fetchone()
            if account and account[0]!=self.user['id']:
                raise ValueError('Ce cache appartient à un autre compte ; rapprochement requis.')
            db.execute("INSERT OR IGNORE INTO tb_mobile_meta VALUES ('account',?)",(self.user['id'],))
            db.execute("INSERT OR IGNORE INTO tb_mobile_meta VALUES ('device',?)",('windows_'+uuid.uuid4().hex,))

    def records(self,kind):
        if kind not in KINDS:raise ValueError('Type inconnu.')
        with self.transaction() as db:
            return [json.loads(r[0]) for r in db.execute('SELECT data FROM tb_mobile_records WHERE kind=? ORDER BY id',(kind,))]

    def pending(self):
        with self.transaction() as db:
            return [{'id':r[0],'operations':json.loads(r[1]),'blocked':json.loads(r[2]) if r[2] else None} for r in db.execute('SELECT id,payload,blocked FROM tb_mobile_outbox ORDER BY seq')]

    def save(self,records):
        if self.user['role'] not in ('editor','admin'):raise ValueError('Compte en lecture seule.')
        if not 1<=len(records)<=100:raise ValueError('Lot limité à 100 opérations.')
        keys=[(r['kind'],r['data']['id']) for r in records]
        if len(set(keys))!=len(keys):raise ValueError('Même fiche répétée dans le lot.')
        with self.lock,self.transaction() as db:
            if db.execute('SELECT 1 FROM tb_mobile_outbox WHERE blocked IS NOT NULL LIMIT 1').fetchone():raise ValueError('Résoudre le conflit avant une nouvelle saisie.')
            operations=[]
            for record in records:
                kind=record['kind'];data=dict(record['data'])
                if kind not in KINDS:raise ValueError('Type inconnu.')
                old=db.execute('SELECT data FROM tb_mobile_records WHERE kind=? AND id=?',(kind,data['id'])).fetchone()
                previous=json.loads(old[0]) if old else {}
                revision=data.get('_localRevision',data.get('revision',0))
                current_revision=previous.get('_localRevision',previous.get('revision',0))
                if revision!=current_revision:
                    raise ValueError('Cette fiche a été actualisée depuis son ouverture. Recharger et comparer avant d’enregistrer.')
                clean={k:v for k,v in data.items() if k not in ('_localRevision','_sync','revision','author','changedAt','deviceId')}
                device=db.execute("SELECT value FROM tb_mobile_meta WHERE key='device'").fetchone()[0]
                operations.append({'opId':'op_'+uuid.uuid4().hex,'deviceId':device,'kind':kind,'baseRevision':revision,'data':clean})
                local={**data,'_localRevision':revision+1,'_sync':'pending'}
                db.execute('INSERT OR REPLACE INTO tb_mobile_records VALUES (?,?,?)',(kind,data['id'],json.dumps(local)))
                db.execute('INSERT INTO tb_mobile_history(kind,id,data) VALUES (?,?,?)',(kind,data['id'],json.dumps(local)))
            batch='batch_'+uuid.uuid4().hex
            db.execute('INSERT INTO tb_mobile_outbox(id,payload) VALUES (?,?)',(batch,json.dumps(operations)))
        return batch

    def sync(self):
        with self.lock:
            self.running=True;self.error=''
            try:
                session=self.transport.request('session')
                if session['user']['id']!=self.user['id']:raise ValueError('Le compte distant a changé.')
                if hasattr(self.transport,'csrf'):self.transport.csrf=session['csrf']
                for batch in self.pending():
                    if batch['blocked']:break
                    try:receipts=self.transport.request('sync',{'operations':batch['operations']})['receipts']
                    except SyncError as error:
                        if error.status in (409,422):
                            with self.transaction() as db:db.execute('UPDATE tb_mobile_outbox SET blocked=? WHERE id=?',(json.dumps({**error.details,'status':error.status}),batch['id']))
                        raise
                    expected={(o['opId'],o['kind'],o['data']['id']) for o in batch['operations']}
                    received={(r.get('opId'),r.get('kind'),r.get('id')) for r in receipts}
                    if received!=expected or len(receipts)!=len(batch['operations']):
                        raise ValueError('Accusés incomplets : lot conservé dans la file locale.')
                    # Receipts and queue removal commit together, after the server confirmed.
                    with self.transaction() as db:
                        later=[json.loads(r[0]) for r in db.execute('SELECT payload FROM tb_mobile_outbox WHERE id<>?',(batch['id'],))]
                        pending={(o['kind'],o['data']['id']) for group in later for o in group}
                        for receipt in receipts:
                            db.execute('INSERT OR REPLACE INTO tb_mobile_receipts VALUES (?,?)',(receipt['opId'],json.dumps(receipt)))
                            if (receipt['kind'],receipt['id']) not in pending:
                                data={**receipt['data'],'_sync':'shared'}
                                db.execute('INSERT OR REPLACE INTO tb_mobile_records VALUES (?,?,?)',(receipt['kind'],receipt['id'],json.dumps(data)))
                        db.execute('DELETE FROM tb_mobile_outbox WHERE id=?',(batch['id'],))
                self.pull()
                with self.transaction() as db:db.execute("INSERT OR REPLACE INTO tb_mobile_meta VALUES ('lastConfirmed',?)",(datetime.now(timezone.utc).isoformat(),))
            except Exception as error:
                self.error=str(error)
            finally:self.running=False

    def pull(self):
        with self.transaction() as db:
            row=db.execute("SELECT value FROM tb_mobile_meta WHERE key='cursor'").fetchone();cursor=int(row[0]) if row else 0
        while True:
            result=self.transport.request('changes?after='+str(cursor))
            with self.transaction() as db:
                batches=[json.loads(r[0]) for r in db.execute('SELECT payload FROM tb_mobile_outbox')]
                pending={(o['kind'],o['data']['id']) for batch in batches for o in batch}
                for change in result['changes']:
                    if change['kind'] not in KINDS:raise ValueError('Version du client trop ancienne : type inconnu.')
                    data={**change['data'],'_sync':'shared'}
                    db.execute('INSERT INTO tb_mobile_history(kind,id,data) VALUES (?,?,?)',(change['kind'],data['id'],json.dumps(data)))
                    if (change['kind'],data['id']) not in pending:db.execute('INSERT OR REPLACE INTO tb_mobile_records VALUES (?,?,?)',(change['kind'],data['id'],json.dumps(data)))
                cursor=result['cursor'];db.execute("INSERT OR REPLACE INTO tb_mobile_meta VALUES ('cursor',?)",(str(cursor),))
            if not result['hasMore']:break

    def status(self):
        with self.transaction() as db:confirmed=db.execute("SELECT value FROM tb_mobile_meta WHERE key='lastConfirmed'").fetchone()
        queue=self.pending();count=sum(len(x['operations']) for x in queue)
        return 'Conflit à résoudre' if any(x['blocked'] for x in queue) else 'Synchronisation en cours' if self.running else 'Erreur : '+self.error if self.error else f'{count} opération(s) enregistrée(s) localement, en attente' if count else 'Base commune confirmée — copie locale disponible' if confirmed else 'Copie locale — première synchronisation à effectuer'

    def keep_remote(self,batch_id):
        """Explicit human choice after comparing the conflict; archive abandoned groups."""
        with self.lock:
            batches=self.pending();target=next((b for b in batches if b['id']==batch_id),None)
            if not target or not target['blocked']:raise ValueError('Conflit introuvable.')
            keys={(o['kind'],o['data']['id']) for o in target['operations']};removed=[]
            for batch in batches:
                if any((o['kind'],o['data']['id']) in keys for o in batch['operations']):
                    removed.append(batch);keys.update((o['kind'],o['data']['id']) for o in batch['operations'])
            from urllib.parse import quote
            remote={(kind,id):self.transport.request('record/'+kind+'/'+quote(id,safe=''))['data'] for kind,id in keys}
            with self.transaction() as db:
                db.execute('INSERT INTO tb_mobile_conflicts VALUES (?,?)',('conflict_'+uuid.uuid4().hex,json.dumps({'choice':'remote','batches':removed})))
                for batch in removed:db.execute('DELETE FROM tb_mobile_outbox WHERE id=?',(batch['id'],))
                for (kind,id),data in remote.items():
                    if data:db.execute('INSERT OR REPLACE INTO tb_mobile_records VALUES (?,?,?)',(kind,id,json.dumps({**data,'_sync':'shared'})))
                    else:db.execute('DELETE FROM tb_mobile_records WHERE kind=? AND id=?',(kind,id))
            self.error=''

    def assign_labels(self,animal_ids,label_id,complete=False,remove=False,due_date='',note=''):
        """Local batches of <=25 targets; retry skips already satisfied assignments."""
        if label_id not in {x['id'] for x in self.records('labelDefinitions')}:raise ValueError('Étiquette inconnue.')
        ids=list(dict.fromkeys(animal_ids));saved=0
        for offset in range(0,len(ids),25):
            changes=[];rows=self.records('animalLabelAssignments');at=datetime.now(timezone.utc).isoformat()
            for id in ids[offset:offset+25]:
                previous=next((x for x in rows if x['animalId']==id and x['labelId']==label_id and not x.get('completedAt')),None)
                if complete or remove:
                    if previous:changes.append({'kind':'animalLabelAssignments','data':{**previous,'completedAt':at,'completionReason':'removed' if remove else 'done'}})
                elif not previous:changes.append({'kind':'animalLabelAssignments','data':{'id':'label_assignment_'+uuid.uuid4().hex,'animalId':id,'labelId':label_id,'assignedAt':at,'dueDate':due_date,'note':note}})
            try:
                if changes:self.save(changes);saved+=len(changes)
            except Exception as error:raise ValueError(f'{saved} affectation(s) enregistrées localement ; lot suivant non enregistré : {error}') from None
        return saved
