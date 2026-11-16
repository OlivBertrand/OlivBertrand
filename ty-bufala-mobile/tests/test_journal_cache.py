import copy
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.journal_cache import JournalReplayCache

class RemoteError(Exception):
    pass

class Remote:
    def __init__(self):
        self.items={}
        self.read_count=0
    def read(self,sequence):
        self.read_count+=1
        return copy.deepcopy(self.items.get(sequence))
    def create(self,sequence,statements):
        parent=self.items[sequence-1]['sha256'] if sequence>1 else ''
        payload={'format':'ty-bufala-sql-journal-v1','sequence':sequence,'parent':parent,'statements':statements}
        self.items[sequence]={'payload':payload,'sha256':sha(payload)}
        return self.items[sequence]['sha256']

def sha(payload):
    return hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def bootstrap(remote):
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    seq=0; previous=''
    while (env:=remote.read(seq+1)) is not None:
        statements, following=JournalReplayCache.verify(env,seq+1,previous,sha,RemoteError)
        for sql,params in statements: db.execute(sql,params)
        db.commit()
        seq+=1; previous=following
    if not seq: raise RemoteError('missing source')
    return db,seq,previous

def begin(cache,remote):
    return cache.snapshot(remote, lambda:bootstrap(remote),sha,RemoteError)

def publish(cache,remote,sql,params):
    db,seq,_=begin(cache,remote)
    db.execute(sql,params);db.commit()
    marker=remote.create(seq+1,[[sql,list(params)]])
    cache.committed(db,seq+1,marker)

@pytest.fixture
def ready():
    remote=Remote();remote.create(1,[["CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT NOT NULL)",[]]])
    return remote

def test_linear_reads_not_quadratic(ready):
    cache=JournalReplayCache()
    for i in range(1,41):
        publish(cache,ready,'INSERT INTO items(id,value) VALUES (?,?)',(i,'x'))
    assert ready.read_count <= 125, ready.read_count
    db,seq,_=begin(cache,ready)
    assert seq==41 and db.execute('SELECT COUNT(*) FROM items').fetchone()[0]==40
    db.close()

def test_new_instance_reconstructs_and_catches_external_commits(ready):
    alice,bob=JournalReplayCache(),JournalReplayCache()
    publish(alice,ready,'INSERT INTO items(id,value) VALUES (?,?)',(1,'alice'))
    db,seq,_=begin(bob,ready)
    assert seq==2 and db.execute('SELECT value FROM items WHERE id=1').fetchone()[0]=='alice'
    db.close()
    publish(alice,ready,'INSERT INTO items(id,value) VALUES (?,?)',(2,'new'))
    db,seq,_=begin(bob,ready)
    assert seq==3 and db.execute('SELECT COUNT(*) FROM items').fetchone()[0]==2
    db.close()

def test_crash_before_remote_commit_does_not_pollute_cache(ready):
    cache=JournalReplayCache()
    db,seq,head=begin(cache,ready)
    db.execute('INSERT INTO items(id,value) VALUES (?,?)',(1,'unpublished'));db.commit();db.close()
    db,seq,head=begin(cache,ready)
    assert db.execute('SELECT COUNT(*) FROM items').fetchone()[0]==0
    db.close()

def test_lost_response_after_remote_commit_replayed_once(ready):
    cache=JournalReplayCache()
    db,seq,_=begin(cache,ready)
    statement=['INSERT INTO items(id,value) VALUES (?,?)',[7,'remote']]
    db.execute(*statement);db.commit();db.close()
    ready.create(2,[statement]) # simulated lost HTTP response to author
    db,seq,head=begin(cache,ready)
    assert seq==2
    assert db.execute('SELECT COUNT(*) FROM items').fetchone()[0]==1
    db.close()

def test_tip_deletion_or_corruption_blocks_unsafe_use(ready):
    cache=JournalReplayCache()
    db,_,_=begin(cache,ready);db.close()
    del ready.items[1]
    with pytest.raises(RemoteError):begin(cache,ready)
    ready.create(1,[["CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT NOT NULL)",[]]])
    ready.items[1]['payload']['statements'][0][0]='DROP TABLE items'
    with pytest.raises(RemoteError):begin(cache,ready)

def test_malformed_tail_does_not_poison_committed_cache(ready):
    cache=JournalReplayCache()
    db,_,_=begin(cache,ready);db.close()
    ready.create(2,[["INSERT INTO no_such_table VALUES (1)",[]]])
    with pytest.raises(RemoteError):begin(cache,ready)
    # Known committed snapshot remains usable for explicit rollback/recovery.
    assert cache._sequence==1
    assert cache._database.execute('SELECT COUNT(*) FROM items').fetchone()[0]==0

def test_transaction_clone_isolation(ready):
    cache=JournalReplayCache()
    db,_,_=begin(cache,ready)
    db.execute('INSERT INTO items VALUES(1,?)',('uncommitted',));db.commit()
    other,_,_=begin(cache,ready)
    assert other.execute('SELECT COUNT(*) FROM items').fetchone()[0]==0
    db.close();other.close()
