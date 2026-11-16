import base64
import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor
import pytest
from server.oauth_vault import (EncryptedVault, DurableTokenProvider, VaultUnavailable,
                                VaultConflict, ReconnectionRequired)


class MemoryRecord:
    def __init__(self):
        self.raw, self.version = None, None
        self.lock = threading.RLock()
        self.fail, self.lose_response = False, False

    def read(self):
        with self.lock:
            if self.fail:
                raise VaultUnavailable('Simulated outage')
            return self.raw, self.version

    def compare_and_swap(self, expected, value):
        with self.lock:
            if self.fail:
                raise VaultUnavailable('Simulated outage')
            if expected != self.version:
                raise VaultConflict('Concurrent update')
            self.version = str(int(self.version or '0') + 1)
            self.raw = value
            if self.lose_response:
                self.lose_response = False
                raise VaultUnavailable('Response lost AFTER durable commit')
            return self.version


def vault(remote, keys=None, active='key-a', context='private-repository:main:state/control.json'):
    return EncryptedVault(remote, keys or {'key-a': b'a'*32}, active, context)


def tokens(now=0, name='initial'):
    return {'access_token': name+'-access', 'refresh_token': name+'-refresh',
            'scope': 'Files.ReadWrite.AppFolder', 'expires_at': now}


def response(name='fresh', scope='Files.ReadWrite.AppFolder'):
    return {'access_token': name+'-access', 'refresh_token': name+'-refresh',
            'expires_in': 3600, 'scope': scope}


@pytest.fixture
def ready():
    remote = MemoryRecord()
    control = vault(remote)
    state = {'schema': 1, 'oauth': tokens(), 'anchor': {'sequence': 7, 'hash': 'known'}}
    control.write(None, state)
    return remote, control, state


def test_encryption_restart_context_integrity_and_key_rotation(ready):
    remote, control, state = ready
    assert b'initial-access' not in remote.raw and b'initial-refresh' not in remote.raw
    assert vault(remote).read()[0] == state
    with pytest.raises(VaultUnavailable):
        vault(remote, context='different-repository').read()
    with pytest.raises(VaultUnavailable):
        vault(remote, keys={'key-a': b'b'*32}).read()
    rotating = vault(remote, keys={'key-a': b'a'*32, 'key-b': b'b'*32}, active='key-b')
    rotating.reencrypt()
    assert vault(remote, keys={'key-b': b'b'*32}, active='key-b').read()[0] == state
    assert json.loads(remote.raw)['key'] == 'key-b'
    altered = json.loads(remote.raw)
    ciphertext = bytearray(base64.b64decode(altered['ciphertext']))
    ciphertext[0] ^= 1
    altered['ciphertext'] = base64.b64encode(ciphertext).decode()
    remote.raw = json.dumps(altered).encode()
    with pytest.raises(VaultUnavailable):
        rotating.read()


def test_expired_token_rotates_durably_preserving_anchor_and_survives_restart(ready):
    remote, control, state = ready
    calls = []
    def refresh(endpoint, fields):
        calls.append(fields)
        return response()
    provider = DurableTokenProvider(control, refresh, lambda: 100)
    assert provider() == 'fresh-access'
    assert calls[0]['refresh_token'] == 'initial-refresh'
    saved = vault(remote).read()[0]
    assert saved['oauth']['refresh_token'] == 'fresh-refresh'
    assert saved['anchor'] == state['anchor']
    restarted = DurableTokenProvider(vault(remote), lambda *args: pytest.fail('already refreshed'), lambda: 101)
    assert restarted() == 'fresh-access'
    assert provider() == 'fresh-access' and len(calls) == 1


def test_two_processes_do_not_overwrite_each_others_rotation(ready):
    remote, control, state = ready
    barrier = threading.Barrier(2, timeout=5)
    def run(index):
        def refresh(*args):
            barrier.wait()
            return response('writer-'+str(index))
        return DurableTokenProvider(vault(remote), refresh, lambda: 100)()
    with ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(run, (1, 2)))
    assert values[0] == values[1] == vault(remote).read()[0]['oauth']['access_token']
    assert remote.version == '2'
    assert vault(remote).read()[0]['anchor'] == state['anchor']


def test_lost_response_recovers_saved_rotation_without_second_refresh(ready):
    remote, control, _ = ready
    remote.lose_response = True
    provider = DurableTokenProvider(control, lambda *args: response(), lambda: 100)
    with pytest.raises(VaultUnavailable):
        provider()
    assert provider._cached is None
    restarted = DurableTokenProvider(vault(remote), lambda *args: pytest.fail('must use durable token'), lambda: 101)
    assert restarted() == 'fresh-access'


@pytest.mark.parametrize('error,exception', [('invalid_grant', ReconnectionRequired),
                                            ('interaction_required', ReconnectionRequired),
                                            ('consent_required', ReconnectionRequired),
                                            ('temporarily_unavailable', VaultUnavailable)])
def test_revocation_and_microsoft_failure_never_cache_or_overwrite(ready, error, exception):
    remote, control, _ = ready
    before = remote.raw
    provider = DurableTokenProvider(control, lambda *args: {'error': error}, lambda: 100)
    with pytest.raises(exception):
        provider()
    assert remote.raw == before and provider._cached is None


def test_network_failure_and_expanded_scope_are_rejected(ready):
    remote, control, _ = ready
    before = remote.raw
    def unavailable(*args):
        raise OSError('private-details-not-to-be-exposed')
    for request in (unavailable, lambda *args: response(scope='Files.ReadWrite.All')):
        with pytest.raises(VaultUnavailable) as error:
            DurableTokenProvider(control, request, lambda: 100)()
        assert 'private-details' not in str(error.value)
        assert remote.raw == before


def test_remote_failure_before_commit_does_not_return_unsaved_credentials(ready):
    remote, control, _ = ready
    def refresh(*args):
        remote.fail = True
        return response()
    provider = DurableTokenProvider(control, refresh, lambda: 100)
    with pytest.raises(VaultUnavailable):
        provider()
    assert provider._cached is None
    remote.fail = False
    assert control.read()[0]['oauth']['refresh_token'] == 'initial-refresh'


def test_reconnect_preserves_anchor_and_requires_durable_verification(ready):
    remote, control, state = ready
    provider = DurableTokenProvider(control, clock=lambda: 100)
    provider.reconnect(tokens(4000, 'reconnected'))
    assert provider() == 'reconnected-access'
    assert control.read()[0]['anchor'] == state['anchor']
    with pytest.raises(ReconnectionRequired):
        DurableTokenProvider(vault(MemoryRecord()), clock=lambda: 100)()


def test_restart_revalidates_scope_even_for_unexpired_saved_token(ready):
    remote, control, state = ready
    bad = {**state, 'oauth': {**tokens(4000), 'scope': 'Files.ReadWrite.All'}}
    control.write(remote.version, bad)
    with pytest.raises(VaultUnavailable):
        DurableTokenProvider(control, lambda *args: pytest.fail('no expanded-scope request'), lambda: 100)()


def test_vault_outage_is_503_at_api_boundary(tmp_path, monkeypatch):
    from contextlib import contextmanager
    from server.app import create_app
    app = create_app(str(tmp_path/'api.db'), testing=True)
    @contextmanager
    def broken(*args, **kwargs):
        raise ReconnectionRequired('Autorisation Microsoft à renouveler.')
        yield
    monkeypatch.setattr(app.config['STORE'], 'transaction', broken)
    result = app.test_client().post('/api/login', json={'username': 'demo', 'password': 'demo'})
    assert result.status_code == 503
    assert result.json['code'] == 'remote_storage_unavailable'
