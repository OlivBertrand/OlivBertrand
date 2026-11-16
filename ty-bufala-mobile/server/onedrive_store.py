"""Experimental immutable transaction journal; no local disk is authoritative.

Not enabled in production. Graph's fail-on-name-conflict MUST be validated on
an isolated real drive, including competing upload sessions, before activation.
Each generation is a complete SQL transaction, not an editable shared SQLite file.
"""
import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from urllib.parse import quote
from .store import Store, Connection, canonical
from .onedrive import Graph, GraphError


class RemoteUnavailable(RuntimeError):
    pass


class RemoteConflict(RemoteUnavailable):
    pass


def digest(payload):
    return hashlib.sha256(canonical(payload).encode()).hexdigest()


class GraphJournal:
    def __init__(self, graph, drive, folder):
        self.graph, self.drive, self.folder = graph, drive, folder

    @staticmethod
    def name(sequence):
        return f'transaction-{sequence:012d}.json'

    def read(self, sequence):
        path = ('drives/' + quote(self.drive, safe='') + '/items/' +
                quote(self.folder, safe='') + ':/' + self.name(sequence))
        try:
            item = self.graph.call(path)
        except GraphError as error:
            if error.status == 404:
                return None
            raise RemoteUnavailable('Lecture OneDrive indisponible.') from None
        try:
            content, _ = self.graph.download(self.drive, item['id'], metadata=item)
            return json.loads(content)
        except (ValueError, KeyError, RuntimeError, OSError):
            raise RemoteUnavailable('Journal OneDrive illisible. Aucune écriture autorisée.') from None

    def create(self, sequence, envelope):
        # upload_new uses createUploadSession(conflictBehavior=fail), NEVER replace.
        try:
            self.graph.upload_new(self.drive, self.folder, self.name(sequence), canonical(envelope).encode())
        except GraphError as error:
            if error.status in (409, 412):
                raise RemoteConflict('Écriture concurrente : réessayer la même opération.') from None
            raise RemoteUnavailable('Dépôt OneDrive non confirmé.') from None
        except (RuntimeError, OSError):
            # Includes a lost response AFTER a remote commit: no success is returned.
            # The next request replays the durable receipt and does not duplicate it.
            raise RemoteUnavailable('Dépôt OneDrive non confirmé : conserver la saisie locale.') from None
        if self.read(sequence) != envelope:
            raise RemoteUnavailable('Relecture OneDrive différente : aucun reçu envoyé.')


class JournalConnection(Connection):
    def __init__(self, db, statements, write):
        super().__init__(db, False)
        self.statements, self.write = statements, write

    def execute(self, sql, parameters=()):
        mutation = sql.lstrip().split(None, 1)[0].upper() not in ('SELECT', 'PRAGMA')
        if mutation and not self.write:
            raise RemoteUnavailable('Écriture hors transaction refusée.')
        result = super().execute(sql, parameters)
        if mutation:
            self.statements.append([sql, list(parameters)])
        return result


class JournalStore:
    postgres = False

    def __init__(self, remote, allow_empty=False):
        self.remote, self.allow_empty = remote, allow_empty

    @classmethod
    def from_environment(cls):
        if os.environ.get('TB_ONEDRIVE_EXPERIMENTAL') != '1':
            raise RemoteUnavailable('Stockage OneDrive expérimental désactivé ; validation réelle requise.')
        required = ('TB_ONEDRIVE_DRIVE_ID', 'TB_ONEDRIVE_JOURNAL_FOLDER_ID')
        if any(not os.environ.get(key) for key in required):
            raise RemoteUnavailable('Autorisation Microsoft et dossier privé requis.')
        if os.environ.get('TB_OAUTH_VAULT') == 'github':
            from .oauth_vault import from_environment, DurableTokenProvider
            token = DurableTokenProvider(from_environment())
        elif not os.environ.get('TB_OAUTH_VAULT') and os.environ.get('MS_GRAPH_ACCESS_TOKEN'):
            token = os.environ['MS_GRAPH_ACCESS_TOKEN']  # isolated legacy trials only
        else:
            raise RemoteUnavailable('Coffre Microsoft privé non configuré.')
        return cls(GraphJournal(Graph(token), os.environ[required[0]], os.environ[required[1]]))

    def _load(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        sequence, previous = 0, ''
        try:
            while True:
                envelope = self.remote.read(sequence + 1)
                if envelope is None:
                    break
                payload = envelope['payload']
                if (envelope['sha256'] != digest(payload) or
                        payload['format'] != 'ty-bufala-sql-journal-v1' or
                        payload['sequence'] != sequence + 1 or payload['parent'] != previous):
                    raise RemoteUnavailable('Chaîne du journal invalide : stockage bloqué.')
                db.execute('BEGIN')
                for sql, parameters in payload['statements']:
                    db.execute(sql, parameters)
                db.commit()
                sequence, previous = sequence + 1, envelope['sha256']
            if not sequence and not self.allow_empty:
                raise RemoteUnavailable('Journal absent : aucune base vide créée automatiquement.')
            return db, sequence, previous
        except (KeyError, TypeError, ValueError, sqlite3.Error):
            db.close()
            raise RemoteUnavailable("Journal invalide ou incompatible : stockage bloqué.") from None
        except BaseException:
            db.close()
            raise

    @contextmanager
    def transaction(self, write=False):
        db, sequence, previous = self._load()
        statements = []
        try:
            if not write:
                db.execute('PRAGMA query_only=ON')
            db.execute('BEGIN')
            yield JournalConnection(db, statements, write)
            db.commit()
            if statements:
                payload = {'format': 'ty-bufala-sql-journal-v1', 'sequence': sequence + 1,
                           'parent': previous, 'statements': statements}
                envelope = {'payload': payload, 'sha256': digest(payload)}
                # Only one transaction may occupy a generation. A competing writer
                # must reload and revalidate business revisions; never overwrite.
                self.remote.create(sequence + 1, envelope)
        finally:
            # Local COMMIT is disposable; publication is the durable commit point.
            db.close()

    @staticmethod
    def lock(db):
        # Cross-process serialization is enforced at remote.create, not in RAM.
        pass

    def initialize(self):
        if self.allow_empty:
            Store.initialize(self)
            self.allow_empty = False
        else:
            with self.transaction() as db:
                row = db.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
                if not row or row['value'] != '1':
                    raise RemoteUnavailable('Schéma du journal non pris en charge.')
