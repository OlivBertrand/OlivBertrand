"""Bounded per-process replay cache for the immutable OneDrive SQL journal.

Only the remote append-only journal is authoritative. Every transaction checks
its remotely stored head, and scans subsequent entries before using local RAM.
The SQLite database is cloned for every transaction; an unacknowledged write
must never poison the cached committed state.
"""
import sqlite3


class JournalReplayCache:
    def __init__(self):
        self._database = None
        self._sequence = 0
        self._hash = ''

    @staticmethod
    def clone(database):
        # Tous les accès sont sérialisés par CachedJournalStore._mutex.
        target = sqlite3.connect(':memory:', check_same_thread=False)
        target.row_factory = sqlite3.Row
        target.execute('PRAGMA foreign_keys=ON')
        database.backup(target)
        return target

    @staticmethod
    def verify(envelope, sequence, previous, digest, error_class):
        try:
            payload = envelope['payload']
            if (payload['format'] != 'ty-bufala-sql-journal-v1'
                    or type(payload['sequence']) is not int
                    or payload['sequence'] != sequence
                    or payload['parent'] != previous
                    or envelope['sha256'] != digest(payload)):
                raise ValueError('Invalid chain')
            statements = payload['statements']
            if not isinstance(statements, list):
                raise ValueError('Invalid statements')
            return statements, envelope['sha256']
        except (KeyError, TypeError, ValueError) as error:
            raise error_class('Chaîne OneDrive invalide : écriture bloquée.') from error

    def snapshot(self, remote, bootstrap, digest, error_class, head_verified=False):
        """Return a disposable transaction DB and its remote cursor.

        Detects a truncated/altered known tip; then replays only new entries.
        If bootstrap fails, never invent a fresh/empty farm.
        """
        if self._database is None:
            database, sequence, previous = bootstrap()
            shared = self.clone(database)
            database.close()
            self._database, self._sequence, self._hash = shared, sequence, previous
        else:
            # Verify the last durable entry before trusting the in-memory cache.
            if self._sequence and not head_verified:
                envelope = remote.read(self._sequence)
                if envelope is None:
                    raise error_class('La fin du journal OneDrive a disparu : écriture bloquée.')
                try:
                    payload = envelope['payload']
                    if envelope['sha256'] != self._hash or envelope['sha256'] != digest(payload) or payload['sequence'] != self._sequence:
                        raise ValueError('Head changed')
                except (KeyError, TypeError, ValueError) as error:
                    raise error_class('Le journal OneDrive a changé : écriture bloquée.') from error

            # No file is ever replaced; later files are replayed on a private clone.
            latest = None
            sequence, previous = self._sequence, self._hash
            try:
                while True:
                    envelope = remote.read(sequence + 1)
                    if envelope is None:
                        break
                    statements, following = self.verify(envelope, sequence + 1, previous, digest, error_class)
                    if latest is None:
                        latest = self.clone(self._database)
                    latest.execute('BEGIN')
                    for statement in statements:
                        if (not isinstance(statement, (list, tuple)) or len(statement) != 2 or
                                not isinstance(statement[0], str) or not isinstance(statement[1], (list, tuple))):
                            raise ValueError('Invalid SQL record')
                        latest.execute(statement[0], statement[1])
                    latest.commit()
                    sequence, previous = sequence + 1, following
            except (sqlite3.Error, ValueError, TypeError) as error:
                if latest is not None:
                    latest.close()
                raise error_class('Rejeu du journal impossible : écriture bloquée.') from error
            except BaseException:
                if latest is not None:
                    latest.close()
                raise
            if latest is not None:
                self._database.close()
                self._database, self._sequence, self._hash = latest, sequence, previous

        return self.clone(self._database), self._sequence, self._hash

    def committed(self, database, sequence, envelope_hash):
        """Accept a local DB ONLY after remote create + verified re-read."""
        old = self._database
        self._database, self._sequence, self._hash = database, sequence, envelope_hash
        if old is not None and old is not database:
            old.close()

    def close(self):
        if self._database is not None:
            self._database.close()
            self._database = None
            self._sequence = 0
            self._hash = ''
