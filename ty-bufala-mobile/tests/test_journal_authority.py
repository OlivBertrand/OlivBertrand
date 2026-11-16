"""Synthetic Graph metadata contract, independent floor and real thread checks."""
import copy
import hashlib
import json
import threading
from types import SimpleNamespace
import pytest
from server.onedrive_store import GraphJournal,JournalStore,RemoteUnavailable
from server.cached_onedrive_store import CachedJournalStore
from server.journal_authority import VerifiedGraphJournal,VaultJournalAnchor
from server.oauth_vault import VaultConflict
from server.domain import apply_operations
from test_cached_onedrive_store import operation,ACTOR


class Vault:
    def __init__(self):self.state={'schema':1,'oauth':{'preserved':True}};self.revision=0;self.fail=False
    def read(self):return copy.deepcopy(self.state),self.revision
    def write(self,expected,state):
        if self.fail:raise VaultConflict('TEST-ONLY vault unavailable')
        if expected!=self.revision:raise VaultConflict('TEST-ONLY conflict')
        self.state=copy.deepcopy(state);self.revision+=1;return self.revision


class Graph:
    def __init__(self):self.items={};self.token=SimpleNamespace(vault=Vault());self.downloads=0;self.lose=False;self.bad_page=False
    def metadata(self,name):
        raw=self.items[name];return {'id':name,'name':name,'eTag':hashlib.sha256(raw).hexdigest(),'size':len(raw),'@microsoft.graph.downloadUrl':'https://synthetic.invalid/file'}
    def call(self,path,method='GET',body=None):
        if '/children?' in path:
            result={'value':[{key:value for key,value in self.metadata(name).items() if key!='@microsoft.graph.downloadUrl'} for name in sorted(self.items)]}
            if self.bad_page:result['@odata.nextLink']='https://untrusted.invalid/private'
            return result
        name=path.split(':/')[-1] if ':/' in path else path.rsplit('/',1)[-1]
        if name not in self.items:
            from server.onedrive import GraphError
            raise GraphError(404)
        return self.metadata(name)
    def download(self,drive,item,metadata=None):
        self.downloads+=1
        if metadata and '@microsoft.graph.downloadUrl' not in metadata:raise RuntimeError('TEST-ONLY full metadata required')
        actual=self.metadata(item)
        if metadata and actual['eTag']!=metadata['eTag']:raise RuntimeError('TEST-ONLY changed during read')
        return self.items[item],actual
    def upload_new(self,drive,folder,name,content):
        if name in self.items:
            from server.onedrive import GraphError
            raise GraphError(409)
        self.items[name]=content
        if self.lose:self.lose=False;raise OSError('TEST-ONLY response lost')
        return self.metadata(name)


def ready():
    graph=Graph();plain=JournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'),allow_empty=True);plain.initialize()
    db,seq,head=plain._load();db.close()
    anchor=VaultJournalAnchor(graph.token.vault,'TEST-ONLY-drive','TEST-ONLY-folder');anchor.advance(seq,head,initialize=True)
    store=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'));store.initialize()
    return graph,store,anchor


def test_warm_checks_all_old_metadata_without_redownloading_old_sql():
    graph,store,_=ready();apply_operations(store,ACTOR,[operation('first')])
    with store.transaction():pass
    downloads=graph.downloads
    for _ in range(8):
        with store.transaction() as db:assert db.execute('SELECT count(*) AS n FROM records').fetchone()['n']==1
    assert graph.downloads==downloads


def test_old_intermediate_segment_change_is_refused_while_tip_is_unchanged():
    graph,store,_=ready();apply_operations(store,ACTOR,[operation('first')]);apply_operations(store,ACTOR,[operation('next',1,'edited')])
    with store.transaction():pass
    name=GraphJournal.name(1);graph.items[name]+=b' '
    with pytest.raises(RemoteUnavailable):
        with store.transaction():pass


def test_cold_process_refuses_truncated_journal_using_independent_vault_floor():
    graph,store,_=ready();apply_operations(store,ACTOR,[operation('first')])
    del graph.items[GraphJournal.name(2)]
    restarted=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'))
    with pytest.raises(RemoteUnavailable):restarted.initialize()


def test_lost_response_recovered_with_same_receipt_and_anchor_preserves_oauth():
    graph,store,anchor=ready();graph.lose=True
    with pytest.raises(RemoteUnavailable):apply_operations(store,ACTOR,[operation('first')])
    result=apply_operations(store,ACTOR,[operation('first')])
    assert result[0]['revision']==1 and anchor.read()['sequence']==2
    assert graph.token.vault.state['oauth']=={'preserved':True}


def test_anchor_failure_never_acknowledges_or_promotes_unconfirmed_transaction():
    graph,store,_=ready();graph.token.vault.fail=True
    with pytest.raises(RemoteUnavailable):apply_operations(store,ACTOR,[operation('first')])
    graph.token.vault.fail=False
    result=apply_operations(store,ACTOR,[operation('first')]);assert result[0]['revision']==1


def test_cached_database_works_on_different_threads_under_store_mutex():
    graph,store,_=ready();errors=[]
    def work():
        try:
            with store.transaction() as db:assert db.execute('SELECT count(*) AS n FROM records').fetchone()['n']==0
        except Exception as error:errors.append(error)
    threads=[threading.Thread(target=work) for _ in range(4)]
    for thread in threads:thread.start()
    for thread in threads:thread.join(3)
    assert not errors and not any(t.is_alive() for t in threads)


def test_foreign_graph_pagination_and_metadata_holes_are_refused():
    graph,store,_=ready();graph.bad_page=True
    with pytest.raises(RemoteUnavailable):
        with store.transaction():pass
    graph.bad_page=False;graph.items[GraphJournal.name(3)]=graph.items[GraphJournal.name(1)]
    with pytest.raises(RemoteUnavailable):
        with store.transaction():pass
