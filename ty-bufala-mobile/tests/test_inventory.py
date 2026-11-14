import base64
import hashlib
from openpyxl import Workbook
from server.inventory import extract, import_initial
from server.store import Store


def test_source_preserved_undated_and_unidentified(tmp_path):
    path=tmp_path/'private.xlsx';w=Workbook();s=w.active;s.title='Inventaire'
    for cell,value in {'A4':'N° national','B4':'N° Travail','C4':'Nom','P4':'Sortie','V4':'id Global'}.items():s[cell]=value
    from datetime import datetime
    for col,value in {'A':'FR000000','B':'0001','C':'Mère test','D':'F','E':datetime(2020,1,1),'V':'FR0000000001'}.items():s[col+'5']=value
    s['C6']='Nouveau non identifié';s['E6']=datetime(2026,10,1)
    w.create_sheet('Descendance')['A1']='=1+1'
    e=w.create_sheet('Événements');e.append(['Historique']);e.append([]);e.append(['Date','Mère','Type','Remarque']);e.append([None,'Mère test','Observation','Date inconnue'])
    w.save(path);before=hashlib.sha256(path.read_bytes()).hexdigest()
    animals,events,report=extract(path)
    assert len(animals)==len(events)==1
    assert events[0]['dateUnknown'] and events[0]['date']==''
    assert any(i['issue']=='unidentified_source_row' for i in report['anomalies'])
    store=Store(str(tmp_path/'shared.db'));store.initialize()
    import_initial(store,path,{'id':'test_admin','role':'admin'})
    import_initial(store,path,{'id':'test_admin','role':'admin'})
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS n FROM records').fetchone()['n']==2
        archive=db.execute('SELECT archive FROM imports').fetchone()['archive']
    assert base64.b64decode(archive)==path.read_bytes()
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
