import base64
import hashlib
import json
import sqlite3
import pytest
from server.reference_import import import_reference, extract_reference
from server.store import Store


@pytest.fixture
def source(tmp_path):
    path = tmp_path/'synthetic.db'
    db = sqlite3.connect(path)
    fields = ['id','national_id','national_id_original','work_number','name','sex','birth_date',
              'last_calving_date','mating_date','predicted_calving_date','predicted_calving_status',
              'weaning_date','introduced_at','exited_at','exit_reason','notes','status','source_id',
              'source_row','original_fields_json','deleted_at']
    db.execute('CREATE TABLE animals (' + ','.join(x+' TEXT' for x in fields) + ')')
    db.execute('CREATE TABLE schema_migrations(version INTEGER)'); db.execute('INSERT INTO schema_migrations VALUES (1)')
    db.execute('CREATE TABLE source_files(source_id TEXT,sha256 TEXT)')
    db.execute('CREATE TABLE source_archives(source_id TEXT,contents BLOB,original_size_bytes INTEGER)')
    original=b'synthetic-workbook-bytes'
    db.execute('INSERT INTO source_files VALUES (?,?)',('source',hashlib.sha256(original).hexdigest()))
    db.execute('INSERT INTO source_archives VALUES (?,?,?)',('source',original,len(original)))
    db.execute('CREATE TABLE animal_parents(child_id TEXT,parent_role TEXT,parent_id TEXT,original_reference TEXT,resolution_status TEXT,confirmed INTEGER)')
    db.execute('CREATE TABLE animal_events(id TEXT,animal_id TEXT,event_type TEXT,event_date TEXT,date_precision TEXT,description TEXT,next_date TEXT,source_row INTEGER,tombstone INTEGER)')
    for table in ('farm_notes','unresolved_inventory_rows','legacy_descendance','sales'):
        db.execute('CREATE TABLE '+table+'(id TEXT,note TEXT)')
    db.execute("INSERT INTO farm_notes VALUES ('note','Synthetic farm note')")
    for id,tag,sex,name,birth in [('mother','FR0000000001','F','Mother','2020-01-01'),('child','FR0000000002','M','Child','2025-01-01')]:
        row={x:None for x in fields}
        row.update(id=id,national_id=tag,sex=sex,name=name,birth_date=birth,status='present',
                   original_fields_json='{"A":"synthetic"}',predicted_calving_status='estimate_unverified')
        db.execute('INSERT INTO animals VALUES ('+','.join('?' for _ in fields)+')',[row[x] for x in fields])
    db.execute("INSERT INTO animal_parents VALUES ('child','mother','mother','Mother','unique_name',0)")
    db.execute("INSERT INTO animal_events VALUES ('event:historic:1','child','Observation',NULL,'unknown','Unknown date',NULL,4,0)")
    db.commit();db.close()
    return path


def test_reference_preserves_ids_uncertainty_archive_and_reimport(source,tmp_path):
    before=source.read_bytes()
    store=Store(str(tmp_path/'shared.db'));store.initialize()
    report=import_reference(store,source,{'id':'test-admin','role':'admin'})
    import_reference(store,source,{'id':'test-admin','role':'admin'})
    with store.transaction() as db:
        records=db.execute('SELECT kind,id,data FROM records').fetchall()
        assert len(records)==3
        child=next(json.loads(r['data']) for r in records if r['id']=='child')
        assert child['motherTag']=='' and child['motherCandidateTag']=='FR0000000001'
        assert child['motherEvidence']=='unique_name_unconfirmed'
        assert any(r['id']=='event:historic:1' and json.loads(r['data'])['dateUnknown'] for r in records)
        assert base64.b64decode(db.execute('SELECT archive FROM imports').fetchone()['archive'])==before
        assert db.execute('SELECT COUNT(*) AS n FROM changes').fetchone()['n']==3
    assert report['ancillaryData']['farm_notes'][0]['note']=='Synthetic farm note'
    assert source.read_bytes()==before


def test_nonempty_unmapped_sales_refuse_before_import(source,tmp_path):
    db=sqlite3.connect(source);db.execute("INSERT INTO sales VALUES ('sale','unmapped')");db.commit();db.close()
    store=Store(str(tmp_path/'shared.db'));store.initialize()
    with pytest.raises(ValueError,match='raccordement dédié'):
        import_reference(store,source,{'id':'test-admin','role':'admin'})
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM records').fetchone()[0]==0


def test_corrupt_workbook_archive_refuses_import(source):
    db=sqlite3.connect(source);db.execute("UPDATE source_files SET sha256='broken'");db.commit();db.close()
    with pytest.raises(ValueError,match='Archive Excel'):
        extract_reference(source)
