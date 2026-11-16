"""Optional cached OneDrive journal backend; experiment only, no production enable.

Only GraphJournal's create+readback is a durable commit. On unknown replies,
the pending local transaction is discarded and the next call reloads the tail.
"""
import threading
from contextlib import contextmanager
from .journal_cache import JournalReplayCache
from .onedrive_store import JournalStore, JournalConnection, RemoteUnavailable, digest
from .onedrive_store import GraphJournal
from .journal_authority import VerifiedGraphJournal,VaultJournalAnchor


class CachedJournalStore(JournalStore):
    def __init__(self, remote, allow_empty=False):
        self.anchor=None
        if isinstance(remote,GraphJournal):
            vault=getattr(remote.graph.token,'vault',None)
            if vault is None:raise RemoteUnavailable('Le cache exige le coffre durable et son ancre.')
            self.anchor=VaultJournalAnchor(vault,remote.drive,remote.folder)
            remote=VerifiedGraphJournal(remote.graph,remote.drive,remote.folder)
        super().__init__(remote, allow_empty=allow_empty)
        self._mutex = threading.RLock()
        self._replay_cache = JournalReplayCache()
        self._last_manifest={}

    @contextmanager
    def transaction(self, write=False):
        # Serialize local threads. Other processes rely on Graph CAS semantics.
        with self._mutex:
            verified=False
            if hasattr(self.remote,'inventory'):
                manifest=self.remote.inventory()
                for seq,item in self._last_manifest.items():
                    current=manifest.get(seq)
                    if current is None or self.remote.fingerprint(current)!=self.remote.fingerprint(item):
                        raise RemoteUnavailable('Un ancien segment OneDrive a changé : audit requis.')
                verified=bool(self._last_manifest)
            else:
                # Fake/custom transports have no Graph immutable metadata contract.
                # Full replay preserves integrity instead of assuming immutability.
                self._replay_cache.close()
            db, sequence, previous = self._replay_cache.snapshot(
                self.remote, self._load, digest, RemoteUnavailable,head_verified=verified
            )
            statements = []
            handed_to_cache = False
            try:
                if self.anchor:
                    floor=self.anchor.read()
                    if floor['sequence']>sequence or self.remote.known_hash(floor['sequence'])!=floor['sha256']:
                        raise RemoteUnavailable('Recul ou altération du journal détecté par le coffre.')
                    if floor['sequence']<sequence:self.anchor.advance(sequence,previous)
                if hasattr(self.remote,'inventory'):self._last_manifest=dict(manifest)
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
                    if self.anchor:self.anchor.advance(sequence+1,envelope['sha256'])
                    # GraphJournal.create validates the returned file on OneDrive.
                    self._replay_cache.committed(db, sequence + 1, envelope['sha256'])
                    handed_to_cache = True
            finally:
                if not handed_to_cache:
                    db.close()
