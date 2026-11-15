import json
import stat
import pytest
from server.microsoft_auth import (begin, poll, LocalTokenProvider,
                                   AuthenticationError, SCOPES)


def issued(**changes):
    return dict(access_token='private-access', refresh_token='private-refresh',
                expires_in=3600, scope='Files.ReadWrite.AppFolder', **changes)


def test_device_flow_keeps_secrets_private_and_honours_poll_interval(tmp_path):
    pending, tokens = tmp_path / 'pending.json', tmp_path / 'tokens.json'
    calls = []
    def request(endpoint, fields):
        calls.append((endpoint, fields))
        return dict(device_code='private-device', user_code='ABC-123',
                    verification_uri='https://microsoft.com/devicelogin', expires_in=900, interval=5)
    public = begin(pending, request, lambda: 100)
    assert 'device_code' not in public and 'private-device' not in json.dumps(public)
    assert calls[0][1]['scope'] == SCOPES
    assert stat.S_IMODE(pending.stat().st_mode) == 0o600
    assert poll(pending, tokens, request, lambda: 101)['status'] == 'pending'
    assert len(calls) == 1
    assert poll(pending, tokens, lambda *a: {'error': 'slow_down'}, lambda: 106)['retry_after'] == 10
    assert poll(pending, tokens, lambda *a: issued(), lambda: 117) == {'status': 'authorized'}
    assert not pending.exists()
    assert stat.S_IMODE(tokens.stat().st_mode) == 0o600
    assert json.loads(tokens.read_text())['refresh_token'] == 'private-refresh'


def test_declined_expired_or_broader_scope_never_saves_tokens(tmp_path):
    pending, tokens = tmp_path / 'pending', tmp_path / 'tokens'
    begin(pending, lambda *a: dict(device_code='secret', user_code='user',
                                  verification_uri='uri', expires_in=900), lambda: 0)
    for result in ({'error': 'access_denied'},
                   {**issued(), 'scope': 'Files.ReadWrite.All'},
                   {**issued(), 'scope': ''}):
        with pytest.raises(AuthenticationError):
            poll(pending, tokens, lambda *a: result, lambda: 10)
        assert not tokens.exists()
    with pytest.raises(AuthenticationError):
        poll(pending, tokens, lambda *a: issued(), lambda: 1000)


def test_refresh_rotation_survives_provider_restart_and_errors_do_not_overwrite(tmp_path):
    path = tmp_path / 'tokens'
    path.write_text(json.dumps(dict(access_token='old', refresh_token='old-refresh', expires_at=0)))
    requests = []
    def request(endpoint, fields):
        requests.append(fields)
        return issued()
    assert LocalTokenProvider(path, request, lambda: 100)() == 'private-access'
    assert requests[0]['refresh_token'] == 'old-refresh'
    assert LocalTokenProvider(path, lambda *a: pytest.fail('unexpected refresh'), lambda: 101)() == 'private-access'
    before = path.read_bytes()
    with pytest.raises(AuthenticationError):
        LocalTokenProvider(path, lambda *a: {'error': 'invalid_grant'}, lambda: 5000)()
    assert path.read_bytes() == before
