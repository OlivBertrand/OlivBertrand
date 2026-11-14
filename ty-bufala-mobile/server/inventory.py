"""Read XLSX without saving it: preserve formulas, source cells and undated events."""
import argparse
import hashlib
import json
import os
import uuid
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from openpyxl import load_workbook
from .domain import tag, apply_operations
from .store import Store

NS = uuid.UUID('34b336e4-c139-48af-9e49-b1ea08c0964a')


def scalar(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if hasattr(v, 'text'):
        return {'formula': v.text, 'ref': v.ref}
    return v


def iso(v):
    return v.date().isoformat() if isinstance(v, datetime) else v.isoformat() if isinstance(v, date) else ''


def extract(path):
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    book, cache = load_workbook(path, data_only=False), load_workbook(path, data_only=True)
    sheet, values = book['Inventaire'], cache['Inventaire']
    if any(sheet[c].value != v for c, v in {'A4': 'N° national', 'B4': 'N° Travail', 'C4': 'Nom', 'P4': 'Sortie', 'V4': 'id Global'}.items()):
        raise ValueError('Structure Excel différente : revoir le mapping avant import.')
    animals, events, issues = [], [], []
    for row in range(5, sheet.max_row + 1):
        prefix, number, name = [values.cell(row, c).value for c in (1, 2, 3)]
        input_columns = (1,2,3,4,5,9,11,12,14,15,16,17,18,19,20,21)
        if not any(sheet.cell(row,c).value not in (None,'',0) and sheet.cell(row,c).data_type != 'f' for c in input_columns):
            continue
        number_text = str(number or '').strip()
        fmt = sheet.cell(row, 2).number_format
        if isinstance(number, (int, float)) and float(number).is_integer():
            number_text = str(int(number))
            if fmt and set(fmt) == {'0'}:
                number_text = number_text.zfill(len(fmt))
        constructed = tag(str(prefix or '') + number_text)
        national = tag(values.cell(row, 22).value) or constructed
        if not national:
            issues.append({'row': row, 'issue': 'unidentified_source_row', 'cells': {c.column_letter: {'value': scalar(c.value), 'cached': scalar(values.cell(row, c.column).value)} for c in sheet[row]}})
            continue
        if national != constructed:
            issues.append({'row': row, 'issue': 'identification_differs', 'cached': national, 'fromColumns': constructed})
        a = {'id': 'animal_' + uuid.uuid5(NS, national).hex, 'earTag': national, 'workNumber': number_text,
             'name': str(name or ''), 'sex': str(values.cell(row, 4).value or '').upper(),
             'fatherName': str(values.cell(row, 11).value or ''), 'motherName': str(values.cell(row, 12).value or ''),
             'notes': str(values.cell(row, 18).value or ''), 'exitReason': str(values.cell(row, 17).value or ''),
             'source': 'excel-inventory', 'sourceRow': row, 'sourceDigest': digest,
             'sourceCells': {c.column_letter: {'value': scalar(c.value), 'cached': scalar(values.cell(row, c.column).value), 'format': c.number_format} for c in sheet[row]}}
        for key, col in {'birthDate': 5, 'lastCalving': 7, 'matingDate': 9, 'expectedCalving': 10, 'weaningDate': 14, 'introducedAt': 15, 'exitDate': 16}.items():
            raw = values.cell(row, col).value
            a[key] = iso(raw)
            if raw not in (None, '', 0) and not a[key]:
                issues.append({'row': row, 'issue': 'unparsed_date', 'field': key, 'raw': scalar(raw)})
        a['status'] = 'sorti' if a['exitDate'] else 'present'
        a['expectedCalvingEvidence'] = 'source_unconfirmed'
        animals.append(a)
    if any(count > 1 for count in Counter(a['earTag'] for a in animals).values()):
        raise ValueError('Identifications en doublon : import bloqué.')
    def matches(raw):
        q = str(raw or '').strip().casefold()
        return [a for a in animals if q and q in (a['earTag'].casefold(), a['name'].strip().casefold(), a['workNumber'].strip().casefold())]
    for a in animals:
        for rel in ('mother', 'father'):
            raw = a[rel + 'Name']
            found = matches(raw)
            a[rel + 'Tag'] = found[0]['earTag'] if len(found) == 1 else ''
            a[rel + 'Evidence'] = 'exact_source_match' if len(found) == 1 else 'external_or_uncertain'
            if raw and len(found) != 1:
                issues.append({'row': a['sourceRow'], 'issue': rel + '_unresolved', 'raw': raw})
    for row in range(4, cache['Événements'].max_row + 1):
        vals = [cache['Événements'].cell(row, c).value for c in range(1, 5)]
        if not any(v is not None for v in vals):
            continue
        found = matches(vals[1])
        if len(found) != 1:
            issues.append({'eventRow': row, 'issue': 'event_animal_unresolved', 'raw': [scalar(v) for v in vals]})
            continue
        events.append({'id': 'event_' + uuid.uuid5(NS, 'historical:' + str(row) + ':' + str(vals)).hex,
                       'animalId': found[0]['id'], 'date': iso(vals[0]), 'dateUnknown': not bool(iso(vals[0])),
                       'type': str(vals[2] or 'Observation'), 'description': str(vals[3] or ''),
                       'source': 'excel-events', 'sourceRow': row, 'sourceDigest': digest,
                       'sourceCells': {str(c + 1): scalar(v) for c, v in enumerate(vals)}})
    report = {'sourceDigest': digest, 'animals': len(animals), 'present': sum(a['status'] == 'present' for a in animals),
              'exited': sum(a['status'] == 'sorti' for a in animals), 'historicalEvents': len(events),
              'motherLinks': sum(bool(a['motherTag']) for a in animals), 'anomalies': issues,
              'sheets': [{'name': s.title, 'rows': s.max_row, 'columns': s.max_column,
                          'formulas': sum(c.data_type == 'f' or hasattr(c.value, 'text') for r in s for c in r)} for s in book]}
    return animals, events, report


def import_initial(store, path, actor):
    animals, events, report = extract(path)
    ops = [{'opId': 'initial_' + r['id'], 'kind': kind, 'deviceId':'server_initial_import', 'baseRevision': 0, 'data': r}
           for kind, records in [('animals', animals), ('events', events)] for r in records]
    apply_operations(store, actor, ops, initial_import=(report['sourceDigest'], Path(path).name, __import__('base64').b64encode(Path(path).read_bytes()).decode(), json.dumps(report, ensure_ascii=False)))
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument('workbook')
    p.add_argument('--report', required=True, help='Chemin privé hors dépôt')
    p.add_argument('--apply', action='store_true')
    p.add_argument('--actor')
    args = p.parse_args()
    _, _, report = extract(args.workbook)
    if args.apply:
        store = Store(os.environ['DATABASE_URL'])
        store.initialize()
        with store.transaction() as db:
            actor = db.execute('SELECT * FROM users WHERE id=? AND active=1', (args.actor,)).fetchone()
        if not actor or actor['role'] != 'admin':
            p.error('Compte administrateur actif nécessaire')
        report = import_initial(store, args.workbook, dict(actor))
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('animals', 'present', 'exited', 'historicalEvents', 'motherLinks')}, ensure_ascii=False))
    print('Original inchangé. Anomalies détaillées dans le rapport privé.')


if __name__ == '__main__':
    main()
