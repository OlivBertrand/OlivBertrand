#!/usr/bin/env python3
"""Safely migrate original Ty Bufala Excel inventory to a private SQLite seed.

Python standard library only. Includes a minimal READ-ONLY OOXML reader because
we must preserve both formula source and cached cell values. Never evaluates formulas.
Does not connect to OneDrive, Render, or the live Windows database.
"""
from __future__ import annotations

import argparse
import collections
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import posixpath
import re
import sqlite3
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'
COLUMN_RX = re.compile(r'^([A-Z]+)([1-9][0-9]*)$')
EXPECTED_SHEETS = ('Inventaire', 'Descendance', 'Événements')
DB_VERSION = 1


def stable_json(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def canon_id(val):
    return re.sub(r'\s+', '', str(val or '')).upper()


def norm_name(val):
    return ' '.join(unicodedata.normalize('NFKC', str(val or '')).casefold().split())


def excel_date(value):
    """Convert Excel 1900-based numeric date; do not infer dates from arbitrary text."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and 1 <= value <= 73050:
        try:
            result = datetime(1899, 12, 30) + timedelta(days=float(value))
            return result.date().isoformat()
        except (ValueError, OverflowError):
            return None
    # A source might contain a deliberately entered ISO date.
    if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        try:
            return datetime.strptime(value, '%Y-%m-%d').date().isoformat()
        except ValueError:
            return None
    return None


def to_txt(value):
    if value is None or value == '':
        return None
    return str(value).strip()


def col_index(letters):
    i = 0
    for c in letters:
        i = i * 26 + (ord(c) - 64)
    return i - 1


def read_workbook(path):
    """Yield every populated OR formula-only cell, retaining the cached value.

    Expects the original three-sheet layout; never modifies the source workbook.
    """
    with zipfile.ZipFile(path, 'r') as book:
        shared = []
        if 'xl/sharedStrings.xml' in book.namelist():
            root = ET.fromstring(book.read('xl/sharedStrings.xml'))
            for item in root.findall('m:si', NS):
                shared.append(''.join(n.text or '' for n in item.findall('.//m:t', NS)))
        # Resolve sheet paths by *sheet name*, not by assumed position/order.
        wb_root = ET.fromstring(book.read('xl/workbook.xml'))
        properties = wb_root.find('m:workbookPr', NS)
        if properties is not None and properties.get('date1904') in ('1', 'true'):
            raise ValueError('Classeur Excel date1904 : conversion des dates à adapter avant migration')
        rel_root = ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))
        rels = {r.get('Id'): r.get('Target') for r in rel_root.findall(REL)}
        sheet_paths = {}
        for tab in wb_root.findall('m:sheets/m:sheet', NS):
            target = rels.get(tab.get(RID))
            if not target:
                continue
            name = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            sheet_paths[tab.get('name')] = name
        result = {}
        for sheet in EXPECTED_SHEETS:
            name = sheet_paths.get(sheet)
            if name not in book.namelist():
                raise ValueError(f'Classeur incompatible : feuille {sheet} absente')
            root = ET.fromstring(book.read(name))
            rows = {}
            for row in root.findall('m:sheetData/m:row', NS):
                row_number = int(row.get('r'))
                cells = {}
                for cell in row.findall('m:c', NS):
                    address = cell.get('r', '')
                    m = COLUMN_RX.match(address)
                    if not m:
                        continue
                    col = col_index(m.group(1))
                    data_type = cell.get('t')
                    value_node = cell.find('m:v', NS)
                    formula_node = cell.find('m:f', NS)
                    raw = value_node.text if value_node is not None else None
                    if data_type == 's' and raw is not None:
                        val = shared[int(raw)]
                    elif data_type == 'inlineStr':
                        val = ''.join(n.text or '' for n in cell.findall('.//m:t', NS))
                    elif data_type in ('str', 'e'):
                        val = raw
                    elif data_type == 'b':
                        val = raw == '1'
                    elif raw is None:
                        val = None
                    else:
                        try:
                            val = int(raw) if '.' not in raw and 'E' not in raw.upper() else float(raw)
                        except ValueError:
                            val = raw
                    formula = (formula_node.text or '[shared formula: ' + str(formula_node.get('si')) + ']') if formula_node is not None else None
                    if val is not None or formula is not None:
                        cells[col] = {
                            'address': address, 'value': val, 'formula': formula,
                            'data_type': data_type, 'style': cell.get('s'),
                        }
                if cells:
                    rows[row_number] = cells
            result[sheet] = rows
        return result


def values(cells):
    return {k: v['value'] for k, v in cells.items()}


def create_db(input_path: Path, output_path: Path, schema_path: Path):
    if output_path.exists():
        raise FileExistsError(f'Base déjà existante, aucune modification : {output_path}')
    raw_file = input_path.read_bytes()
    sha = hashlib.sha256(raw_file).hexdigest()
    source_id = f'xlsx_{sha[:24]}'
    original = read_workbook(input_path)
    imported_at = utc_now()
    inv = original['Inventaire']
    animal_rows = []
    unresolved = []
    for row, cells in sorted(inv.items()):
        if row < 5:
            continue
        v = values(cells)
        tag_original = to_txt(v.get(21))
        if tag_original and canon_id(tag_original).startswith('FR'):
            if not re.fullmatch(r'FR[0-9]{10}', canon_id(tag_original)):
                unresolved.append((row, 'invalid_national_id', v))
            else:
                animal_rows.append((row, v))
        elif (v.get(0) or v.get(1) or v.get(2)):
            unresolved.append((row, 'name_or_work_number_without_national_id', v))
    tags = [canon_id(v[21]) for _, v in animal_rows]
    duplicates = [tag for tag, n in collections.Counter(tags).items() if n > 1]
    if duplicates:
        raise ValueError(f'Identifiants nationaux dupliqués dans le fichier source : {len(duplicates)} ; aucune DB créée')
    names = collections.defaultdict(list)
    by_id = {}
    for row, v in animal_rows:
        tag = canon_id(v[21])
        by_id[tag] = {'id': f'animal_{tag}', 'source_row': row, 'sex': to_txt(v.get(3))}
        if v.get(2):
            names[norm_name(v[2])].append(tag)

    connection = sqlite3.connect(output_path)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    try:
        connection.executescript(schema_path.read_text(encoding='utf-8'))
        with connection:
            connection.execute('INSERT INTO schema_migrations VALUES(?,?,?)',
                               (DB_VERSION, imported_at, 'Initial non-destructive livestock workbook migration'))
            connection.execute('INSERT INTO source_files VALUES(?,?,?,?,?, ?, ?)',
                               (source_id, input_path.name, sha, imported_at, 'initial_snapshot', 'xlsx',
                                'Original 3-sheet workbook; formulas and cached values retained per cell'))
            connection.execute('INSERT INTO source_archives VALUES(?,?,?)',
                               (source_id, len(raw_file), sqlite3.Binary(raw_file)))
            cell_records = []
            for sheet, rows in original.items():
                for row_number, cells in rows.items():
                    for c, data in cells.items():
                        cell_records.append((source_id, sheet, data['address'], row_number, c,
                                             stable_json(data['value']) if data['value'] is not None else None,
                                             data['formula'], data['data_type'], data['style']))
            connection.executemany('''INSERT INTO source_cells
                (source_id,sheet_name,cell_address,source_row,source_column,cached_value_json,source_formula,cell_type,cell_style)
                VALUES (?,?,?,?,?,?,?,?,?)''', cell_records)
            for row, v in animal_rows:
                tag_original = str(v[21]).strip()
                tag = canon_id(tag_original)
                status = 'sorti' if excel_date(v.get(15)) else 'present'
                connection.execute('''INSERT INTO animals
                  (id,national_id,national_id_original,work_number,name,sex,birth_date,
                   last_calving_date,mating_date,predicted_calving_date,weaning_date,introduced_at,
                   exited_at,exit_reason,notes,ede,lactation_potential_raw,summer_milk_raw,
                   status,source_id,source_row,original_fields_json,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                   (f'animal_{tag}', tag, tag_original, to_txt(v.get(1)), to_txt(v.get(2)),
                    to_txt(v.get(3)) if v.get(3) in ('F','M') else None,
                    excel_date(v.get(4)), excel_date(v.get(6)), excel_date(v.get(8)),
                    excel_date(v.get(9)), excel_date(v.get(13)), excel_date(v.get(14)),
                    excel_date(v.get(15)), to_txt(v.get(16)), to_txt(v.get(17)),
                    to_txt(v.get(18)), stable_json(v.get(19)) if v.get(19) is not None else None,
                    stable_json(v.get(20)) if v.get(20) is not None else None,
                    status, source_id, row, stable_json({str(k): x for k,x in v.items()}), imported_at, imported_at))
            parent_counts = collections.Counter()
            for row, v in animal_rows:
                child_tag = canon_id(v[21]); child_id = f'animal_{child_tag}'
                for role, col in [('mother',11),('father',10)]:
                    reference = to_txt(v.get(col))
                    if not reference or reference in ('?', '—', '-'):
                        continue
                    tag_ref = canon_id(reference)
                    parent_id = None
                    candidates = []
                    state = 'unresolved'
                    if tag_ref in by_id and tag_ref != child_tag:
                        parent_id = by_id[tag_ref]['id'];state = 'exact_id'
                    else:
                        candidates = [t for t in names.get(norm_name(reference), []) if t!=child_tag]
                        if len(candidates) == 1:
                            parent_id = by_id[candidates[0]]['id'];state='unique_name'
                        elif len(candidates)>1:
                            state='ambiguous'
                    parent_counts[(role,state)]+=1
                    connection.execute('''INSERT INTO animal_parents
                         (child_id,parent_role,parent_id,original_reference,resolution_status,candidate_ids_json,confirmed,source_row)
                         VALUES(?,?,?,?,?,?,?,?)''',
                         (child_id,role,parent_id,reference,state,stable_json([by_id[t]['id'] for t in candidates]),
                          int(state=='exact_id'),row))
                for kind, col, detail in [('Introduction',14,None),('Sortie',15,to_txt(v.get(16)))]:
                    day = excel_date(v.get(col))
                    if not day: continue
                    connection.execute('''INSERT INTO animal_events
                       (id,animal_id,event_type,event_date,date_precision,description,details_json,source_id,
                        source_sheet,source_row,origin,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                       (f'legacy:{kind.casefold()}:{child_tag}',child_id,kind,day,'day',detail,
                        stable_json({'legacy_field':col,'derived_from_date_column':True}),source_id,
                        'Inventaire',row,'legacy_inventory_field',imported_at,imported_at))
            for row, reason, raw_values in unresolved:
                connection.execute('INSERT INTO unresolved_inventory_rows VALUES(?,?,?,?)',
                                   (source_id,row, reason, stable_json({str(k): v for k,v in raw_values.items()})))
            for row, cells in sorted(original['Descendance'].items()):
                v = values(cells)
                if row<=2 or not to_txt(v.get(0)):
                    continue
                n=v.get(1)
                if not isinstance(n,(int,float)):
                    n=None
                connection.execute('''INSERT INTO legacy_descendance
                    (source_id,source_row,mother_label,cached_count,descendant_labels_json) VALUES (?,?,?,?,?)''',
                    (source_id,row,to_txt(v.get(0)),n,stable_json([str(v[c]) for c in range(2,22) if v.get(c)])))
            for row, cells in sorted(original['Événements'].items()):
                v=values(cells)
                if row<=3:continue
                label=to_txt(v.get(1)); event_type=to_txt(v.get(2)); description=to_txt(v.get(3))
                day=excel_date(v.get(0))
                if event_type:
                    matches=names.get(norm_name(label),[])
                    animal_id = by_id[matches[0]]['id'] if len(matches)==1 else None
                    connection.execute('''INSERT INTO animal_events
                       (id,animal_id,target_reference,event_type,event_date,date_precision,description,
                        details_json,source_id,source_sheet,source_row,origin,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                       (f'event_import_{row}',animal_id,label,event_type,day,'day' if day else 'unknown',
                        description,stable_json({'source_sheet':'Événements','linked_by':'unique_name' if animal_id else 'unresolved'}),
                        source_id,'Événements',row,'legacy_event_sheet',imported_at,imported_at))
                elif day or label or description:
                    connection.execute('INSERT INTO farm_notes VALUES(?,?,?,?,?,?,?)',
                                       (f'farm_note_{row}',day,label,description,source_id,'Événements',row))
        check=connection.execute('PRAGMA quick_check').fetchone()[0]
        foreign=connection.execute('PRAGMA foreign_key_check').fetchall()
        if check!='ok' or foreign:
            raise ValueError(f'Contrôle SQLite échoué : quick_check={check}, foreign_keys={len(foreign)}')
        counts={name:connection.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0] for name in
               ('source_cells','animals','animal_parents','animal_events','legacy_descendance','farm_notes','unresolved_inventory_rows')}
        counts['present']=connection.execute("SELECT COUNT(*) FROM animals WHERE status='present'").fetchone()[0]
        counts['sorti']=connection.execute("SELECT COUNT(*) FROM animals WHERE status='sorti'").fetchone()[0]
        counts['unnamed']=connection.execute("SELECT COUNT(*) FROM animals WHERE name IS NULL").fetchone()[0]
        counts['parent_resolution']={f'{k[0]}_{k[1]}':v for k,v in parent_counts.items()}
        counts['source_sha256']=sha
        counts['database_path']=str(output_path)
        counts['sqlite_check']=check
        return counts
    except BaseException:
        connection.close()
        output_path.unlink(missing_ok=True)
        raise
    finally:
        connection.close()


def check_db(path):
    connection=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
    try:
        return {
            'quick_check':connection.execute('PRAGMA quick_check').fetchone()[0],
            'user_version':connection.execute('PRAGMA user_version').fetchone()[0],
            'foreign_key_issues':len(connection.execute('PRAGMA foreign_key_check').fetchall()),
            'animals':connection.execute('SELECT COUNT(*) FROM animals').fetchone()[0],
            'present':connection.execute("SELECT COUNT(*) FROM animals WHERE status='present'").fetchone()[0],
            'exited':connection.execute("SELECT COUNT(*) FROM animals WHERE status='sorti'").fetchone()[0],
            'unnamed':connection.execute('SELECT COUNT(*) FROM animals WHERE name IS NULL').fetchone()[0],
            'source_cells':connection.execute('SELECT COUNT(*) FROM source_cells').fetchone()[0],
            'exact_source_backup':(lambda row: row and hashlib.sha256(row[1]).hexdigest()==row[0])(
                connection.execute('SELECT f.sha256, a.contents FROM source_files f JOIN source_archives a USING(source_id)').fetchone()),
            'events':connection.execute('SELECT COUNT(*) FROM animal_events').fetchone()[0],
            'sales':connection.execute('SELECT COUNT(*) FROM sales').fetchone()[0],
        }
    finally:connection.close()


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,help='Original private .xlsx workbook')
    parser.add_argument('--output',type=Path,help='New SQLite .db or .sqlite3 path')
    parser.add_argument('--check',type=Path,help='Read-only SQLite validation')
    args=parser.parse_args(argv)
    if args.check:
        print(json.dumps(check_db(args.check),indent=2,ensure_ascii=False));return
    if not args.input or not args.output:parser.error('--input and --output are required unless --check')
    report=create_db(args.input,args.output,Path(__file__).with_name('schema_v1.sql'))
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=='__main__':main()