"""Optional cached OneDrive journal backend; experiment only, no production enable.

Only GraphJournal's create+readback is a durable commit. On unknown replies,
the pending local transaction is discarded and the next call reloads the tail.
"""
import threading
import os
import sqlite3
from contextlib import contextmanager
from .journal_cache import JournalReplayCache
from .onedrive_store import JournalStore, JournalConnection, RemoteUnavailable, digest
from .onedrive_store import GraphJournal
from .journal_authority import VerifiedGraphJournal,VaultJournalAnchor,JournalCheckpoint


class CachedJournalStore(JournalStore):
    def __init__(self, remote, allow_empty=False,checkpoint_interval=None):
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
        self._checkpoint=None
        self.checkpointer=JournalCheckpoint(remote,self.anchor) if self.anchor else None
        self.checkpoint_interval=int(os.environ.get('TB_ONEDRIVE_CHECKPOINT_INTERVAL','0')) if checkpoint_interval is None else checkpoint_interval
        if self.checkpoint_interval and not 2<=self.checkpoint_interval<=2000:raise RemoteUnavailable('Intervalle de point de reprise invalide.')

    def _adopt_checkpoint(self,pointer):
        if self._replay_cache._database is not None and self._replay_cache._sequence<pointer['sequence']:
            self._replay_cache.close()
        self._checkpoint=pointer;self.remote.base_sequence=pointer['sequence'];self.remote.base_hash=pointer['chain_sha256']
        self._last_manifest={seq:item for seq,item in self._last_manifest.items() if seq>pointer['sequence']}
        self.remote.hashes={seq:item for seq,item in self.remote.hashes.items() if seq>pointer['sequence']}

    def _load(self):
        if not self._checkpoint:return super()._load()
        db,sequence,previous=self.checkpointer.restore(self._checkpoint)
        try:
            while True:
                envelope=self.remote.read(sequence+1)
                if envelope is None:break
                statements,following=JournalReplayCache.verify(envelope,sequence+1,previous,digest,RemoteUnavailable)
                db.execute('BEGIN')
                for sql,parameters in statements:db.execute(sql,parameters)
                db.commit();sequence+=1;previous=following
            return db,sequence,previous
        except (sqlite3.Error,ValueError,TypeError,KeyError):
            db.close();raise RemoteUnavailable('Rejeu après point de reprise invalide ; stockage bloqué.') from None
        except BaseException:
            db.close();raise

    @contextmanager
    def transaction(self, write=False):
        # Serialize local threads. Other processes rely on Graph CAS semantics.
        with self._mutex:
            verified=False
            floor=self.anchor.read() if self.anchor else None
            if floor and floor.get('checkpoint'):
                pointer=floor['checkpoint']
                self.checkpointer.validate_pointer(pointer)
                if pointer['sequence']>floor['sequence']:raise RemoteUnavailable('Point de reprise au-delà de l’ancre durable.')
                self.checkpointer.metadata(pointer)
                if self._checkpoint!=pointer:self._adopt_checkpoint(pointer)
            if hasattr(self.remote,'inventory'):
                manifest=self.remote.inventory()
                for seq,item in self._last_manifest.items():
                    current=manifest.get(seq)
                    if current is None or self.remote.fingerprint(current)!=self.remote.fingerprint(item):
                        raise RemoteUnavailable('Un ancien segment OneDrive a changé : audit requis.')
                verified=bool(self._last_manifest) or bool(self._checkpoint and self._replay_cache._sequence==self.remote.base_sequence)
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
                    if floor['sequence']>sequence or self.remote.known_hash(floor['sequence'])!=floor['sha256']:
                        raise RemoteUnavailable('Recul ou altération du journal détecté par le coffre.')
                    if floor['sequence']<sequence:self.anchor.advance(sequence,previous)
                if hasattr(self.remote,'inventory'):self._last_manifest=dict(manifest)
                if not write:
                    db.execute('PRAGMA query_only=ON')
                db.execute('BEGIN')
                yield JournalConnection(db, statements, write)
                db.commit()
                final_sequence,final_hash=sequence,previous
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
                    final_sequence,final_hash=sequence+1,envelope['sha256']
                if self.checkpointer and self.checkpoint_interval and final_sequence-self.remote.base_sequence>=self.checkpoint_interval:
                    pointer=self.checkpointer.write(db,final_sequence,final_hash,self._checkpoint)
                    if pointer['sequence']<=final_sequence:self._adopt_checkpoint(pointer)
                if statements:
                    # GraphJournal.create validates the returned file on OneDrive.
                    self._replay_cache.committed(db, final_sequence,final_hash)
                    handed_to_cache = True
            finally:
                if not handed_to_cache:
                    db.close()
