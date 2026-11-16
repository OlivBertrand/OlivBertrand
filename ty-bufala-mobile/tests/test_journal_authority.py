"""Synthetic Graph metadata contract, independent floor and real thread checks."""
import copy
import hashlib
import json
import threading
import gzip
from types import SimpleNamespace
import pytest
from server.onedrive_store import GraphJournal,JournalStore,RemoteUnavailable
from server.cached_onedrive_store import CachedJournalStore
from server.journal_authority import VerifiedGraphJournal,VaultJournalAnchor,JournalCheckpoint
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
        raw=self.items[name];return {'id':name,'name':name,'eTag':hashlib.sha256(raw).hexdigest(),'size':len(raw),'@microsoft.graph.downloadUrl':'https://synthetic.invalid/file','parentReference':{'id':'TEST-ONLY-folder','driveId':'TEST-ONLY-drive'}}
    def call(self,path,method='GET',body=None):
        if '/children?' in path:
            names=sorted(self.items,reverse='$orderby=name%20desc' in path)
            result={'value':[{key:value for key,value in self.metadata(name).items() if key!='@microsoft.graph.downloadUrl'} for name in names]}
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


def checkpoint_ready():
    graph,store,anchor=ready();store.checkpoint_interval=3
    apply_operations(store,ACTOR,[operation('first')])
    apply_operations(store,ACTOR,[operation('second',1,'second')])
    return graph,store,anchor


def test_checkpoint_cold_restart_keeps_all_history_receipts_and_original_archives():
    graph,store,anchor=checkpoint_ready();pointer=anchor.read()['checkpoint']
    assert pointer['sequence']==3
    downloads=graph.downloads
    cold=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'));cold.initialize()
    assert graph.downloads-downloads<=2
    with cold.transaction() as db:
        assert db.execute('SELECT count(*) AS n FROM changes').fetchone()['n']==2
        assert db.execute('SELECT count(*) AS n FROM operations').fetchone()['n']==2
    assert all(GraphJournal.name(seq) in graph.items for seq in range(1,4))
    assert cold.checkpointer.audit_archives(pointer)=={'checkpoints':1,'segments':3}


def test_checkpoint_change_is_refused_even_with_ram_and_without_fallback():
    graph,store,anchor=checkpoint_ready();pointer=anchor.read()['checkpoint'];graph.items[pointer['id']]+=b'corrupt'
    with pytest.raises(RemoteUnavailable):
        with store.transaction():pass
    cold=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'))
    with pytest.raises(RemoteUnavailable):cold.initialize()


def test_retired_archive_cannot_change_anchored_history_and_remains_auditable():
    graph,store,anchor=checkpoint_ready();pointer=anchor.read()['checkpoint'];graph.items[GraphJournal.name(1)]+=b' '
    cold=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'));cold.initialize()
    with cold.transaction() as db:assert db.execute('SELECT count(*) AS n FROM changes').fetchone()['n']==2
    with pytest.raises(RemoteUnavailable):cold.checkpointer.audit_archives(pointer)


def test_post_checkpoint_tail_truncation_is_refused_after_process_restart():
    graph,store,anchor=checkpoint_ready();apply_operations(store,ACTOR,[operation('third',2,'third')])
    del graph.items[GraphJournal.name(4)]
    cold=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'))
    with pytest.raises(RemoteUnavailable):cold.initialize()


@pytest.mark.parametrize('existing_status',[409,412])
def test_lost_checkpoint_reply_reuses_one_file_and_keeps_original_receipt(existing_status):
    graph,store,anchor=ready();store.checkpoint_interval=2;original=graph.upload_new;lost=[]
    def upload(drive,folder,name,content):
        if name.startswith('checkpoint-') and name in graph.items:
            from server.onedrive import GraphError
            raise GraphError(existing_status)
        item=original(drive,folder,name,content)
        if name.startswith('checkpoint-') and not lost:lost.append(True);raise OSError('TEST-ONLY lost checkpoint response')
        return item
    graph.upload_new=upload
    with pytest.raises(RemoteUnavailable):apply_operations(store,ACTOR,[operation('first')])
    receipt=apply_operations(store,ACTOR,[operation('first')]);assert receipt[0]['revision']==1
    assert len([name for name in graph.items if name.startswith('checkpoint-')])==1
    assert anchor.read()['checkpoint']['sequence']==2


def test_successive_checkpoints_preserve_all_receipts_and_audit_chain():
    graph,store,anchor=checkpoint_ready()
    for number in range(3,6):
        apply_operations(store,ACTOR,[operation('op'+str(number),number-1,str(number))])
        assert anchor.read()['checkpoint']['sequence']==(3 if number<5 else 6)
    pointer=anchor.read()['checkpoint'];assert pointer['sequence']==6
    cold=CachedJournalStore(GraphJournal(graph,'TEST-ONLY-drive','TEST-ONLY-folder'));cold.initialize()
    with cold.transaction() as db:
        assert db.execute('SELECT count(*) AS n FROM changes').fetchone()['n']==5
        assert db.execute('SELECT count(*) AS n FROM operations').fetchone()['n']==5
    assert cold.checkpointer.audit_archives(pointer)=={'checkpoints':2,'segments':6}
    assert apply_operations(cold,ACTOR,[operation('first')])[0]['revision']==1


def test_snapshot_sql_cannot_attach_a_database_even_if_operator_vouches_payload():
    graph,store,anchor=checkpoint_ready();pointer=copy.deepcopy(anchor.read()['checkpoint'])
    payload=json.loads(gzip.decompress(graph.items[pointer['id']]))
    payload['sql']+="\nATTACH DATABASE ':memory:' AS forbidden;"
    content=gzip.compress(json.dumps(payload).encode(),mtime=0);graph.items[pointer['id']]=content
    pointer.update(sha256=hashlib.sha256(content).hexdigest(),size=len(content),eTag=graph.metadata(pointer['id'])['eTag'])
    with pytest.raises(RemoteUnavailable):store.checkpointer.restore(pointer)


def test_oversized_checkpoint_never_returns_an_acknowledgement():
    graph,store,anchor=ready();store.checkpoint_interval=2;store.checkpointer.MAX_RAW=10
    with pytest.raises(RemoteUnavailable):apply_operations(store,ACTOR,[operation('first')])
    store.checkpointer.MAX_RAW=64*1024*1024
    receipt=apply_operations(store,ACTOR,[operation('first')]);assert receipt[0]['revision']==1


def test_malformed_checkpoint_pointer_fails_closed_with_storage_error():
    graph,store,anchor=checkpoint_ready()
    graph.token.vault.state['journalAnchors'][anchor.key]['checkpoint']={'sequence':'invalid'}
    with pytest.raises(RemoteUnavailable):
        with store.transaction():pass
    graph.bad_page=False;graph.items[GraphJournal.name(3)]=graph.items[GraphJournal.name(1)]
    with pytest.raises(RemoteUnavailable):
        with store.transaction():pass
