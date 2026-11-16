from test_api import app, login, animal, op, push
from server.backup import snapshot,restore_empty
from server.store import Store


def test_collective_labels_are_separate_idempotent_and_transactional(app,tmp_path):
    c,h=login(app)
    animals=[animal('heifer'+str(i),'FR'+str(i+10).zfill(10),reproductiveStatus='heifer') for i in range(8)]
    defs=[op({'id':'label','name':'À échographier'},id='label',kind='labelDefinitions'),op({'id':'second','name':'À surveiller'},id='second',kind='labelDefinitions')]
    assert push(c,h,[op(a,id=a['id']) for a in animals]+defs).status_code==200
    batch=[op({'id':'assignment'+str(i),'animalId':a['id'],'labelId':'label'},id='assign'+str(i),kind='animalLabelAssignments') for i,a in enumerate(animals)]
    first=push(c,h,batch);assert first.status_code==200
    assert push(c,h,batch).json==first.json
    duplicate=op({'id':'duplicate','animalId':'heifer0','labelId':'label'},id='dup',kind='animalLabelAssignments')
    assert push(c,h,[duplicate]).status_code==409
    assert push(c,h,[op({'id':'second0','animalId':'heifer0','labelId':'second'},id='add_second',kind='animalLabelAssignments')]).status_code==200
    assert push(c,h,[op({'id':'label','name':'Échographies à faire'},1,'rename',kind='labelDefinitions')]).status_code==200
    changes=c.get('/api/changes').json['changes'];assert len([x for x in changes if x['kind']=='animals'])==8
    assert len([x for x in changes if x['kind']=='animalLabelAssignments'])==9
    completed={**batch[0]['data'],'completedAt':'2026-11-16T12:00:00Z'}
    assert push(c,h,[op(completed,1,'complete',kind='animalLabelAssignments')]).status_code==200
    assert push(c,h,[op({**batch[0]['data'],'id':'reassigned'},id='reassign',kind='animalLabelAssignments')]).status_code==200
    # A stale device cannot silently reopen the old assignment.
    assert push(c,h,[op(batch[0]['data'],1,'stale',kind='animalLabelAssignments')]).status_code==409


def test_one_current_group_and_cancelled_event_history(app):
    c,h=login(app)
    assert push(c,h,[op(animal()),op({'id':'group','name':'Bâtiment'},id='g',kind='herdGroups')]).status_code==200
    assignment={'id':'group_assignment','animalId':'animal_a','groupId':'group'}
    assert push(c,h,[op(assignment,id='ga',kind='animalGroupAssignments')]).status_code==200
    assert push(c,h,[op({**assignment,'id':'other'},id='duplicate_group',kind='animalGroupAssignments')]).status_code==409
    event={'id':'diagnosis','animalId':'animal_a','type':'Échographie','date':'2026-11-01','confirmation':'confirmed','result':'positive'}
    assert push(c,h,[op(event,id='event',kind='events')]).status_code==200
    assert push(c,h,[op({**event,'cancelled':True,'cancelledAt':'2026-11-16T12:00:00Z'},1,'cancel',kind='events')]).status_code==200
    history=c.get('/api/history/events/diagnosis').json['history']
    assert len(history)==2 and history[-1]['cancelled'] and not history[0].get('cancelled')
    assert push(c,h,[op({**event,'result':'negative'},1,'stale_event',kind='events')]).status_code==409
