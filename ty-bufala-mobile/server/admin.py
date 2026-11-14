"""Local/server-console administration only. Never run against production without approval."""
import argparse
import getpass
import os
from werkzeug.security import generate_password_hash
from .store import Store


def main():
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=['create-user', 'disable-user'])
    p.add_argument('username')
    p.add_argument('--name', default='')
    p.add_argument('--role', choices=['admin', 'editor', 'reader'], default='editor')
    args = p.parse_args()
    store = Store(os.environ['DATABASE_URL'])
    store.initialize()
    username = args.username.strip().lower()
    if not username or len(username) > 160:
        p.error('Identifiant invalide')
    if args.action == 'create-user':
        password = getpass.getpass('Mot de passe individuel (14 caractères minimum) : ')
        if len(password) < 14 or password != getpass.getpass('Confirmer : '):
            p.error('Mot de passe trop court ou confirmation différente')
        with store.transaction(write=True) as db:
            db.execute('INSERT INTO users(id,name,password,role) VALUES (?,?,?,?)', (username, args.name or username, generate_password_hash(password, method='scrypt'), args.role))
    else:
        with store.transaction(write=True) as db:
            db.execute('UPDATE users SET active=0 WHERE id=?', (username,))
            db.execute('DELETE FROM sessions WHERE user_id=?', (username,))
    print('Compte enregistré. Aucun mot de passe affiché.')


if __name__ == '__main__':
    main()
