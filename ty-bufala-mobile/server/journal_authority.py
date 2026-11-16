"""Immutable Graph inventory and independent encrypted journal floor.

No local file is authoritative. Every transaction checks all remote segment
identities, including old segments, and the floor held in the private vault.
"""
import json
import re
import hashlib
from urllib.parse import quote,urlsplit
from .onedrive_store import GraphJournal,RemoteUnavailable,digest
from .oauth_vault import VaultConflict


class VerifiedGraphJournal(GraphJournal):
    def __init__(self,graph,drive,folder):
        super().__init__(graph,drive,folder)
        self.view=None
        self.hashes={}

    @staticmethod
    def fingerprint(item):return (item['id'],item['eTag'],item['size'])

    def inventory(self):
        path='drives/'+quote(self.drive,safe='')+'/items/'+quote(self.folder,safe='')+'/children?$select=id,name,eTag,size&$top=200'
        result={};pages=0
        while path:
            pages+=1
            if pages>100:raise RemoteUnavailable('Journal trop volumineux : audit requis.')
            page=self.graph.call(path)
            if not isinstance(page.get('value'),list):raise RemoteUnavailable('Inventaire OneDrive incomplet.')
            for item in page['value']:
                name=item.get('name','')
                if not name.startswith('transaction-'):continue
                match=re.fullmatch(r'transaction-(\d{12})\.json',name)
                if not match or not item.get('id') or not item.get('eTag') or type(item.get('size')) is not int:
                    raise RemoteUnavailable('Segment OneDrive ambigu ou incomplet.')
                sequence=int(match[1])
                if sequence<1 or sequence in result:raise RemoteUnavailable('Segment OneDrive répété.')
                result[sequence]=item
            following=page.get('@odata.nextLink')
            if following:
                parsed=urlsplit(following)
                if parsed.scheme!='https' or parsed.netloc!='graph.microsoft.com' or not parsed.path.startswith('/v1.0/'):
                    raise RemoteUnavailable('Pagination Graph inattendue.')
                path=parsed.path[len('/v1.0/'):]+('?' + parsed.query if parsed.query else '')
            else:path=None
        if result and max(result)>20000:raise RemoteUnavailable('Journal trop volumineux : audit requis.')
        if result and sorted(result)!=list(range(1,max(result)+1)):
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
            self.hashes[sequence]=(self.fingerprint(item),envelope['sha256'])
            return envelope
        except (ValueError,KeyError,TypeError,OSError,RuntimeError):
            raise RemoteUnavailable('Segment du journal illisible ou altéré.') from None

    def known_hash(self,sequence):
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
            anchors[self.key]={'context':self.context,'sequence':sequence,'sha256':sha}
            try:self.vault.write(revision,{**state,'journalAnchors':anchors});return
            except VaultConflict:continue
        raise RemoteUnavailable('Ancre modifiée simultanément : conserver la saisie.')
