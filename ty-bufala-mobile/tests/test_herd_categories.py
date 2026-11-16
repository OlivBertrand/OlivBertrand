"""Server-side validation of herd dashboard classifications.

Synthetic records only: no real animals, no Microsoft credentials.
"""
import pytest
from server.store import Store
from server.domain import apply_operations, Rejected

ACTOR={'id':'test_admin','role':'admin'}

def animal(id='animal_example', sex='F', **kw):
    return {'id':id, 'earTag':'FR0000000001', 'status':'present', 'sex':sex,
            'birthDate':'2020-01-01', **kw}

def save(store, data):
    return apply_operations(store, ACTOR, [{
        'opId':'op_'+data['id'], 'kind':'animals','deviceId':'device_test','baseRevision':0,'data':data
    }])

@pytest.fixture
def store(tmp_path):
    s=Store(str(tmp_path/'herd.sqlite'));s.initialize();return s

def test_explicit_lactation_is_persisted(store):
    receipt=save(store, animal(productionStatus='lactating', reproductiveStatus='calved'))[0]
    assert receipt['data']['productionStatus']=='lactating'
    assert receipt['data']['reproductiveStatus']=='calved'

def test_legacy_without_classification_stays_valid(store):
    assert save(store, animal())[0]['revision']==1

@pytest.mark.parametrize('fields', [
    {'sex':'M','productionStatus':'dry'},
    {'sex':'F','maleRole':'breeding_bull'},
    {'sex':'F','reproductiveStatus':'heifer','productionStatus':'lactating'},
    {'sex':'F','reproductiveStatus':'heifer','lastCalving':'2025-01-01'},
    {'sex':'F','productionStatus':'unknown'},
    {'sex':'F','productionStatusDate':'2026-02-30'},
    {'sex':'F','birthDate':'2026-05-01','productionStatus':'dry'},
])
def test_invalid_profiles_fail_without_any_commit(store,fields):
    with pytest.raises(Rejected): save(store,animal(**fields))
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) AS n FROM records').fetchone()['n']==0
        assert db.execute('SELECT COUNT(*) AS n FROM changes').fetchone()['n']==0

def test_breeding_bull_is_allowed_for_male(store):
    assert save(store, animal(sex='M', maleRole='breeding_bull'))[0]['revision']==1