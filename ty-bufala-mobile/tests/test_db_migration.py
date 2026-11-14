"""Offline tests; all livestock names and identifiers below are synthetic."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

MODULE_PATH=Path(__file__).resolve().parents[1]/'db'/'migrate_inventory.py'
spec=importlib.util.spec_from_file_location('tybufala_db_migrate',MODULE_PATH)
migration=importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
SCHEMA=MODULE_PATH.parent/'schema_v1.sql'


def make_fake_book(path, duplicate=False):
    workbook='''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
      <sheet name="Descendance" sheetId="1" r:id="rId1"/><sheet name="Événements" sheetId="2" r:id="rId2"/><sheet name="Inventaire" sheetId="3" r:id="rId3"/></sheets></workbook>'''
    rels='''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Id="rId3" Target="worksheets/sheet3.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'''
    def xml(body):return f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{body}</sheetData></worksheet>'
    def inline(col,row,text):return f'<c r="{col}{row}" t="inlineStr"><is><t>{text}</t></is></c>'
    def num(col,row,n):return f'<c r="{col}{row}"><v>{n}</v></c>'
    raw=(f'<row r="5">{inline("V",5,"FR1234567890")}{inline("C",5,"Nora")}{inline("D",5,"F")}'
          f'{num("E",5,45100)}{num("P",5,45500)}{inline("L",5,"Autre mère")}'
          '<c r="AA5"><f t="shared" si="3"/></c></row>')
    if duplicate:
        raw+=f'<row r="6">{inline("V",6,"FR1234567890")}{inline("D",6,"M")}</row>'
    events=f'<row r="4">{inline("B",4,"Nora")}{inline("C",4,"Mort-né / décès")}{inline("D",4,"date inconnue")}</row>'
    descent=f'<row r="3">{inline("A",3,"Nora")}{num("B",3,1)}{inline("C",3,"Enfant")}</row>'
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('xl/workbook.xml',workbook)
        z.writestr('xl/_rels/workbook.xml.rels',rels)
        z.writestr('xl/worksheets/sheet1.xml',xml(descent))
        z.writestr('xl/worksheets/sheet2.xml',xml(events))
        z.writestr('xl/worksheets/sheet3.xml',xml(raw))


class MigrationTests(unittest.TestCase):
    def test_excel_date(self):
        self.assertEqual(migration.excel_date(46228),'2026-07-25')
        self.assertIsNone(migration.excel_date(0))
        self.assertIsNone(migration.excel_date('hier'))

    def test_normalisation_preserves_source(self):
        self.assertEqual(migration.canon_id(' FR 1234567890 '),'FR1234567890')
        self.assertEqual(migration.norm_name(' NoRA '),'nora')

    def test_three_sheets_by_name_not_order_and_unknown_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'sample.xlsx'; target=Path(tmp)/'output.sqlite3'
            make_fake_book(source)
            sha=__import__('hashlib').sha256(source.read_bytes()).hexdigest()
            r=migration.create_db(source,target,SCHEMA)
            self.assertEqual(r['animals'],1)
            self.assertEqual(r['sorti'],1)
            self.assertEqual(r['legacy_descendance'],1)
            self.assertEqual(r['parent_resolution']['mother_unresolved'],1)
            self.assertEqual(__import__('hashlib').sha256(source.read_bytes()).hexdigest(),sha)
            c=sqlite3.connect(target)
            try:
                self.assertEqual(c.execute('select event_date from animal_events where id="event_import_4"').fetchone()[0],None)
                self.assertEqual(c.execute('select source_formula from source_cells where sheet_name="Inventaire" and cell_address="AA5"').fetchone()[0],'[shared formula: 3]')
                self.assertEqual(c.execute('select national_id_original from animals').fetchone()[0],'FR1234567890')
                self.assertEqual(c.execute('select count(*) from v_active_animals').fetchone()[0],0)
                self.assertEqual(c.execute('pragma foreign_key_check').fetchall(),[])
                with self.assertRaises(sqlite3.IntegrityError):c.execute('delete from animals')
            finally:c.close()
            with self.assertRaises(FileExistsError):migration.create_db(source,target,SCHEMA)
            self.assertEqual(migration.check_db(target)['animals'],1)

    def test_duplicate_national_id_aborts_before_creating_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'dup.xlsx'; target=Path(tmp)/'ref.db'
            make_fake_book(source,duplicate=True)
            with self.assertRaisesRegex(ValueError,'dupliqu'):
                migration.create_db(source,target,SCHEMA)
            self.assertFalse(target.exists())

    def test_sale_idempotency_and_money_constraints(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=Path(tmp)/'test.sqlite3';source=Path(tmp)/'sample.xlsx';make_fake_book(source)
            migration.create_db(source,db,SCHEMA)
            c=sqlite3.connect(db)
            try:
                c.execute('insert into sales (id,source_system,source_object_id,sale_date,created_at,updated_at) values(?,?,?,?,?,?)',
                          ('sale-1','mobile','uuid-1','2026-11-14','2026','2026'))
                with self.assertRaises(sqlite3.IntegrityError):
                    c.execute('insert into sales (id,source_system,source_object_id,sale_date,created_at,updated_at) values(?,?,?,?,?,?)',
                              ('sale-2','mobile','uuid-1','2026-11-14','2026','2026'))
                with self.assertRaises(sqlite3.IntegrityError):
                    c.execute('insert into sale_lines(id,sale_id,line_number,product_label,quantity_milli,unit,unit_price_gross_cents,line_gross_cents) values(?,?,?,?,?,?,?,?)',
                              ('item','sale-1',1,'Mozzarella',0,'pièce',500,0))
            finally:c.close()


if __name__=='__main__':unittest.main()