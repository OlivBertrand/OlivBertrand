import sqlite3
from test_api import app,login,animal,op,push
from windows.herd_sync import HerdSync,SyncError


class Transport:
    def __init__(self,client,headers):self.client=client;self.headers=headers;self.offline=False;self.lose=False
    def request(self,path,payload=None):
        if self.offline:raise OSError('Hors connexion')
        response=self.client.get('/api/'+path) if payload is None else self.client.post('/api/'+path,headers=self.headers,json=payload)
        if self.lose and path=='sync':self.lose=False;raise OSError('Réponse perdue après commit')
        if response.status_code>=400:raise SyncError(response.json['error'],response.status_code,response.json)
        return response.json


def test_bidirectional_events_restart_replay_cancel_and_conflict(app,tmp_path):
    mobile,mh=login(app,'alice');wc,wh=login(app,'suzanna')
    assert push(mobile,mh,[op(animal())]).status_code==200
    transport=Transport(wc,wh);path=tmp_path/'synthetic-existing-business.db'
    def connect():return sqlite3.connect(path)
    windows=HerdSync(connect,transport,{'id':'suzanna','role':'editor'});windows.initialize_development();windows.sync()
    positive={'id':'diagnosis','animalId':'animal_a','type':'Échographie','date':'2026-11-01','result':'positive','confirmation':'confirmed'}
    assert push(mobile,mh,[op(positive,id='positive',kind='events')]).status_code==200
    windows.sync();assert windows.records('events')[0]['result']=='positive'
    transport.offline=True;windows.save([{'kind':'events','data':{**windows.records('events')[0],'result':'negative'}}]);windows.sync()
    assert len(windows.pending())==1 and windows.records('events')[0]['_sync']=='pending'
    restarted=HerdSync(connect,transport,{'id':'suzanna','role':'editor'});restarted.initialize_development()
    transport.offline=False;transport.lose=True;restarted.sync();assert len(restarted.pending())==1
    restarted.sync();assert not restarted.pending()
    assert mobile.get('/api/record/events/diagnosis').json['data']['result']=='negative'
    old=restarted.records('events')[0]
    current=mobile.get('/api/record/events/diagnosis').json['data']
    assert push(mobile,mh,[op({**current,'description':'Autre utilisateur'},2,'other',kind='events')]).status_code==200
    restarted.save([{'kind':'events','data':{**old,'cancelled':True}}]);restarted.sync()
    assert restarted.pending()[0]['blocked']['code']=='revision_conflict'
    assert not mobile.get('/api/record/events/diagnosis').json['data'].get('cancelled')
    restarted.keep_remote(restarted.pending()[0]['id']);assert not restarted.pending()
    assert restarted.records('events')[0]['description']=='Autre utilisateur'
    history=mobile.get('/api/history/events/diagnosis').json['history']
    assert [x['result'] for x in history]==['positive','negative','negative']
    # No business table was copied or replaced; the host's existing table is preserved.
    with connect() as db:
        db.execute('CREATE TABLE existing_business(id INTEGER PRIMARY KEY,note TEXT)');db.execute("INSERT INTO existing_business VALUES (1,'untouched')")
    restarted.initialize_development()
    with connect() as db:assert db.execute('SELECT note FROM existing_business').fetchone()[0]=='untouched'


def test_windows_collective_labels_bidirectional_and_logical_cancel(app,tmp_path):
    mobile,mh=login(app,'alice');wc,wh=login(app,'suzanna')
    records=[animal('heifer'+str(i),'FR'+str(i+10).zfill(10)) for i in range(8)]
    assert push(mobile,mh,[op(a,id=a['id']) for a in records]+[op({'id':'label','name':'À échographier'},id='label',kind='labelDefinitions')]).status_code==200
    path=tmp_path/'existing-dev.db';transport=Transport(wc,wh)
    windows=HerdSync(lambda:sqlite3.connect(path),transport,{'id':'suzanna','role':'editor'});windows.initialize_development();windows.sync()
    assert windows.assign_labels([x['id'] for x in records],'label')==8
    assert windows.assign_labels([x['id'] for x in records],'label')==0
    windows.sync();assert not windows.error
    changes=mobile.get('/api/changes').json['changes']
    assert len([x for x in changes if x['kind']=='animalLabelAssignments'])==8
    event={'id':'event','animalId':'heifer0','type':'Observation','date':'2026-11-16','description':'Test fictif'}
    windows.save([{'kind':'events','data':event}]);windows.sync()
    first=mobile.get('/api/record/events/event').json['data'];assert first['description']=='Test fictif'
    assert push(mobile,mh,[op({**first,'cancelled':True},1,'cancel',kind='events')]).status_code==200
    windows.sync();assert windows.records('events')[0]['cancelled']
    history=mobile.get('/api/history/events/event').json['history'];assert len(history)==2


def test_no_synchronized_status_before_first_acknowledgement(app,tmp_path):
    wc,wh=login(app,'suzanna');transport=Transport(wc,wh)
    client=HerdSync(lambda:sqlite3.connect(tmp_path/'dev.db'),transport,{'id':'suzanna','role':'editor'});client.initialize_development()
    assert 'première synchronisation' in client.status()
    client.sync();assert 'confirmée' in client.status()


def test_two_queued_offline_edits_keep_revision_order(app,tmp_path):
    mobile,mh=login(app);wc,wh=login(app,'suzanna');push(mobile,mh,[op(animal())])
    transport=Transport(wc,wh);client=HerdSync(lambda:sqlite3.connect(tmp_path/'dev.db'),transport,{'id':'suzanna','role':'editor'});client.initialize_development();client.sync()
    transport.offline=True
    for note in ('first','second'):
        client.save([{'kind':'animals','data':{**client.records('animals')[0],'notes':note}}])
    transport.offline=False;client.sync();assert not client.error and not client.pending()
    remote=mobile.get('/api/record/animals/animal_a').json['data']
    assert remote['notes']=='second' and remote['revision']==3 and '_localRevision' not in remote
    client.save([{'kind':'animals','data':{**client.records('animals')[0],'notes':'third'}}]);client.sync()
    assert not client.error and mobile.get('/api/record/animals/animal_a').json['data']['revision']==4


def test_open_editor_cannot_borrow_a_newer_pulled_revision(app,tmp_path):
    import pytest
    mobile,mh=login(app);wc,wh=login(app,'suzanna');push(mobile,mh,[op(animal())])
    client=HerdSync(lambda:sqlite3.connect(tmp_path/'dev.db'),Transport(wc,wh),{'id':'suzanna','role':'editor'});client.initialize_development();client.sync()
    opened=client.records('animals')[0]
    assert push(mobile,mh,[op({**opened,'notes':'Correction téléphone'},1,'phone')]).status_code==200
    client.sync()
    with pytest.raises(ValueError,match='actualisée'):
        client.save([{'kind':'animals','data':{**opened,'notes':'Ancien éditeur'}}])
    assert not client.pending()
    assert client.records('animals')[0]['notes']=='Correction téléphone'
