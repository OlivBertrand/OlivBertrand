"""Small encrypted, versioned control record. No farm data and no local authority.

The remote adapter MUST offer compare-and-swap and remain private. A successful
OAuth refresh is usable only after the new credentials were durably reread.
"""
import base64
import json
import os
import threading
import time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .microsoft_auth import post, token_record, SCOPES, CLIENT_ID, AuthenticationError
from .onedrive_store import RemoteUnavailable
from .store import canonical


class VaultUnavailable(RemoteUnavailable):
    pass


class VaultConflict(VaultUnavailable):
    pass


class ReconnectionRequired(VaultUnavailable):
    pass


class EncryptedVault:
    def __init__(self, remote, keys, active_key, context):
        if active_key not in keys or any(len(key) != 32 for key in keys.values()):
            raise VaultUnavailable('Clés de chiffrement du coffre invalides.')
        self.remote, self.keys, self.active_key = remote, dict(keys), active_key
        self.aad = ('ty-bufala-private-vault-v1:' + context).encode()

    def read(self):
        raw, revision = self.remote.read()
        if raw is None:
            return None, revision
        try:
            envelope = json.loads(raw)
            if envelope['format'] != 'ty-bufala-encrypted-vault-v1':
                raise ValueError()
            key = self.keys[envelope['key']]
            nonce = base64.b64decode(envelope['nonce'], validate=True)
            cipher = base64.b64decode(envelope['ciphertext'], validate=True)
            value = json.loads(AESGCM(key).decrypt(nonce, cipher, self.aad))
            if not isinstance(value, dict) or value.get('schema') != 1:
                raise ValueError()
            return value, revision
        except Exception:
            raise VaultUnavailable('Coffre illisible ou altéré : accès bloqué.') from None

    def write(self, expected, value):
        if not isinstance(value, dict) or value.get('schema') != 1:
            raise VaultUnavailable('Format de contrôle du coffre invalide.')
        nonce = os.urandom(12)
        cipher = AESGCM(self.keys[self.active_key]).encrypt(nonce, canonical(value).encode(), self.aad)
        envelope = canonical({'format': 'ty-bufala-encrypted-vault-v1', 'key': self.active_key,
                              'nonce': base64.b64encode(nonce).decode(),
                              'ciphertext': base64.b64encode(cipher).decode()}).encode()
        revision = self.remote.compare_and_swap(expected, envelope)
        verified, actual_revision = self.read()
        if verified != value or actual_revision != revision:
            # A later legitimate writer may already have committed: do not
            # overwrite it and do not use the unconfirmed local credentials.
            raise VaultConflict('Le coffre a changé pendant sa vérification.')
        return revision

    def reencrypt(self):
        value, revision = self.read()
        if value is None:
            raise VaultUnavailable('Coffre absent : aucune initialisation implicite.')
        return self.write(revision, value)


class DurableTokenProvider:
    def __init__(self, vault, request=post, clock=time.time):
        self.vault, self.request, self.clock = vault, request, clock
        self._cached = None
        self._lock = threading.RLock()

    def __call__(self):
        with self._lock:
            now = self.clock()
            if self._cached and self._cached['expires_at'] > now + 120:
                return self._cached['access_token']
            for _ in range(3):
                state, revision = self.vault.read()
                if state is None or not isinstance(state.get('oauth'), dict):
                    raise ReconnectionRequired('Connexion Microsoft à établir par un administrateur.')
                try:
                    stored = state['oauth']
                    old = token_record({**stored, 'expires_in': stored['expires_at'] - now}, now)
                except (AuthenticationError, KeyError, ValueError, TypeError):
                    raise VaultUnavailable('Autorisation conservée invalide : accès bloqué.') from None
                if old.get('expires_at', 0) > now + 120 and old.get('access_token'):
                    self._cached = old
                    return old['access_token']
                try:
                    result = self.request('token', {'client_id': CLIENT_ID,
                                                   'grant_type': 'refresh_token',
                                                   'refresh_token': old.get('refresh_token', ''),
                                                   'scope': SCOPES})
                except (OSError, ValueError):
                    raise VaultUnavailable('Microsoft inaccessible : aucune écriture confirmée.') from None
                if result.get('error') in ('invalid_grant', 'interaction_required', 'consent_required'):
                    raise ReconnectionRequired('Autorisation Microsoft révoquée ou expirée : reconnecter le compte.')
                if result.get('error'):
                    raise VaultUnavailable('Microsoft temporairement indisponible : aucune écriture confirmée.')
                try:
                    fresh = token_record(result, now)
                except (AuthenticationError, KeyError, ValueError, TypeError):
                    raise VaultUnavailable('Renouvellement Microsoft invalide : accès bloqué.') from None
                try:
                    # Preserve the independently maintained journal anchor and
                    # all other control fields; never replace an entire stale record.
                    self.vault.write(revision, {**state, 'oauth': fresh})
                except VaultConflict:
                    continue  # Read the winner, including its possibly newer anchor.
                self._cached = fresh
                return fresh['access_token']
            raise VaultUnavailable('Renouvellements concurrents : réessayer sans modifier la saisie locale.')

    def reconnect(self, tokens):
        """Operator-only; same scopes. No HTTP endpoint exposes this capability."""
        with self._lock:
            # Revalidate cached tokens using the same strict permission filter.
            checked = token_record({**tokens, 'expires_in': max(0, tokens['expires_at'] - self.clock())}, self.clock())
            state, revision = self.vault.read()
            self.vault.write(revision, {**(state or {'schema': 1}), 'oauth': checked})
            self._cached = None


def from_environment():
    from .github_vault import GitHubRecord, InstallationToken
    try:
        repository = os.environ['TB_VAULT_REPOSITORY']
        branch = os.environ.get('TB_VAULT_BRANCH', 'main')
        path = 'state/control.json'
        keys = {name: base64.b64decode(value, validate=True)
                for name, value in json.loads(os.environ['TB_VAULT_KEYS']).items()}
        token = InstallationToken(os.environ['TB_GITHUB_APP_ID'],
                                  os.environ['TB_GITHUB_INSTALLATION_ID'],
                                  int(os.environ['TB_VAULT_REPOSITORY_ID']),
                                  os.environ['TB_GITHUB_PRIVATE_KEY'])
        remote = GitHubRecord(repository, int(os.environ['TB_VAULT_REPOSITORY_ID']), token, branch, path)
        return EncryptedVault(remote, keys, os.environ['TB_VAULT_ACTIVE_KEY'],
                              repository + ':' + branch + ':' + path)
    except (KeyError, ValueError, TypeError):
        raise VaultUnavailable('Configuration du coffre privé incomplète.') from None
