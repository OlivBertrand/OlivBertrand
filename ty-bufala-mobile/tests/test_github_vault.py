import base64
import json
from datetime import datetime, timezone
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from server.github_vault import InstallationToken, GitHubRecord, GitHubError
from server.oauth_vault import VaultUnavailable, VaultConflict


def test_installation_token_is_limited_and_renewable_without_static_pat():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    now, calls = [1000], []
    def transport(path, jwt, method, body):
        calls.append(body)
        assert path == '/app/installations/123/access_tokens' and method == 'POST'
        header, claims, signature = jwt.split('.')
        decoded = json.loads(base64.urlsafe_b64decode(claims+'==='))
        assert decoded == {'iat': now[0]-60, 'exp': now[0]+540, 'iss': 'app-id'}
        key.public_key().verify(base64.urlsafe_b64decode(signature+'==='),
                                (header+'.'+claims).encode(), padding.PKCS1v15(), hashes.SHA256())
        assert body == {'repository_ids': [789], 'permissions': {'contents': 'write'}}
        return {'token': 'short-token-'+str(len(calls)), 'permissions': {'contents': 'write'},
                'repositories': [{'id': 789}],
                'expires_at': datetime.fromtimestamp(now[0]+3600, timezone.utc).isoformat()}
    token = InstallationToken('app-id', '123', 789, pem, transport, lambda: now[0])
    assert token() == token() == 'short-token-1'
    now[0] += 3500
    assert token() == 'short-token-2' and len(calls) == 2


def test_record_checks_privacy_and_repo_identity_and_uses_sha_cas():
    calls = []
    private = [True]
    def transport(path, token, method='GET', body=None):
        calls.append((path, method, body))
        if path == '/repos/owner/private-state':
            return {'id': 789, 'private': private[0]}
        if method == 'GET':
            return {'type': 'file', 'encoding': 'base64', 'content': base64.b64encode(b'ciphertext').decode(),
                    'sha': 'old-sha', 'size': 10}
        assert body['sha'] == 'old-sha' and body['branch'] == 'main'
        assert base64.b64decode(body['content']) == b'new-ciphertext'
        return {'content': {'sha': 'new-sha'}}
    remote = GitHubRecord('owner/private-state', 789, lambda: 'short-token', transport=transport)
    assert remote.read() == (b'ciphertext', 'old-sha')
    assert remote.compare_and_swap('old-sha', b'new-ciphertext') == 'new-sha'
    private[0] = False
    before = len(calls)
    with pytest.raises(VaultUnavailable):
        remote.compare_and_swap('old-sha', b'anything')
    assert len(calls) == before+1  # no PUT to a public repository


@pytest.mark.parametrize('status', [401, 403, 404, 429, 500])
def test_github_revocation_and_outages_do_not_fall_back_to_unconditional_write(status):
    calls = []
    def transport(path, *args):
        calls.append(path)
        raise GitHubError(status)
    remote = GitHubRecord('owner/private-state', 789, lambda: 'token', transport=transport)
    with pytest.raises(VaultUnavailable):
        remote.compare_and_swap('expected-sha', b'ciphertext')
    assert calls == ['/repos/owner/private-state']
