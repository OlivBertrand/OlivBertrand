"""Read-only bridge from the private reference SQLite registry to the shared store.

Keeps the source database byte-for-byte in the private import archive. Never
imports sales or Windows acknowledgements using an unverified business mapping.
"""
import argparse
import base64
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from .domain import apply_operations
from .store import Store


def extract_reference(path):
    path = Path(path).resolve()
    if any(Path(str(path) + suffix).exists() for suffix in ('-wal', '-journal')):
        raise ValueError('Copie SQLite fermée et cohérente requise : journal actif présent.')
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Intégrité de la base source invalide.')
        version = db.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0]
        if version != 1:
            raise ValueError('Version de référence inconnue : revoir le mapping.')
        tables = [r['name'] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        counts = {t: db.execute('SELECT COUNT(*) FROM "' + t.replace('"', '""') + '"').fetchone()[0] for t in tables}
        # Refuse a future populated reference schema until these modules are mapped.
        for table in ('sales', 'sale_lines', 'sale_payments', 'veterinary_treatments', 'event_attachments',
                      'sync_operations', 'sync_conflicts', 'audit_log'):
            if counts.get(table):
                raise ValueError('Table ' + table + ' non vide : raccordement dédié requis, aucun import partiel.')
        for archive in db.execute('SELECT f.sha256,a.contents,a.original_size_bytes FROM source_files f JOIN source_archives a ON a.source_id=f.source_id'):
            if (len(archive['contents']) != archive['original_size_bytes'] or
                    hashlib.sha256(archive['contents']).hexdigest() != archive['sha256']):
                raise ValueError('Archive Excel source incohérente.')
        parents = {}
        for row in db.execute('SELECT * FROM animal_parents ORDER BY child_id,parent_role'):
            parents.setdefault(row['child_id'], []).append(dict(row))
        rows = [dict(row) for row in db.execute('SELECT * FROM animals ORDER BY id')]
        tags = {row['id']: row['national_id'] for row in rows}
        fields = {'earTag': 'national_id', 'workNumber': 'work_number', 'name': 'name', 'sex': 'sex',
                  'birthDate': 'birth_date', 'lastCalving': 'last_calving_date', 'matingDate': 'mating_date',
                  'expectedCalving': 'predicted_calving_date', 'weaningDate': 'weaning_date',
                  'introducedAt': 'introduced_at', 'exitDate': 'exited_at', 'exitReason': 'exit_reason',
                  'notes': 'notes', 'status': 'status'}
        animals = []
        for row in rows:
            if row['deleted_at']:
                raise ValueError('Animal archivé dans la référence : mapping à valider avant import.')
            animal = {key: row[column] or '' for key, column in fields.items()}
            animal.update(id=row['id'], source='reference-sqlite-v1', sourceDigest=digest,
                          sourceRow=row['source_row'], sourceCells=json.loads(row['original_fields_json']),
                          expectedCalvingEvidence=row['predicted_calving_status'],
                          referenceParents=parents.get(row['id'], []),
                          sourceReference={k: v for k, v in row.items() if k != 'original_fields_json'})
            for parent in animal['referenceParents']:
                role = parent['parent_role']
                animal[role + 'Name'] = parent['original_reference']
                animal[role + 'Evidence'] = parent['resolution_status'] + ('_confirmed' if parent['confirmed'] else '_unconfirmed')
                candidate = tags.get(parent['parent_id'], '')
                # A unique name remains a PROPOSAL, never a confirmed genealogical link.
                animal[role + 'CandidateTag'] = candidate
                animal[role + 'Tag'] = candidate if parent['confirmed'] else ''
            animals.append(animal)
        events = []
        for source_row in db.execute('SELECT * FROM animal_events ORDER BY id'):
            row = dict(source_row)
            if row['tombstone']:
                raise ValueError('Événement annulé dans la référence : mapping à valider.')
            events.append({'id': row['id'], 'animalId': row['animal_id'], 'type': row['event_type'],
                           'date': row['event_date'] or '', 'dateUnknown': row['date_precision'] == 'unknown',
                           'description': row['description'] or '', 'nextDate': row['next_date'] or '',
                           'source': 'reference-sqlite-v1', 'sourceDigest': digest, 'sourceRow': row['source_row'],
                           'sourceReference': row})
        report = {'sourceDigest': digest, 'archiveFormat': 'sqlite-reference-v1', 'animals': len(animals),
                  'present': sum(a['status'] == 'present' for a in animals),
                  'exited': sum(a['status'] == 'sorti' for a in animals), 'historicalEvents': len(events),
                  'unconfirmedParents': sum(not p['confirmed'] for ps in parents.values() for p in ps),
                  'sourceTableCounts': counts, 'ancillaryData': {}}
        for table in ('farm_notes', 'unresolved_inventory_rows', 'legacy_descendance'):
            report['ancillaryData'][table] = [dict(r) for r in db.execute('SELECT * FROM ' + table)]
    finally:
        db.close()
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError('Source modifiée pendant la lecture : recommencer.')
    return animals, events, report, content


def import_reference(store, path, actor):
    animals, events, report, content = extract_reference(path)
    operations = [{'opId': 'reference_' + hashlib.sha256((kind + ':' + row['id']).encode()).hexdigest(), 'deviceId': 'server_reference_import',
                   'kind': kind, 'baseRevision': 0, 'data': row}
                  for kind, rows in [('animals', animals), ('events', events)] for row in rows]
    apply_operations(store, actor, operations, initial_import=(report['sourceDigest'], Path(path).name,
                     base64.b64encode(content).decode(), json.dumps(report, ensure_ascii=False)))
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument('reference', type=Path)
    p.add_argument('--report', type=Path, required=True, help='Chemin privé hors dépôt')
    p.add_argument('--apply', action='store_true')
    p.add_argument('--actor')
    args = p.parse_args()
    _, _, report, _ = extract_reference(args.reference)
    if args.apply:
        store = Store(os.environ['DATABASE_URL']); store.initialize()
        with store.transaction() as db:
            actor = db.execute('SELECT * FROM users WHERE id=? AND active=1', (args.actor,)).fetchone()
        if not actor or actor['role'] != 'admin':
            p.error('Compte administrateur actif nécessaire')
        report = import_reference(store, args.reference, dict(actor))
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    os.chmod(args.report, 0o600)
    print(json.dumps({k: report[k] for k in ('animals', 'present', 'exited', 'historicalEvents', 'unconfirmedParents')}))


if __name__ == '__main__':
    main()
