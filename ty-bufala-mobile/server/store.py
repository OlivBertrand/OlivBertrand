"""Transactional store. SQLite is for local tests; Render requires PostgreSQL."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


class Store:
    def __new__(cls, url):
        if url == "onedrive-journal://":
            if os.environ.get('TB_ONEDRIVE_FAST_REPLAY') == '1':
                from .cached_onedrive_store import CachedJournalStore
                return CachedJournalStore.from_environment()
            from .onedrive_store import JournalStore
            return JournalStore.from_environment()
        return super().__new__(cls)

    def __init__(self, url):
        self.url = url
        self.postgres = url.startswith(('postgres://', 'postgresql://'))
        if not self.postgres and os.environ.get('RENDER'):
            raise RuntimeError('Render requires DATABASE_URL pointing to durable PostgreSQL.')

    @contextmanager
    def transaction(self, write=False):
        if self.postgres:
            import psycopg
            from psycopg.rows import dict_row
            db = psycopg.connect(self.url, row_factory=dict_row)
        else:
            db = sqlite3.connect(self.url, timeout=30)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
        try:
            yield Connection(db, self.postgres)
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def initialize(self):
        seq = 'BIGSERIAL PRIMARY KEY' if self.postgres else 'INTEGER PRIMARY KEY AUTOINCREMENT'
        statements = [
            'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)',
            'CREATE TABLE IF NOT EXISTS devices (id TEXT NOT NULL, user_id TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY(id,user_id))',
            'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires BIGINT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_time BIGINT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, author TEXT NOT NULL, device_id TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY(kind,id))',
            'CREATE TABLE IF NOT EXISTS identities (tag TEXT PRIMARY KEY, animal_id TEXT NOT NULL)',
            f'CREATE TABLE IF NOT EXISTS changes (seq {seq}, kind TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, author TEXT NOT NULL, device_id TEXT NOT NULL, changed_at TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS imports (digest TEXT PRIMARY KEY, source TEXT NOT NULL, archive TEXT NOT NULL, report TEXT NOT NULL, imported_at TEXT NOT NULL)',
        ]
        with self.transaction(write=True) as db:
            for sql in statements:
                db.execute(sql)
            db.execute("INSERT INTO metadata(key,value) VALUES ('schema','1') ON CONFLICT(key) DO NOTHING")
            db.execute("INSERT INTO metadata(key,value) VALUES ('write_lock','0') ON CONFLICT(key) DO NOTHING")

    @staticmethod
    def lock(db):
        # A database lock, shared by every worker. Serializes revisions and commit cursors.
        db.execute("UPDATE metadata SET value=value WHERE key='write_lock'")


class Connection:
    def __init__(self, db, postgres):
        self.db, self.postgres = db, postgres

    def execute(self, sql, parameters=()):
        return self.db.execute(sql.replace('?', '%s') if self.postgres else sql, parameters)
