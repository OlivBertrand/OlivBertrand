"""Operator-only device login for isolated Graph trials, never a public endpoint.

Secrets stay in a private cache outside the repository. This local cache is NOT
durable storage on Render Free and must not be used to claim production OAuth.
"""
import argparse
import json
import os
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener
from .onedrive import NoRedirect

CLIENT_ID = 'ebf06cf9-f27b-40bd-9b02-383e8b48a8de'
AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/'
SCOPES = 'https://graph.microsoft.com/Files.ReadWrite.AppFolder offline_access'


class AuthenticationError(RuntimeError):
    pass


def post(endpoint, fields):
    request = Request(AUTHORITY + endpoint, data=urlencode(fields).encode(),
                      headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        # Do not include Microsoft's error_description: it may contain identifiers.
        try:
            code = json.load(error).get('error', 'oauth_error')
        except (ValueError, AttributeError):
            code = 'oauth_error'
        return {'error': code}


def save_private(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix='.microsoft-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as target:
            json.dump(value, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def begin(path, request=post, clock=time.time):
    flow = request('devicecode', {'client_id': CLIENT_ID, 'scope': SCOPES})
    if flow.get('error') or not all(flow.get(k) for k in
                                  ('device_code', 'user_code', 'verification_uri', 'expires_in')):
        raise AuthenticationError('Microsoft refuse de préparer la connexion.')
    # Endpoint is fixed; never follow a URI supplied by an arbitrary caller.
    flow['expires_at'] = clock() + int(flow['expires_in'])
    flow['next_poll_at'] = clock() + int(flow.get('interval', 5))
    save_private(path, flow)
    return {key: flow[key] for key in ('verification_uri', 'user_code', 'expires_in')}


def poll(path, token_path, request=post, clock=time.time):
    """One poll, no blocking sleep; caller may retry after the returned delay."""
    flow = json.loads(Path(path).read_text(encoding='utf-8'))
    now = clock()
    if now >= flow['expires_at']:
        raise AuthenticationError('Connexion expirée : recommencer explicitement.')
    if now < flow['next_poll_at']:
        return {'status': 'pending', 'retry_after': max(1, int(flow['next_poll_at'] - now + 1))}
    result = request('token', {
        'client_id': CLIENT_ID,
        'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
        'device_code': flow['device_code'],
    })
    if result.get('error') in ('authorization_pending', 'slow_down'):
        interval = int(flow.get('interval', 5)) + (5 if result['error'] == 'slow_down' else 0)
        flow.update(interval=interval, next_poll_at=now + interval)
        save_private(path, flow)
        return {'status': 'pending', 'retry_after': interval}
    if result.get('error') or not result.get('access_token') or not result.get('refresh_token'):
        raise AuthenticationError('Connexion non autorisée ou incomplète. Aucun accès enregistré.')
    _save_tokens(token_path, result, now)
    Path(path).unlink()
    return {'status': 'authorized'}


def _save_tokens(path, result, now):
    save_private(path, token_record(result, now))


def token_record(result, now):
    granted = set(result.get('scope', '').split())
    allowed = {'Files.ReadWrite.AppFolder', 'https://graph.microsoft.com/Files.ReadWrite.AppFolder',
               'offline_access'}
    if not granted or not granted <= allowed or not any('AppFolder' in s for s in granted):
        raise AuthenticationError('Autorisations Microsoft inattendues : accès non enregistré.')
    if not all(isinstance(result.get(key), str) and result[key]
               for key in ('access_token', 'refresh_token')):
        raise AuthenticationError('Autorisation Microsoft incomplète.')
    return {'access_token': result['access_token'],
            'refresh_token': result['refresh_token'],
            'expires_at': now + int(result['expires_in']),
            'scope': result['scope']}


class LocalTokenProvider:
    """Refresh before expiry; persist rotation before returning any access token."""
    def __init__(self, path, request=post, clock=time.time):
        self.path, self.request, self.clock = Path(path), request, clock

    def __call__(self):
        cached = json.loads(self.path.read_text(encoding='utf-8'))
        now = self.clock()
        if cached['expires_at'] > now + 120:
            return cached['access_token']
        result = self.request('token', {'client_id': CLIENT_ID, 'grant_type': 'refresh_token',
                                       'refresh_token': cached['refresh_token'], 'scope': SCOPES})
        if result.get('error') or not result.get('access_token') or not result.get('refresh_token'):
            raise AuthenticationError('Connexion Microsoft à renouveler. Aucune écriture confirmée.')
        _save_tokens(self.path, result, now)
        return result['access_token']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['begin', 'poll'])
    parser.add_argument('--pending', type=Path, required=True)
    parser.add_argument('--tokens', type=Path)
    args = parser.parse_args()
    if args.action == 'poll' and not args.tokens:
        parser.error('--tokens requis pour poll')
    try:
        result = begin(args.pending) if args.action == 'begin' else poll(args.pending, args.tokens)
    except (AuthenticationError, OSError, ValueError) as error:
        parser.exit(1, 'Connexion Microsoft indisponible (' + type(error).__name__ + ').\n')
    print(json.dumps(result))  # Only user code/status; NEVER bearer or refresh tokens.


if __name__ == '__main__':
    main()
