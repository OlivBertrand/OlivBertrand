import copy
import pytest
from test_api import app, login, animal, op, push


def test_stable_parent_survives_tag_correction_and_rejects_mismatch(app):
    c,h=login(app)
    assert push(c,h,[op(animal('mother','FR0000000001',birthDate='2020-01-01'),id='m'),op(animal('other','FR0000000002',birthDate='2020-01-01'),id='o')]).status_code==200
    child=animal('calf','FR0000000099',motherId='mother',motherTag='FR0000000001')
    receipt=push(c,h,[op(child,id='birth')]).json['receipts'][0]
    assert receipt['data']['motherId']=='mother'
    assert push(c,h,[op(animal('mother','FR0000000011',birthDate='2020-01-01'),1,'correct')]).status_code==200
    result=push(c,h,[op(child,1,'edit_calf')])
    assert result.status_code==200
    assert result.json['receipts'][0]['data']['motherTag']=='FR0000000011'
    wrong={**child,'motherTag':'FR0000000002'}
    assert push(c,h,[op(wrong,2,'wrong')]).status_code==422
    assert push(c,h,[op(animal('mother','FR0000000011',motherId='calf',birthDate=''),2,'cycle')]).status_code==422


def test_birth_batch_is_atomic_replayable_and_conflict_safe(app):
    c,h=login(app)
    mother=animal('mother','FR0000000001',birthDate='2020-01-01',reproductiveStatus='heifer')
    assert push(c,h,[op(mother,id='mother')]).status_code==200
    birth=[op(animal('calf','FR0000000099',birthDate='2026-01-01',motherId='mother'),id='calf'),op({**mother,'reproductiveStatus':'calved','lastCalving':'2026-01-01'},1,'update_mother'),op({'id':'calving','animalId':'mother','type':'Vêlage','date':'2026-01-01'},id='calving',kind='events')]
    invalid=copy.deepcopy(birth);invalid[-1]['data']['animalId']='missing'
    assert push(c,h,invalid).status_code==422
    assert len(c.get('/api/changes').json['changes'])==1
    first=push(c,h,birth)
    assert first.status_code==200
    assert push(c,h,birth).json==first.json
    assert len(c.get('/api/changes').json['changes'])==4
    race=copy.deepcopy(birth);race[0]['opId']='second_calf';race[0]['data']['id']='calf2';race[0]['data']['earTag']='FR0000000088';race[1]['opId']='stale_mother'
    assert push(c,h,race).status_code==409
    assert len(c.get('/api/changes').json['changes'])==4
