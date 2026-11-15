"""Private-repository CAS storage via repository-scoped GitHub App tokens.

The RSA private key is a replaceable Render secret, NEVER a committed file.
No Actions, packages, paid service or code checkout is used by this adapter.
"""
import base64
import json
import re
import threading
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from .onedrive import NoRedirect
from .oauth_vault import VaultUnavailable, VaultConflict


class GitHubError(VaultUnavailable):
    def __init__(self, status):
        self.status = status
        super().__init__('Coffre GitHub indisponible (HTTP ' + str(status) + ').')


def request(path, token, method='GET', body=None):
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Ty-Bufala-Private-Vault'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = Request('https://api.github.com' + path, headers=headers, method=method,
                  data=json.dumps(body).encode() if body is not None else None)
    try:
        with build_opener(NoRedirect()).open(req, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise GitHubError(error.code) from None
    except (URLError, OSError, ValueError):
        raise VaultUnavailable('Coffre GitHub inaccessible : confirmation bloquée.') from None


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


class InstallationToken:
    def __init__(self, app_id, installation_id, repository_id, private_key, transport=request, clock=time.time):
        if not str(installation_id).isdigit() or not isinstance(repository_id, int):
            raise VaultUnavailable('Installation GitHub invalide.')
        self.app_id, self.installation_id, self.repository_id = str(app_id), str(installation_id), repository_id
        try:
            self.key = serialization.load_pem_private_key(private_key.encode(), password=None)
            if not isinstance(self.key, rsa.RSAPrivateKey) or self.key.key_size < 2048:
                raise ValueError()
        except (ValueError, TypeError):
            raise VaultUnavailable('Clé GitHub App invalide ou à remplacer.') from None
        self.transport, self.clock = transport, clock
        self._token, self._expires = None, 0
        self._lock = threading.RLock()

    def __call__(self):
        with self._lock:
            now = self.clock()
            if self._token and self._expires > now + 120:
                return self._token
            header = b64(b'{"alg":"RS256","typ":"JWT"}')
            claims = b64(json.dumps({'iat': int(now)-60, 'exp': int(now)+540, 'iss': self.app_id}).encode())
            signing = (header + '.' + claims).encode()
            jwt = signing.decode() + '.' + b64(self.key.sign(signing, padding.PKCS1v15(), hashes.SHA256()))
            result = self.transport('/app/installations/' + self.installation_id + '/access_tokens', jwt, 'POST',
                                    {'repository_ids': [self.repository_id], 'permissions': {'contents': 'write'}})
            try:
                expires = datetime.fromisoformat(result['expires_at'].replace('Z', '+00:00')).timestamp()
                repositories = result.get('repositories', [])
                if (not isinstance(result['token'], str) or not result['token'] or expires <= now + 120 or
                        result['permissions'].get('contents') != 'write' or
                        set(result['permissions']) - {'contents', 'metadata'} or
                        any(row['id'] != self.repository_id for row in repositories)):
                    raise ValueError()
            except (KeyError, ValueError, TypeError):
                raise VaultUnavailable('Jeton GitHub limité au coffre non confirmé.') from None
            self._token, self._expires = result['token'], expires
            return self._token


class GitHubRecord:
    def __init__(self, repository, repository_id, token, branch='main', path='state/control.json', transport=request):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
            raise VaultUnavailable('Dépôt privé invalide.')
        self.repository_id, self.token, self.branch, self.path = repository_id, token, branch, path
        self.prefix, self.transport = '/repos/' + repository, transport
        self.content_path = self.prefix + '/contents/' + quote(path, safe='/')

    def _private(self):
        info = self.transport(self.prefix, self.token())
        if info.get('private') is not True or info.get('id') != self.repository_id:
            raise VaultUnavailable('Le coffre doit rester dans son dépôt privé dédié.')

    def read(self):
        self._private()  # A public/moved/recreated repository is never accepted.
        try:
            item = self.transport(self.content_path + '?' + urlencode({'ref': self.branch}), self.token())
        except GitHubError as error:
            if error.status == 404:
                return None, None
            raise
        try:
            if item['type'] != 'file' or item['encoding'] != 'base64' or item.get('size', 0) > 512000:
                raise ValueError()
            return base64.b64decode(''.join(item['content'].split()), validate=True), item['sha']
        except (KeyError, TypeError, ValueError):
            raise VaultUnavailable('Format du coffre GitHub invalide.') from None

    def compare_and_swap(self, expected, value):
        self._private()
        body = {'message': 'Rotate encrypted application control state', 'branch': self.branch,
                'content': base64.b64encode(value).decode()}
        if expected is not None:
            body['sha'] = expected
        try:
            result = self.transport(self.content_path, self.token(), 'PUT', body)
            return result['content']['sha']
        except GitHubError as error:
            if error.status == 409:
                raise VaultConflict('Mise à jour concurrente du coffre.') from None
            raise
        except (KeyError, TypeError):
            raise VaultUnavailable('Enregistrement du coffre non confirmé.') from None
