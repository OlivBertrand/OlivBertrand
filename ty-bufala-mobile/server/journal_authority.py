"""Immutable Graph inventory and independent encrypted journal floor.

No local file is authoritative. Active segments are checked on every request.
Retired history lives in a complete checkpoint bound to the encrypted vault;
the original segments remain available for an explicit full forensic audit.
"""
import json
import re
import hashlib
import gzip
import io
import sqlite3
from urllib.parse import quote,urlsplit
from .onedrive_store import GraphJournal,RemoteUnavailable,digest
from .oauth_vault import VaultConflict
from .onedrive import GraphError
from .store import canonical


class VerifiedGraphJournal(GraphJournal):
    def __init__(self,graph,drive,folder):
        super().__init__(graph,drive,folder)
        self.view=None
        self.hashes={}
        self.base_sequence=0
        self.base_hash=''

    @staticmethod
    def fingerprint(item):return (item['id'],item['eTag'],item['size'])

    def inventory(self):
        path='drives/'+quote(self.drive,safe='')+'/items/'+quote(self.folder,safe='')+'/children?$select=id,name,eTag,size&$top=200'
        if self.base_sequence:path+='&$orderby=name%20desc'
        result={};pages=0;previous_sequence=None
        while path:
            pages+=1
            if pages>100:raise RemoteUnavailable('Journal trop volumineux : audit requis.')
            try:page=self.graph.call(path)
            except (GraphError,OSError,ValueError):raise RemoteUnavailable('Inventaire OneDrive indisponible ; reprise conservée.') from None
            if not isinstance(page.get('value'),list):raise RemoteUnavailable('Inventaire OneDrive incomplet.')
            boundary=False
            for item in page['value']:
                name=item.get('name','')
                if not name.startswith('transaction-'):continue
                match=re.fullmatch(r'transaction-(\d{12})\.json',name)
                if not match or not item.get('id') or not item.get('eTag') or type(item.get('size')) is not int:
                    raise RemoteUnavailable('Segment OneDrive ambigu ou incomplet.')
                sequence=int(match[1])
                if self.base_sequence:
                    if previous_sequence is not None and sequence>=previous_sequence:raise RemoteUnavailable('Ordre Graph inattendu : reprise bloquée.')
                    previous_sequence=sequence
                    if sequence<=self.base_sequence:boundary=True;break
                if sequence<1 or sequence in result:raise RemoteUnavailable('Segment OneDrive répété.')
                result[sequence]=item
            following=None if boundary else page.get('@odata.nextLink')
            if following:
                parsed=urlsplit(following)
                if parsed.scheme!='https' or parsed.netloc!='graph.microsoft.com' or not parsed.path.startswith('/v1.0/'):
                    raise RemoteUnavailable('Pagination Graph inattendue.')
                path=parsed.path[len('/v1.0/'):]+('?' + parsed.query if parsed.query else '')
            else:path=None
        if result and max(result)-self.base_sequence>20000:raise RemoteUnavailable('Journal trop volumineux : audit requis.')
        if result and sorted(result)!=list(range(self.base_sequence+1,max(result)+1)):
            raise RemoteUnavailable('Segment du journal manquant ; aucune reprise silencieuse.')
        self.view=result
        return result

    def read(self,sequence):
        if self.view is None:return super().read(sequence)
        item=self.view.get(sequence)
        if item is None:return None
        try:
            # The compact directory listing deliberately excludes download URLs.
            # Fetch full metadata only for a new segment, and bind it to the listing.
            full=self.graph.call('drives/'+quote(self.drive,safe='')+'/items/'+quote(item['id'],safe=''))
            if self.fingerprint(full)!=self.fingerprint(item):raise ValueError()
            raw,_=self.graph.download(self.drive,item['id'],metadata=full)
            envelope=json.loads(raw)
            if envelope['sha256']!=digest(envelope['payload']) or envelope['payload']['sequence']!=sequence:
                raise ValueError()
            self.hashes[sequence]=(self.fingerprint(item),envelope['sha256'],envelope['payload']['parent'])
            return envelope
        except (ValueError,KeyError,TypeError,OSError,RuntimeError):
            raise RemoteUnavailable('Segment du journal illisible ou altéré.') from None

    def known_hash(self,sequence):
        if sequence==self.base_sequence:return self.base_hash
        item=(self.view or {}).get(sequence)
        known=self.hashes.get(sequence)
        if item and known and known[0]==self.fingerprint(item):return known[1]
        envelope=self.read(sequence)
        return envelope['sha256'] if envelope else None

    def create(self,sequence,envelope):
        # The post-upload read must see the newly created file, not an old listing.
        self.view=None
        return super().create(sequence,envelope)


class VaultJournalAnchor:
    def __init__(self,vault,drive,folder):
        self.vault=vault
        self.context=drive+':'+folder
        self.key=hashlib.sha256(self.context.encode()).hexdigest()

    def read(self,required=True):
        state,revision=self.vault.read()
        anchor=(state or {}).get('journalAnchors',{}).get(self.key)
        if anchor is None:
            if required:raise RemoteUnavailable('Ancre indépendante absente : préparation opérateur requise.')
            return None
        if anchor.get('context')!=self.context or type(anchor.get('sequence')) is not int or anchor['sequence']<1 or not re.fullmatch(r'[0-9a-f]{64}',str(anchor.get('sha256',''))):
            raise RemoteUnavailable('Ancre du journal invalide.')
        return anchor

    def advance(self,sequence,sha,*,initialize=False):
        for _ in range(3):
            state,revision=self.vault.read()
            if state is None:raise RemoteUnavailable('Coffre absent : journal bloqué.')
            anchors=dict(state.get('journalAnchors',{}));old=anchors.get(self.key)
            if old is None and not initialize:raise RemoteUnavailable('Ancre du journal absente.')
            if old:
                if old.get('context')!=self.context or type(old.get('sequence')) is not int:raise RemoteUnavailable('Ancre du journal invalide.')
                if old['sequence']>sequence:raise RemoteUnavailable('Recul du journal détecté.')
                if old['sequence']==sequence:
                    if old['sha256']!=sha:raise RemoteUnavailable('Empreinte du journal contradictoire.')
                    return
            anchors[self.key]={**(old or {}),'context':self.context,'sequence':sequence,'sha256':sha}
            try:self.vault.write(revision,{**state,'journalAnchors':anchors});return
            except VaultConflict:continue
        raise RemoteUnavailable('Ancre modifiée simultanément : conserver la saisie.')

    def checkpoint(self,pointer):
        for _ in range(3):
            state,revision=self.vault.read();anchors=dict((state or {}).get('journalAnchors',{}));old=anchors.get(self.key)
            if not old or old.get('context')!=self.context or old['sequence']<pointer['sequence']:
                raise RemoteUnavailable('Point de reprise sans ancre durable correspondante.')
            if old['sequence']==pointer['sequence'] and old['sha256']!=pointer['chain_sha256']:
                raise RemoteUnavailable('Point de reprise contradictoire avec le journal.')
            previous=old.get('checkpoint')
            if previous and previous['sequence']>=pointer['sequence']:return previous
            anchors[self.key]={**old,'checkpoint':pointer}
            try:self.vault.write(revision,{**state,'journalAnchors':anchors});return pointer
            except VaultConflict:continue
        raise RemoteUnavailable('Point de reprise modifié simultanément ; conserver la saisie.')


class JournalCheckpoint:
    """Full SQL state, history and receipts; immutable file + encrypted pointer."""
    MAX_COMPRESSED=16*1024*1024
    MAX_RAW=64*1024*1024

    def __init__(self,remote,anchor):self.remote=remote;self.anchor=anchor

    def write(self,db,sequence,chain_hash,previous=None):
        manifest=self.remote.inventory()
        retired=[];expected_sequence=previous['sequence'] if previous else 0;expected_parent=previous['chain_sha256'] if previous else ''
        for seq,item in sorted(manifest.items()):
            if seq<=sequence:
                actual_hash=self.remote.known_hash(seq)
                if seq!=expected_sequence+1 or self.remote.hashes[seq][2]!=expected_parent:
                    raise RemoteUnavailable('Audit avant point de reprise : chaîne historique modifiée.')
                retired.append({'sequence':seq,**{key:item[key] for key in ('id','name','eTag','size')},'sha256':actual_hash})
                expected_sequence=seq;expected_parent=actual_hash
        if expected_sequence!=sequence or expected_parent!=chain_hash:raise RemoteUnavailable('Point de reprise sans chaîne complète.')
        payload={'format':'ty-bufala-journal-checkpoint-v1','sequence':sequence,'chain_sha256':chain_hash,
                 'sql':'\n'.join(db.iterdump()),'retired':retired,'previous':previous}
        raw=canonical(payload).encode()
        if len(raw)>self.MAX_RAW:raise RemoteUnavailable('Point de reprise trop volumineux : archivage contrôlé requis.')
        content=gzip.compress(raw,mtime=0)
        if len(content)>self.MAX_COMPRESSED:raise RemoteUnavailable('Point de reprise trop volumineux.')
        checksum=hashlib.sha256(content).hexdigest();name=f'checkpoint-{sequence:012d}-{checksum[:16]}.json.gz'
        graph=self.remote.graph
        try:
            try:item=graph.upload_new(self.remote.drive,self.remote.folder,name,content)
            except GraphError as error:
                if error.status not in (409,412):raise
                item=graph.call('drives/'+quote(self.remote.drive,safe='')+'/items/'+quote(self.remote.folder,safe='')+':/'+quote(name,safe=''))
            actual,verified=graph.download(self.remote.drive,item['id'])
            if actual!=content:raise RemoteUnavailable('Relecture du point de reprise différente.')
            pointer={'sequence':sequence,'chain_sha256':chain_hash,'id':item['id'],'name':name,'sha256':checksum,'size':len(content),'eTag':verified['eTag']}
            return self.anchor.checkpoint(pointer)
        except (GraphError,OSError,ValueError,KeyError) as error:
            raise RemoteUnavailable('Point de reprise distant non confirmé.') from None

    def validate_pointer(self,pointer):
        try:
            if not isinstance(pointer,dict) or type(pointer['sequence']) is not int or not 1<=pointer['sequence']<10**12:raise ValueError()
            if type(pointer['size']) is not int or not 0<pointer['size']<=self.MAX_COMPRESSED:raise ValueError()
            if any(not isinstance(pointer[key],str) or not pointer[key] or len(pointer[key])>512 for key in ('id','name','eTag')):raise ValueError()
            if any(not re.fullmatch(r'[0-9a-f]{64}',pointer[key]) for key in ('sha256','chain_sha256')):raise ValueError()
        except (ValueError,KeyError,TypeError):raise RemoteUnavailable('Définition du point de reprise invalide.') from None

    def metadata(self,pointer):
        self.validate_pointer(pointer)
        try:
            info=self.remote.graph.call('drives/'+quote(self.remote.drive,safe='')+'/items/'+quote(pointer['id'],safe=''))
            if info['name']!=pointer['name'] or info['size']!=pointer['size'] or info['eTag']!=pointer['eTag'] or not 0<info['size']<=self.MAX_COMPRESSED:raise ValueError()
            parent=info['parentReference']
            if parent['id']!=self.remote.folder or parent['driveId']!=self.remote.drive:raise ValueError()
            return info
        except (GraphError,OSError,ValueError,KeyError,TypeError):
            raise RemoteUnavailable('Point de reprise absent ou modifié : accès bloqué.') from None

    def payload(self,pointer):
        try:
            if type(pointer['sequence']) is not int or pointer['sequence']<1 or not re.fullmatch(r'[0-9a-f]{64}',pointer['sha256']):raise ValueError()
            info=self.metadata(pointer)
            content,_=self.remote.graph.download(self.remote.drive,info['id'],metadata=info)
            if hashlib.sha256(content).hexdigest()!=pointer['sha256']:raise ValueError()
            with gzip.GzipFile(fileobj=io.BytesIO(content)) as source:raw=source.read(self.MAX_RAW+1)
            if len(raw)>self.MAX_RAW:raise ValueError()
            payload=json.loads(raw)
            if payload['format']!='ty-bufala-journal-checkpoint-v1' or payload['sequence']!=pointer['sequence'] or payload['chain_sha256']!=pointer['chain_sha256'] or not isinstance(payload['sql'],str):raise ValueError()
            return payload
        except (GraphError,OSError,ValueError,KeyError,TypeError,EOFError):
            raise RemoteUnavailable('Point de reprise absent ou altéré : aucun repli silencieux.') from None

    def restore(self,pointer):
        payload=self.payload(pointer)
        db=sqlite3.connect(':memory:',check_same_thread=False);db.row_factory=sqlite3.Row
        def authorize(action,first,second,*rest):
            if action in (sqlite3.SQLITE_ATTACH,sqlite3.SQLITE_DETACH,sqlite3.SQLITE_CREATE_VTABLE):return sqlite3.SQLITE_DENY
            if action==sqlite3.SQLITE_FUNCTION and str(second).lower()=='load_extension':return sqlite3.SQLITE_DENY
            if action==sqlite3.SQLITE_PRAGMA and str(first).lower() in ('writable_schema','temp_store_directory','data_store_directory'):return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        try:
            db.set_authorizer(authorize);db.executescript(payload['sql'])
            db.execute('PRAGMA foreign_keys=ON')
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchone():raise ValueError()
            if db.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()[0]!='1':raise ValueError()
            for table in ('users','sessions','devices','login_attempts','records','changes','operations','identities','imports'):
                db.execute('SELECT 1 FROM '+table+' LIMIT 1')
            return db,payload['sequence'],payload['chain_sha256']
        except (sqlite3.Error,ValueError,TypeError):
            db.close();raise RemoteUnavailable('Point de reprise SQL incompatible ou dangereux.') from None

    def audit_archives(self,pointer):
        """Explicit full audit, including original retired SQL, without modifying it."""
        verified=0;visited=set()
        while pointer:
            if pointer['id'] in visited or len(visited)>10000:raise RemoteUnavailable('Chaîne de points de reprise invalide.')
            visited.add(pointer['id']);payload=self.payload(pointer)
            previous=payload.get('previous');sequence=previous['sequence'] if previous else 0;parent=previous['chain_sha256'] if previous else ''
            for item in payload['retired']:
                try:
                    full=self.remote.graph.call('drives/'+quote(self.remote.drive,safe='')+'/items/'+quote(item['id'],safe=''))
                    if self.remote.fingerprint(full)!=self.remote.fingerprint(item):raise ValueError()
                    raw,_=self.remote.graph.download(self.remote.drive,item['id'],metadata=full);envelope=json.loads(raw);body=envelope['payload']
                    if item['sequence']!=sequence+1 or body['sequence']!=item['sequence'] or body['parent']!=parent or digest(body)!=item['sha256'] or envelope['sha256']!=item['sha256']:raise ValueError()
                    sequence=item['sequence'];parent=item['sha256'];verified+=1
                except (GraphError,OSError,ValueError,KeyError,TypeError):raise RemoteUnavailable('Audit : archive historique absente ou modifiée.') from None
            if sequence!=payload['sequence'] or parent!=payload['chain_sha256']:raise RemoteUnavailable('Audit : chaîne historique incomplète.')
            pointer=previous
        return {'checkpoints':len(visited),'segments':verified}
