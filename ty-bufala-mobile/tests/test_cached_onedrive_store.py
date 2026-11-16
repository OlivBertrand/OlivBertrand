"""Integration tests for Work's existing server, no live Graph calls.

These must be run on Work's actual tree, alongside test_onedrive_store.py.
"""
import copy
import threading
import pytest
from server.cached_onedrive_store import CachedJournalStore
from server.domain import apply_operations
from server.onedrive_store import RemoteUnavailable, RemoteConflict


class FakeGraphJournal:
    def __init__(self):
        self.items = {}
        self.reads = 0
        self._mutex = threading.Lock()
        self.fail_next = False

    def read(self, sequence):
        with self._mutex:
            self.reads += 1
            return copy.deepcopy(self.items.get(sequence))

    def create(self, sequence, envelope):
        with self._mutex:
            if self.fail_next:
                self.fail_next = False
                raise RemoteUnavailable('Simulated interruption')
            if sequence in self.items:
                raise RemoteConflict('Simulated cross-worker conflict')
            self.items[sequence] = copy.deepcopy(envelope)
        assert self.read(sequence) == envelope


ACTOR = {'id': 'alice', 'role': 'admin'}


def operation(op_id, revision=0, notes=''):
    return {'opId': op_id, 'deviceId': 'device_foo', 'kind': 'animals',
            'baseRevision': revision,
            'data': {'id': 'animal_foo', 'earTag': 'FR0000000001',
                     'sex': 'F', 'status': 'present', 'notes': notes}}


def test_cached_journal_replay_and_receipts_after_restart():
    remote = FakeGraphJournal()
    store = CachedJournalStore(remote, allow_empty=True)
    store.initialize()
    first = [operation('first')]
    receipt = apply_operations(store, ACTOR, first)
    for i in range(2, 15):
        apply_operations(store, ACTOR, [operation('change_'+str(i), i-1, str(i))])
    assert remote.reads < 65, 'Remote reads must grow linearly, not quadratically'
    restarted = CachedJournalStore(remote)
    restarted.initialize()
    with restarted.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS c FROM records').fetchone()['c'] == 1
        assert db.execute('SELECT COUNT(*) AS c FROM changes').fetchone()['c'] == 14
    assert apply_operations(restarted, ACTOR, first) == receipt


def test_remote_failure_does_not_poison_cache():
    remote = FakeGraphJournal()
    store = CachedJournalStore(remote, allow_empty=True)
    store.initialize()
    remote.fail_next = True
    with pytest.raises(RemoteUnavailable):
        apply_operations(store, ACTOR, [operation('first')])
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS c FROM records').fetchone()['c'] == 0
    apply_operations(store, ACTOR, [operation('first')])
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS c FROM records').fetchone()['c'] == 1


def test_remote_writer_becomes_visible_to_cached_reader():
    remote = FakeGraphJournal()
    first = CachedJournalStore(remote, allow_empty=True)
    first.initialize()
    other = CachedJournalStore(remote)
    other.initialize()
    apply_operations(first, ACTOR, [operation('create')])
    with other.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS c FROM changes').fetchone()['c'] == 1
    apply_operations(other, ACTOR, [operation('edit', 1, 'Bob')])
    with first.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS c FROM changes').fetchone()['c'] == 2


def test_missing_remote_head_blocks_cached_transaction():
    remote = FakeGraphJournal()
    store = CachedJournalStore(remote, allow_empty=True)
    store.initialize()
    with remote._mutex:
        del remote.items[1]
    with pytest.raises(RemoteUnavailable):
        with store.transaction():
            pass