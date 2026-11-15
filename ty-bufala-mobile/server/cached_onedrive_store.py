"""Optional cached OneDrive journal backend; experiment only, no production enable.

Only GraphJournal's create+readback is a durable commit. On unknown replies,
the pending local transaction is discarded and the next call reloads the tail.
"""
import threading
from contextlib import contextmanager
from .journal_cache import JournalReplayCache
from .onedrive_store import JournalStore, JournalConnection, RemoteUnavailable, digest


class CachedJournalStore(JournalStore):
    def __init__(self, remote, allow_empty=False):
        super().__init__(remote, allow_empty=allow_empty)
        self._mutex = threading.RLock()
        self._replay_cache = JournalReplayCache()

    @contextmanager
    def transaction(self, write=False):
        # Serialize local threads. Other processes rely on Graph CAS semantics.
        with self._mutex:
            db, sequence, previous = self._replay_cache.snapshot(
                self.remote, self._load, digest, RemoteUnavailable
            )
            statements = []
            handed_to_cache = False
            try:
                if not write:
                    db.execute('PRAGMA query_only=ON')
                db.execute('BEGIN')
                yield JournalConnection(db, statements, write)
                db.commit()
                if statements:
                    payload = {
                        'format': 'ty-bufala-sql-journal-v1',
                        'sequence': sequence + 1,
                        'parent': previous,
                        'statements': statements,
                    }
                    envelope = {'payload': payload, 'sha256': digest(payload)}
                    self.remote.create(sequence + 1, envelope)
                    # GraphJournal.create validates the returned file on OneDrive.
                    self._replay_cache.committed(db, sequence + 1, envelope['sha256'])
                    handed_to_cache = True
            finally:
                if not handed_to_cache:
                    db.close()