"""Private operator console; no HTTP credential endpoint and no secret output."""
import argparse
import json
import os
import time
from pathlib import Path
from server.oauth_vault import from_environment, DurableTokenProvider, VaultUnavailable


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'initialize', 'reconnect', 'reencrypt'])
    parser.add_argument('--config', type=Path, help='private JSON file holding only TB_* vault settings')
    parser.add_argument('--tokens', type=Path, help='private Microsoft token cache, never pasted in chat')
    args = parser.parse_args()
    try:
        if args.config:
            config = json.loads(args.config.read_text())
            allowed = {'TB_VAULT_REPOSITORY', 'TB_VAULT_REPOSITORY_ID', 'TB_VAULT_BRANCH',
                       'TB_VAULT_KEYS', 'TB_VAULT_ACTIVE_KEY', 'TB_GITHUB_APP_ID',
                       'TB_GITHUB_INSTALLATION_ID', 'TB_GITHUB_PRIVATE_KEY'}
            if not isinstance(config, dict) or not set(config) <= allowed:
                raise VaultUnavailable('Configuration privée invalide.')
            os.environ.update(config)
        control = from_environment()
        state, _ = control.read()
        if args.action == 'status':
            print(json.dumps({'configured': state is not None,
                              'oauth_present': bool((state or {}).get('oauth')),
                              'refresh_needed': (state or {}).get('oauth', {}).get('expires_at', 0) <= time.time()+120}))
        elif args.action == 'reencrypt':
            control.reencrypt()
            print('{"status":"encrypted_key_rotation_verified"}')
        else:
            if not args.tokens:
                parser.error('--tokens requis, chemin privé uniquement')
            if args.action == 'initialize' and state is not None:
                raise VaultUnavailable('Coffre déjà présent : aucune réinitialisation autorisée.')
            if args.action == 'reconnect' and state is None:
                raise VaultUnavailable('Coffre absent : initialisation explicite nécessaire.')
            DurableTokenProvider(control).reconnect(json.loads(args.tokens.read_text()))
            print('{"status":"authorization_durably_verified"}')
    except (VaultUnavailable, OSError, ValueError, TypeError, KeyError) as error:
        # Do not print exceptions containing third-party response bodies or local paths.
        parser.exit(1, 'Coffre indisponible (' + type(error).__name__ + ').\n')


if __name__ == '__main__':
    main()
