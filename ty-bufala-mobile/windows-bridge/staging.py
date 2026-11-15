"""Ty Bufala Mobile -> Windows: durable, fail-closed *staging* of shared sale revisions.

This component does NOT write to ty_bufala.db: the Windows schema, catalogue and TVA
mappings must first be verified. It never issues a mobile/Windows integration receipt.
The real Windows writer must atomically persist a unique marker for (source, sale_id)
in the SAME transaction as the actual sale, then verify that marker before acknowledging.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager, closing
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable

SOURCE = 'ty-bufala-mobile'
VALID_STATES = ('pending', 'superseded', 'ignored_cancelled', 'requires_review', 'verified')
SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sale_versions (
  source TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  content_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','superseded','ignored_cancelled','requires_review','verified')),
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source, sale_id, revision)
);
CREATE TABLE IF NOT EXISTS receipts (
  source TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  windows_reference TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  marker_hash TEXT NOT NULL,
  PRIMARY KEY(source, sale_id, revision),
  UNIQUE(source, windows_reference),
  FOREIGN KEY(source,sale_id,revision) REFERENCES sale_versions(source,sale_id,revision)
);
CREATE TABLE IF NOT EXISTS import_runs (
  source_sha256 TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  snapshot_timestamp TEXT NOT NULL,
  staged_count INTEGER NOT NULL,
  stale_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sale_versions_state ON sale_versions(state,source,sale_id);
"""


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(obj):
    return hashlib.sha256(canonical(obj).encode('utf-8')).hexdigest()


def _valid_id(s):
    return isinstance(s, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,160}', s) is not None


class StagingError(ValueError):
    """Invalid or conflicting source data; no partial snapshot may be ingested."""


class WindowsSaleLedger:
    def __init__(self, filename):
        self.path = Path(filename)
        if not self.path.parent.exists():
            raise StagingError('Le répertoire de destination doit exister.')
        with closing(self._connect()) as db:
            db.executescript(SCHEMA)

    def _connect(self):
        connection = sqlite3.connect(self.path, isolation_level=None, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA synchronous=FULL')
        connection.execute('PRAGMA busy_timeout=30000')
        return connection

    @contextmanager
    def _write(self):
        db = self._connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise
        finally:
            db.close()

    @staticmethod
    def validate_sale(item):
        if not isinstance(item, dict) or not _valid_id(item.get('id')):
            raise StagingError('Identifiant de vente invalide.')
        sale_date = item.get('date')
        try:
            if not isinstance(sale_date, str) or date.fromisoformat(sale_date).isoformat() != sale_date:
                raise ValueError()
        except ValueError:
            raise StagingError('Date de vente invalide.') from None
        if not isinstance(item.get('lines'), list) or not 1 <= len(item['lines']) <= 100:
            raise StagingError('Lignes de vente manquantes ou trop nombreuses.')
        total = 0
        for line in item['lines']:
            if not isinstance(line, dict) or not isinstance(line.get('product'), str) or not line['product'].strip():
                raise StagingError('Produit de vente invalide.')
            qty = line.get('quantityMilli')
            price = line.get('unitPriceCents')
            if type(qty) is not int or type(price) is not int or not 0 < qty <= 10**9 or not 0 <= price <= 10**9:
                raise StagingError('Quantité ou prix de vente invalide.')
            cents = (qty * price + 500) // 1000
            if type(line.get('totalCents')) is not int or line['totalCents'] != cents:
                raise StagingError('Montant de ligne incohérent.')
            if line.get('vatRate') not in (None, 0, 2.1, 5.5, 10, 20):
                raise StagingError('TVA non reconnue.')
            total += cents
        if type(item.get('totalCents')) is not int or item['totalCents'] != total:
            raise StagingError('Montant TTC global incohérent.')
        if type(item.get('cancelled', False)) is not bool:
            raise StagingError('Statut d’annulation invalide.')
        return item

    @classmethod
    def _sales(cls, snapshot):
        if (not isinstance(snapshot, dict) or snapshot.get('application') != SOURCE
                or snapshot.get('kind') != 'central-backup' or snapshot.get('formatVersion') != 2
                or snapshot.get('complete') is not True or not isinstance(snapshot.get('records'), list)):
            raise StagingError('Sauvegarde centrale Work v2 requise, pas un CSV ou export mobile obsolète.')
        seen = set()
        result = []
        for row in snapshot['records']:
            if not isinstance(row, dict):
                raise StagingError('Enregistrement invalide.')
            if row.get('kind') != 'sales':
                continue
            raw = row.get('data')
            if not isinstance(raw, str):
                raise StagingError('Données de vente manquantes.')
            try:
                sale = cls.validate_sale(json.loads(raw))
            except (TypeError, json.JSONDecodeError) as exc:
                raise StagingError('JSON de vente illisible.') from exc
            sid, rev = row.get('id'), row.get('revision')
            if sid != sale['id'] or not _valid_id(sid) or type(rev) is not int or rev <= 0:
                raise StagingError('Identifiant/révision contradictoires dans la sauvegarde.')
            if sid in seen:
                raise StagingError('Deux enregistrements pour la même vente dans la sauvegarde.')
            seen.add(sid)
            result.append((sid, rev, sale))
        return result

    def stage_snapshot(self, snapshot):
        """Atomically stage only latest snapshot revisions; a retry is a no-op."""
        sales = self._sales(snapshot)  # validate all before opening the write transaction
        checksum = digest(snapshot)
        timestamp = str(snapshot.get('exportedAt', ''))
        counters = {'staged': 0, 'stale': 0, 'same': 0, 'review': 0}
        with self._write() as db:
            if db.execute('SELECT 1 FROM import_runs WHERE source_sha256=?', (checksum,)).fetchone():
                return {'replayed': True, **counters}
            for sid, revision, sale in sales:
                content_hash = digest(sale)
                previous = db.execute('SELECT revision,content_hash,state FROM sale_versions WHERE source=? AND sale_id=? ORDER BY revision DESC LIMIT 1', (SOURCE, sid)).fetchone()
                if previous and revision < previous['revision']:
                    counters['stale'] += 1
                    continue
                if previous and revision == previous['revision']:
                    if previous['content_hash'] != content_hash:
                        raise StagingError('Une même version de vente a deux contenus différents : '+sid)
                    counters['same'] += 1
                    continue
                verified = db.execute('SELECT COUNT(*) FROM receipts WHERE source=? AND sale_id=?', (SOURCE, sid)).fetchone()[0] > 0
                state = ('requires_review' if verified else 'ignored_cancelled' if sale.get('cancelled') else 'pending')
                db.execute("UPDATE sale_versions SET state='superseded' WHERE source=? AND sale_id=? AND state IN ('pending','requires_review','ignored_cancelled')", (SOURCE, sid))
                db.execute('INSERT INTO sale_versions (source,sale_id,revision,content_hash,content_json,state,imported_at) VALUES (?,?,?,?,?,?,?)', (SOURCE, sid, revision, content_hash, canonical(sale), state, utcnow()))
                counters['staged'] += 1
                if state == 'requires_review':
                    counters['review'] += 1
            db.execute('INSERT INTO import_runs(source_sha256,imported_at,snapshot_timestamp,staged_count,stale_count) VALUES (?,?,?,?,?)', (checksum, utcnow(), timestamp, counters['staged'], counters['stale']))
        return {'replayed': False, **counters}

    def pending(self):
        with closing(self._connect()) as db:
            rows = db.execute("SELECT sale_id,revision,state,content_json,content_hash FROM sale_versions WHERE source=? AND state IN ('pending','requires_review') ORDER BY sale_id,revision", (SOURCE,)).fetchall()
            return [{**dict(row), 'sale': json.loads(row['content_json'])} for row in rows]

    def record_verified_windows_commit(self, sale_id, revision, marker_lookup: Callable):
        """Requires external proof from the *committed* Windows DB marker table.

        marker_lookup(source, sale_id) must query the ACTUAL Windows DB and return
        {'sale_id': ..., 'revision': ..., 'windows_reference': ..., 'content_hash': ...}.
        A stub can be used in tests only. No manual 'mark paid' CLI is exposed.
        """
        if not callable(marker_lookup):
            raise StagingError('Vérification externe de la base Windows requise.')
        with self._write() as db:
            row = db.execute('SELECT * FROM sale_versions WHERE source=? AND sale_id=? AND revision=?', (SOURCE, sale_id, revision)).fetchone()
            if not row:
                raise StagingError('Vente ou version inconnue.')
            if row['state'] == 'verified':
                receipt = db.execute('SELECT windows_reference FROM receipts WHERE source=? AND sale_id=? AND revision=?', (SOURCE, sale_id, revision)).fetchone()
                marker = marker_lookup(SOURCE, sale_id)
                if not receipt or not isinstance(marker, dict) or receipt['windows_reference'] != marker.get('windows_reference') or row['content_hash'] != marker.get('content_hash') or revision != marker.get('revision'):
                    raise StagingError('Le marqueur Windows n’est plus cohérent.')
                return receipt['windows_reference']
            if row['state'] != 'pending':
                raise StagingError('Correction, annulation ou vente remplacée : revue humaine obligatoire.')
            marker = marker_lookup(SOURCE, sale_id)
            if not isinstance(marker, dict) or marker.get('sale_id') != sale_id or type(marker.get('revision')) is not int or marker['revision'] != revision or marker.get('content_hash') != row['content_hash'] or not isinstance(marker.get('windows_reference'), str) or not marker['windows_reference'].strip():
                raise StagingError('Preuve transactionnelle Windows absente ou différente : aucun accusé généré.')
            ref = marker['windows_reference']
            db.execute('INSERT INTO receipts(source,sale_id,revision,windows_reference,verified_at,marker_hash) VALUES (?,?,?,?,?,?)', (SOURCE,sale_id,revision,ref,utcnow(),digest(marker)))
            db.execute("UPDATE sale_versions SET state='verified' WHERE source=? AND sale_id=? AND revision=?", (SOURCE,sale_id,revision))
            return ref

    def summary(self):
        with closing(self._connect()) as db:
            by_state = {row['state']: row['n'] for row in db.execute('SELECT state,COUNT(*) AS n FROM sale_versions GROUP BY state')}
            return {'states': {s: by_state.get(s, 0) for s in VALID_STATES},
                    'receipts': db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0],
                    'snapshots': db.execute('SELECT COUNT(*) FROM import_runs').fetchone()[0]}


def main():
    parser = argparse.ArgumentParser(description='Staging local des ventes Ty Bufala Mobile. Ne modifie PAS ty_bufala.db.')
    parser.add_argument('--ledger', type=Path, required=True, help='Chemin PRIVÉ du journal SQLite de préparation')
    sub = parser.add_subparsers(dest='action', required=True)
    s = sub.add_parser('stage', help='Importer une sauvegarde centrale v2 de Work (sans accusé Windows)')
    s.add_argument('snapshot', type=Path)
    sub.add_parser('status', help='Afficher le nombre de ventes par état, sans données client')
    args = parser.parse_args()
    ledger = WindowsSaleLedger(args.ledger)
    if args.action == 'stage':
        data = json.loads(args.snapshot.read_text(encoding='utf-8'))
        print(json.dumps(ledger.stage_snapshot(data), ensure_ascii=False))
    else:
        print(json.dumps(ledger.summary(), ensure_ascii=False))


if __name__ == '__main__':
    main()