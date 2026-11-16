"""Offline protocol tests. Fake remote is NOT evidence of Graph concurrency guarantees."""
import copy
import threading
from concurrent.futures import ThreadPoolExecutor
import pytest
from server.store import Store
from server.domain import apply_operations, Rejected
from server.onedrive_store import JournalStore, RemoteUnavailable, RemoteConflict


class Remote:
    def __init__(self):
        self.items, self.lock = {}, threading.Lock()
        self.fail, self.lost_response, self.barrier = False, False, None

    def read(self, sequence):
        with self.lock:
            return copy.deepcopy(self.items.get(sequence))

    def create(self, sequence, envelope):
        if self.barrier:
            self.barrier.wait(timeout=10)
        with self.lock:
            if self.fail:
                raise RemoteUnavailable('Indisponible')
            if sequence in self.items:
                raise RemoteConflict('Concurrence')
            self.items[sequence] = copy.deepcopy(envelope)
            if self.lost_response:
                self.lost_response = False
                raise RemoteUnavailable('Réponse perdue après dépôt')


@pytest.fixture
def ready():
    remote = Remote()
    store = JournalStore(remote, allow_empty=True)
    store.initialize()
    return remote, store


def operation(identifier='op_initial', revision=0, notes=''):
    return {'opId': identifier, 'deviceId': 'device_test', 'kind': 'animals', 'baseRevision': revision,
            'data': {'id': 'animal_test', 'earTag': 'FR0000000001', 'sex': 'F', 'status': 'present', 'notes': notes}}


ACTOR = {'id': 'alice', 'role': 'admin'}


def test_restart_rebuilds_data_history_and_receipts(ready):
    remote, store = ready
    receipt = apply_operations(store, ACTOR, [operation()])
    restarted = JournalStore(remote)
    restarted.initialize()
    assert apply_operations(restarted, ACTOR, [operation()]) == receipt
    with restarted.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS n FROM records').fetchone()['n'] == 1
        assert db.execute('SELECT COUNT(*) AS n FROM changes').fetchone()['n'] == 1
    assert len(remote.items) == 2


def test_remote_failure_never_acknowledges(ready):
    remote, store = ready
    remote.fail = True
    with pytest.raises(RemoteUnavailable):
        apply_operations(store, ACTOR, [operation()])
    remote.fail = False
    with JournalStore(remote).transaction() as db:
        assert db.execute('SELECT COUNT(*) AS n FROM records').fetchone()['n'] == 0


def test_lost_commit_response_retried_without_duplicate(ready):
    remote, store = ready
    remote.lost_response = True
    with pytest.raises(RemoteUnavailable):
        apply_operations(store, ACTOR, [operation()])
    result = apply_operations(JournalStore(remote), ACTOR, [operation()])
    assert result[0]['revision'] == 1
    assert len(remote.items) == 2


def test_two_servers_same_generation_only_one_wins(ready):
    remote, store = ready
    apply_operations(store, ACTOR, [operation()])
    remote.barrier = threading.Barrier(2)
    def write(n):
        try:
            return apply_operations(JournalStore(remote), ACTOR, [operation('edit_' + str(n), 1, str(n))])
        except RemoteConflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, range(2)))
    assert results.count('conflict') == 1
    remote.barrier = None
    with pytest.raises(Rejected) as error:
        apply_operations(JournalStore(remote), ACTOR, [operation('stale_retry', 1)])
    assert error.value.status == 409
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS n FROM changes').fetchone()['n'] == 2


def test_invalid_group_publishes_nothing(ready):
    remote, store = ready
    broken = operation('other'); broken['data']['id'] = 'other'
    with pytest.raises(Rejected):
        apply_operations(store, ACTOR, [operation(), broken])
    assert len(remote.items) == 1


def test_missing_journal_never_becomes_empty_farm():
    with pytest.raises(RemoteUnavailable):
        JournalStore(Remote()).initialize()


def test_corruption_blocks_replay(ready):
    remote, store = ready
    remote.items[1]['payload']['parent'] = 'broken'
    with pytest.raises(RemoteUnavailable):
        store.initialize()


def test_read_only_connection_rejects_mutation(ready):
    remote, store = ready
    with pytest.raises(RemoteUnavailable):
        with store.transaction() as db:
            db.execute('DELETE FROM records')
    assert len(remote.items) == 1


def test_experimental_backend_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv('TB_ONEDRIVE_EXPERIMENTAL', raising=False)
    with pytest.raises(RemoteUnavailable):
        Store('onedrive-journal://')


def test_api_does_not_send_receipt_on_remote_failure(ready, monkeypatch):
    from server import app as module
    from werkzeug.security import generate_password_hash
    remote, store = ready
    with store.transaction(write=True) as db:
        db.execute('INSERT INTO users(id,name,password,role) VALUES (?,?,?,?)',
                   ('alice', 'Alice', generate_password_hash('long-test-password'), 'admin'))
    monkeypatch.setattr(module, 'Store', lambda _: JournalStore(remote))
    app = module.create_app('journal', testing=True)
    client = app.test_client()
    response = client.post('/api/login', json={'username': 'alice', 'password': 'long-test-password'})
    assert response.status_code == 200
    csrf = response.json['csrf']
    remote.fail = True
    response = client.post('/api/sync', json={'operations': [operation()]}, headers={'X-CSRF-Token': csrf})
    assert response.status_code == 503
    assert 'receipts' not in response.json
    remote.fail = False
    # New process reads the persisted account/session; no in-memory session needed.
    restarted = module.create_app('journal', testing=True).test_client()
    restarted.set_cookie('tb_session', client.get_cookie('tb_session').value)
    response = restarted.post('/api/sync', json={'operations': [operation()]}, headers={'X-CSRF-Token': csrf})
    assert response.status_code == 200
