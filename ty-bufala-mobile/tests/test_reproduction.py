from test_api import app, login, animal, op, push


def test_diagnostic_and_bull_validation_and_correction_history(app):
    c,h=login(app)
    assert push(c,h,[op(animal(),id='a'),op(animal('bull','FR0000000002',sex='M'),id='b')]).status_code==200
    event={'id':'diagnosis','animalId':'animal_a','type':'Échographie','date':'2026-11-01','confirmation':'confirmed','result':'positive'}
    assert push(c,h,[op({**event,'result':''},id='invalid',kind='events')]).status_code==422
    assert push(c,h,[op(event,id='positive',kind='events')]).status_code==200
    assert push(c,h,[op({**event,'result':'negative'},1,'correction',kind='events')]).status_code==200
    changes=c.get('/api/changes').json['changes']
    assert [x['data']['result'] for x in changes if x['kind']=='events']==['positive','negative']
    mating={**event,'id':'mating','type':'Saillie naturelle','result':'','bullId':'animal_a'}
    assert push(c,h,[op(mating,id='bad_bull',kind='events')]).status_code==422
    assert push(c,h,[op({**mating,'bullId':'bull'},id='good_bull',kind='events')]).status_code==200
